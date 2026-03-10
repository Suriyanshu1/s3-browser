// ===== Particles =====

function initParticles(theme) {
  // Destroy existing instance before re-creating
  if (window.pJSDom && window.pJSDom.length > 0) {
    window.pJSDom[0].pJS.fn.vendors.destroypJS();
    window.pJSDom = [];
  }

  const jsonFile = theme === 'dark' ? 'particles-dark.json' : 'particles-light.json';

  /* particlesJS.load(@dom-id, @path-json, @callback) */
  particlesJS.load('particles-js', jsonFile, function () {
    console.log('particles.js loaded — theme:', theme);
  });
}

// ===== Theme =====
const html        = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');

function applyTheme(t) {
  html.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
}

themeToggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  initParticles(next);
});

// Apply saved theme on load (no particles yet — wait for window.load)
applyTheme(localStorage.getItem('theme') || 'dark');

// Init particles once everything (including particles.js script) is ready
window.addEventListener('load', function () {
  initParticles(html.getAttribute('data-theme'));
});

// ===== Redirect if already logged in =====
if (sessionStorage.getItem('auth_token')) {
  window.location.replace('/');
}

// ===== Password visibility toggle =====
const pwInput   = document.getElementById('password');
const toggleBtn = document.getElementById('toggle-pw');
const eyeOpen   = toggleBtn.querySelector('.eye-open');
const eyeClosed = toggleBtn.querySelector('.eye-closed');

toggleBtn.addEventListener('click', () => {
  const isText = pwInput.type === 'text';
  pwInput.type        = isText ? 'password' : 'text';
  eyeOpen.style.display   = isText ? 'block' : 'none';
  eyeClosed.style.display = isText ? 'none'  : 'block';
});

// ===== Login form =====
const form       = document.getElementById('login-form');
const btn        = document.getElementById('btn-signin');
const errorBox   = document.getElementById('error-msg');
const errorText  = document.getElementById('error-text');
const btnLabel   = btn.querySelector('.btn-label');
const btnArrow   = btn.querySelector('.btn-arrow');
const btnSpinner = btn.querySelector('.btn-spinner');

function showError(msg) {
  errorText.textContent = msg;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}

function setLoading(loading) {
  btn.disabled = loading;
  btnLabel.textContent     = loading ? 'Signing in…' : 'Sign In';
  btnArrow.style.display   = loading ? 'none' : 'block';
  btnSpinner.classList.toggle('hidden', !loading);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const username = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showError('Please enter your email and password.');
    return;
  }

  setLoading(true);

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Login failed. Please try again.');
      return;
    }

    sessionStorage.setItem('auth_token', data.token);
    window.location.replace('/');

  } catch (_) {
    showError('Network error. Please check your connection and try again.');
  } finally {
    setLoading(false);
  }
});
