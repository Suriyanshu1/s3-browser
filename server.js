require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Validate required env vars =====
const BUCKET          = process.env.S3_BUCKET_NAME;
const USER_POOL_ID    = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID       = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET   = process.env.COGNITO_CLIENT_SECRET || ''; // optional
const REGION          = process.env.AWS_REGION || 'us-east-1';

// Computes the SECRET_HASH required when the App Client has a secret configured
function computeSecretHash(username) {
  return crypto
    .createHmac('sha256', CLIENT_SECRET)
    .update(username + CLIENT_ID)
    .digest('base64');
}

if (!BUCKET)       { console.error('ERROR: S3_BUCKET_NAME is not set'); process.exit(1); }
if (!USER_POOL_ID) { console.error('ERROR: COGNITO_USER_POOL_ID is not set'); process.exit(1); }
if (!CLIENT_ID)    { console.error('ERROR: COGNITO_CLIENT_ID is not set'); process.exit(1); }

// ===== AWS Clients =====
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Cognito uses the same IAM credentials for InitiateAuth
const cognito = new CognitoIdentityProviderClient({ region: REGION });

// ===== JWT verification via Cognito JWKS =====
const jwks = jwksClient({
  jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

function getSigningKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
        algorithms: ['RS256'],
      },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  verifyToken(auth.slice(7))
    .then((decoded) => { req.user = decoded; next(); })
    .catch(() => res.status(401).json({ error: 'Invalid or expired session. Please log in again.' }));
}

// ===== Middleware =====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Public routes =====

app.get('/api/config', (req, res) => {
  res.json({ title: process.env.SITE_TITLE || 'File Browser' });
});

// Login — calls Cognito InitiateAuth, returns IdToken
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const cleanUsername = username.trim();
    const authParams = {
      USERNAME: cleanUsername,
      PASSWORD: password,
    };
    if (CLIENT_SECRET) {
      authParams.SECRET_HASH = computeSecretHash(cleanUsername);
    }

    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: authParams,
    });

    const response = await cognito.send(command);

    if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return res.status(403).json({
        error: 'Password change required. Please reset your password via the AWS console.',
      });
    }

    const { IdToken, ExpiresIn } = response.AuthenticationResult;
    res.json({ token: IdToken, expiresIn: ExpiresIn });
  } catch (err) {
    const name = err.name || '';
    // Always log the raw error so it's visible in the terminal
    console.error(`\n[Cognito Error] name="${name}" message="${err.message}"\n`);

    if (name === 'NotAuthorizedException') {
      // Could be wrong password OR auth flow not enabled on App Client
      return res.status(401).json({ error: `Incorrect email or password. (Cognito: ${err.message})` });
    }
    if (name === 'UserNotFoundException') {
      return res.status(401).json({ error: 'No account found with that email address.' });
    }
    if (name === 'UserNotConfirmedException') {
      return res.status(401).json({ error: 'Account not confirmed. Please contact your administrator.' });
    }
    if (name === 'InvalidParameterException') {
      return res.status(400).json({ error: `Configuration error: ${err.message}` });
    }
    if (name === 'ResourceNotFoundException') {
      return res.status(500).json({ error: `Cognito resource not found: ${err.message}` });
    }
    // Fallback — expose the raw message so you can see exactly what went wrong
    res.status(500).json({ error: `Authentication error: [${name}] ${err.message}` });
  }
});

// ===== Protected routes =====

app.get('/api/list', requireAuth, async (req, res) => {
  const prefix = req.query.prefix || '';
  const safePrefix = prefix.replace(/\.\.\//g, '').replace(/^\//, '');

  try {
    const folders = [];
    const files = [];
    let continuationToken;

    do {
      const params = { Bucket: BUCKET, Prefix: safePrefix, Delimiter: '/' };
      if (continuationToken) params.ContinuationToken = continuationToken;

      const response = await s3.send(new ListObjectsV2Command(params));

      for (const cp of (response.CommonPrefixes || [])) {
        folders.push({
          type: 'folder',
          name: cp.Prefix.slice(safePrefix.length).replace(/\/$/, ''),
          prefix: cp.Prefix,
        });
      }

      for (const obj of (response.Contents || [])) {
        if (obj.Key === safePrefix) continue;
        files.push({
          type: 'file',
          name: obj.Key.slice(safePrefix.length),
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
        });
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    res.json({ folders, files, prefix: safePrefix });
  } catch (err) {
    console.error('List error:', err.message);
    res.status(500).json({ error: 'Failed to list bucket contents.' });
  }
});

app.get('/api/download', requireAuth, async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'Missing key parameter.' });

  const safeKey = key.replace(/\.\.\//g, '').replace(/^\//, '');

  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: safeKey }));

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: safeKey,
      ResponseContentDisposition: `attachment; filename="${path.basename(safeKey)}"`,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 300 });
    res.json({ url });
  } catch (err) {
    console.error('Download error:', err.message);
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'File not found.' });
    }
    res.status(500).json({ error: 'Failed to generate download link.' });
  }
});

app.get('/api/search', requireAuth, async (req, res) => {
  const prefix = (req.query.prefix || '').replace(/\.\.\//g, '').replace(/^\//, '');
  const query = (req.query.query || '').toLowerCase();

  if (!query) return res.status(400).json({ error: 'Missing query parameter.' });

  try {
    const allObjects = [];
    let continuationToken;

    do {
      const params = { Bucket: BUCKET, Prefix: prefix };
      if (continuationToken) params.ContinuationToken = continuationToken;

      const response = await s3.send(new ListObjectsV2Command(params));
      if (response.Contents) allObjects.push(...response.Contents);
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    const files = allObjects
      .filter((obj) => {
        const filename = obj.Key.split('/').pop();
        return filename && filename.toLowerCase().includes(query);
      })
      .map((obj) => ({
        type: 'file',
        name: obj.Key.split('/').pop(),
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
      }));

    res.json({ files });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to search bucket contents.' });
  }
});

app.listen(PORT, () => {
  console.log(`\nS3 Browser  →  http://localhost:${PORT}`);
  console.log(`Bucket      →  ${BUCKET}`);
  console.log(`User Pool   →  ${USER_POOL_ID}\n`);
});
