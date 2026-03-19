// ===== Auth Guard =====
const token = sessionStorage.getItem('auth_token');
if (!token) {
  window.location.replace('/login.html');
}

// ===== Authenticated fetch helper =====
function authFetch(url) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((res) => {
    if (res.status === 401) {
      sessionStorage.removeItem('auth_token');
      window.location.replace('/login.html');
    } else {
      document.body.style.display = 'initial';
    }
    return res;
  });
}

// ===== Theme Management =====
const html = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');

function applyTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

themeToggle.addEventListener('click', () => {
  applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

applyTheme(localStorage.getItem('theme') || 'dark');

// ===== Logout =====
document.getElementById('btn-logout').addEventListener('click', () => {
  sessionStorage.removeItem('auth_token');
  window.location.replace('/login.html');
});

// ===== Pagination State =====
let currentPage = 1;
let pageSize = 100;
let allItems = []; // flat list: folders first, then files

const paginationEl = document.getElementById('pagination');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const pageIndicator = document.getElementById('page-indicator');
const pageSizeSelect = document.getElementById('page-size-select');

btnPrev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderCurrentPage(); } });
btnNext.addEventListener('click', () => { if (currentPage < totalPages()) { currentPage++; renderCurrentPage(); } });
pageSizeSelect.addEventListener('change', () => {
  pageSize = parseInt(pageSizeSelect.value, 10);
  currentPage = 1;
  renderCurrentPage();
});

function totalPages() {
  return Math.max(1, Math.ceil(allItems.length / pageSize));
}

// ===== Multi-select State =====
let selectedKeys = new Set();

const selectAllCheckbox = document.getElementById('select-all');
const selectionBar = document.getElementById('selection-bar');
const selectionCount = document.getElementById('selection-count');
const btnDownloadSelected = document.getElementById('btn-download-selected');
const btnClearSelection = document.getElementById('btn-clear-selection');

selectAllCheckbox.addEventListener('change', () => {
  const pageItems = getPageItems();
  const fileItems = pageItems.filter((item) => item.type === 'file');
  if (selectAllCheckbox.checked) {
    fileItems.forEach((f) => selectedKeys.add(f.key));
  } else {
    fileItems.forEach((f) => selectedKeys.delete(f.key));
  }
  syncCheckboxes();
  updateSelectionBar();
});

btnClearSelection.addEventListener('click', clearSelection);
btnDownloadSelected.addEventListener('click', downloadSelected);

function clearSelection() {
  selectedKeys.clear();
  selectAllCheckbox.checked = false;
  syncCheckboxes();
  updateSelectionBar();
}

function syncCheckboxes() {
  document.querySelectorAll('#file-list .file-checkbox').forEach((cb) => {
    cb.checked = selectedKeys.has(cb.dataset.key);
  });
  // Update select-all state
  const pageItems = getPageItems();
  const pageFiles = pageItems.filter((item) => item.type === 'file');
  if (pageFiles.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else {
    const checkedCount = pageFiles.filter((f) => selectedKeys.has(f.key)).length;
    selectAllCheckbox.checked = checkedCount === pageFiles.length;
    selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < pageFiles.length;
  }
}

function updateSelectionBar() {
  const count = selectedKeys.size;
  if (count === 0) {
    selectionBar.classList.add('hidden');
  } else {
    selectionBar.classList.remove('hidden');
    selectionCount.textContent = `${count} file${count !== 1 ? 's' : ''} selected`;
  }
}

async function downloadSelected() {
  const keys = Array.from(selectedKeys);
  btnDownloadSelected.disabled = true;
  btnDownloadSelected.textContent = 'Downloading...';

  for (let i = 0; i < keys.length; i++) {
    try {
      const res = await authFetch(`/api/download?key=${encodeURIComponent(keys[i])}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const a = document.createElement('a');
      a.href = data.url;
      a.download = keys[i].split('/').pop();
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Small delay between downloads to avoid popup blockers
      if (i < keys.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      alert(`Download failed for ${keys[i].split('/').pop()}: ${err.message}`);
    }
  }

  btnDownloadSelected.disabled = false;
  btnDownloadSelected.textContent = 'Download selected';
}

// ===== Search =====
const searchInput = document.getElementById('search-input');
const btnSearch = document.getElementById('btn-search');
const searchHeading = document.getElementById('search-heading');
const searchHeadingText = document.getElementById('search-heading-text');
const btnClearSearch = document.getElementById('btn-clear-search');
let isSearchMode = false;

btnSearch.addEventListener('click', performSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') performSearch();
});
btnClearSearch.addEventListener('click', clearSearch);

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  isSearchMode = true;
  clearSelection();
  showState('loading');

  try {
    const res = await authFetch(`/api/search?prefix=${encodeURIComponent(currentPrefix)}&query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    searchHeadingText.textContent = `Search results for: "${query}"`;
    searchHeading.classList.remove('hidden');

    if (data.files.length === 0) {
      allItems = [];
      showState('empty');
      updateFooter(0);
      hidePagination();
      return;
    }

    allItems = data.files; // search returns only files
    currentPage = 1;
    showState('list');
    renderCurrentPage();
    updateFooter(data.files.length);
    updateCheckboxVisibility();
  } catch (err) {
    showError(err.message || 'Search failed.');
  }
}

function clearSearch() {
  isSearchMode = false;
  searchInput.value = '';
  searchHeading.classList.add('hidden');
  loadDirectory(currentPrefix);
}

// ===== State =====
let currentPrefix = '';

// ===== Init =====
async function init() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    document.title = config.title;
    document.getElementById('site-title').textContent = config.title;
  } catch (_) {
    // non-critical
  }
  loadDirectory('');
}

// ===== Directory loading =====
async function loadDirectory(prefix) {
  currentPrefix = prefix;
  isSearchMode = false;
  searchHeading.classList.add('hidden');
  clearSelection();
  showState('loading');

  try {
    const res = await authFetch(`/api/list?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderFiles(data);
  } catch (err) {
    showError(err.message || 'Failed to load contents.');
  }
}

// ===== Render =====
function renderFiles({ folders, files, prefix }) {
  const total = folders.length + files.length;

  if (total === 0) {
    allItems = [];
    showState('empty');
    updateFooter(0);
    hidePagination();
    return;
  }

  // Build flat list: folders first, then files
  allItems = [...folders, ...files];
  currentPage = 1;

  showState('list');
  renderCurrentPage();
  updateFooter(total);
  updateBreadcrumb(prefix);
}

function getPageItems() {
  const start = (currentPage - 1) * pageSize;
  return allItems.slice(start, start + pageSize);
}

function renderCurrentPage() {
  const list = document.getElementById('file-list');
  list.innerHTML = '';

  const pageItems = getPageItems();
  pageItems.forEach((item) => {
    if (item.type === 'folder') {
      list.appendChild(createFolderRow(item));
    } else {
      list.appendChild(createFileRow(item));
    }
  });

  updatePagination();
  syncCheckboxes();
  updateCheckboxVisibility();
}

function updatePagination() {
  const tp = totalPages();
  if (tp <= 1) {
    hidePagination();
    return;
  }
  paginationEl.classList.remove('hidden');
  pageIndicator.textContent = `Page ${currentPage} of ${tp}`;
  btnPrev.disabled = currentPage <= 1;
  btnNext.disabled = currentPage >= tp;
}

function updateCheckboxVisibility() {
  const hasFiles = allItems.some((item) => item.type === 'file');
  const panel = document.getElementById('panel');
  if (hasFiles) {
    panel.classList.remove('no-files');
  } else {
    panel.classList.add('no-files');
    clearSelection();
  }
}

function hidePagination() {
  paginationEl.classList.add('hidden');
}

function createFolderRow(folder) {
  const row = document.createElement('div');
  row.className = 'file-row is-folder';
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', `Open folder ${folder.name}`);

  row.innerHTML = `
    <span class="file-checkbox-wrap"></span>
    <div class="cell-name">
      <div class="file-icon is-folder">${folderSvg()}</div>
      <span class="file-name">${escHtml(folder.name)}</span>
      <div class="folder-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>
    <span class="cell-size">&mdash;</span>
    <span class="cell-date">&mdash;</span>
    <span class="cell-action"></span>
  `;

  const open = () => loadDirectory(folder.prefix);
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  return row;
}

function createFileRow(file) {
  const row = document.createElement('div');
  row.className = 'file-row';

  const ext = getExtension(file.name);

  row.innerHTML = `
    <span class="file-checkbox-wrap">
      <input type="checkbox" class="file-checkbox" data-key="${escHtml(file.key)}" />
    </span>
    <div class="cell-name">
      <div class="file-icon">${getFileIconSvg(ext)}</div>
      <span class="file-name" title="${escHtml(file.name)}">${escHtml(file.name)}</span>
    </div>
    <span class="cell-size">${formatSize(file.size)}</span>
    <span class="cell-date">${formatDate(file.lastModified)}</span>
    <div class="cell-action">
      <button class="btn-download" aria-label="Download ${escHtml(file.name)}">
        ${downloadSvg()} Download
      </button>
    </div>
  `;

  const cb = row.querySelector('.file-checkbox');
  if (selectedKeys.has(file.key)) cb.checked = true;
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (cb.checked) {
      selectedKeys.add(file.key);
    } else {
      selectedKeys.delete(file.key);
    }
    syncCheckboxes();
    updateSelectionBar();
  });
  cb.addEventListener('click', (e) => e.stopPropagation());

  row.querySelector('.btn-download').addEventListener('click', (e) => {
    e.stopPropagation();
    triggerDownload(file.key, e.currentTarget);
  });

  return row;
}

// ===== Download =====
async function triggerDownload(key, btn) {
  btn.classList.add('loading');
  btn.innerHTML = `${spinnerInline()} Preparing\u2026`;

  try {
    const res = await authFetch(`/api/download?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const a = document.createElement('a');
    a.href = data.url;
    a.download = key.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    alert(`Download failed: ${err.message}`);
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = `${downloadSvg()} Download`;
  }
}

// ===== Breadcrumb =====
function updateBreadcrumb(prefix) {
  const ol = document.getElementById('breadcrumb-list');
  ol.innerHTML = '';
  ol.appendChild(makeBreadcrumbItem('Root', ''));

  if (!prefix) return;

  const parts = prefix.replace(/\/$/, '').split('/');
  let accumulated = '';
  parts.forEach((part, i) => {
    accumulated += part + '/';
    ol.appendChild(makeBreadcrumbItem(part, accumulated, i === parts.length - 1));
  });
}

function makeBreadcrumbItem(name, prefix, isLast = false) {
  const li = document.createElement('li');
  li.className = 'breadcrumb-item';
  const btn = document.createElement('button');
  btn.className = 'breadcrumb-btn';
  btn.textContent = name;
  btn.setAttribute('data-prefix', prefix);
  if (!isLast) btn.addEventListener('click', () => loadDirectory(prefix));
  li.appendChild(btn);
  return li;
}

// ===== State helpers =====
function showState(state) {
  document.getElementById('panel').classList.toggle('hidden', state !== 'list');
  document.getElementById('empty-state').classList.toggle('hidden', state !== 'empty');
  document.getElementById('error-state').classList.toggle('hidden', state !== 'error');
  document.getElementById('loading-state').classList.toggle('hidden', state !== 'loading');
  // Pagination should only show when state is 'list' and there are multiple pages
  if (state !== 'list') hidePagination();
}

function showError(msg) {
  showState('error');
  document.getElementById('error-message').textContent = msg;
}

function updateFooter(count) {
  document.getElementById('item-count').textContent =
    count === 0 ? '' : `${count} item${count !== 1 ? 's' : ''}`;
}

// ===== Utilities =====
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatDate(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

// ===== SVG icons =====
function folderSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
  </svg>`;
}

function downloadSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`;
}

function spinnerInline() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    style="width:12px;height:12px;animation:spin 0.7s linear infinite;display:inline-block;vertical-align:middle">
    <path d="M12 2a10 10 0 110 20 10 10 0 010-20z" stroke-opacity="0.25"/>
    <path d="M12 2a10 10 0 0110 10"/>
  </svg>`;
}

function getFileIconSvg(ext) {
  const imageExts   = ['jpg','jpeg','png','gif','webp','svg','ico','bmp','avif'];
  const videoExts   = ['mp4','mov','avi','mkv','webm','flv'];
  const audioExts   = ['mp3','wav','ogg','flac','aac','m4a'];
  const archiveExts = ['zip','tar','gz','bz2','7z','rar','xz'];
  const codeExts    = ['js','ts','jsx','tsx','py','go','rs','java','c','cpp','h','html','css','json','yaml','yml','sh','bash','toml','xml'];
  const docExts     = ['pdf','doc','docx','xls','xlsx','ppt','pptx'];

  if (imageExts.includes(ext))
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#7ec8b0">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/></svg>`;

  if (videoExts.includes(ext))
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#c87ec8">
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;

  if (audioExts.includes(ext))
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#c8a96e">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

  if (archiveExts.includes(ext))
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#e08c5a">
      <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
      <line x1="10" y1="12" x2="14" y2="12"/></svg>`;

  if (codeExts.includes(ext))
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#7ea8c8">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

  if (docExts.includes(ext))
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#e07a7a">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/></svg>`;

  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
    <polyline points="13 2 13 9 20 9"/></svg>`;
}

// ===== Start =====
init();
