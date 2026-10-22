'use strict';

/* ================= Helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const debounce = (fn, ms) => {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
function dateLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return hm;
  if (yest) return 'أمس ' + hm;
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) + ' ' + hm;
}

/* ================= IndexedDB ================= */
const DB_NAME = 'inotes-db', DB_VERSION = 1;
let db = null;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function dbOp(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const st = db.transaction(store, mode).objectStore(store);
    const req = fn(st);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const dbPut = (store, val) => dbOp(store, 'readwrite', st => st.put(val));
const dbDelete = (store, key) => dbOp(store, 'readwrite', st => st.delete(key));
const dbGetAll = store => dbOp(store, 'readonly', st => st.getAll());
const dbClear = store => dbOp(store, 'readwrite', st => st.clear());
async function dbQuotaSafePut(store, val) {
  try { await dbPut(store, val); return true; }
  catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      toast('مساحة التخزين المخصصة للتطبيق ممتلئة! احذف بعض النوتات أو امسح بيانات المتصفح القديمة.', 'error', 5200);
    } else {
      toast('تعذر حفظ البيانات محلياً: ' + (e && e.name ? e.name : 'خطأ'), 'error', 4000);
    }
    return false;
  }
}

/* ================= State & prefs ================= */
const VC = ['default', 'yellow', 'green', 'blue', 'pink', 'purple', 'orange'];
const COLOR_HEX = {
  yellow: { light: '#ffd66e', dark: '#f9d270' },
  green: { light: '#9be59b', dark: '#8fd88f' },
  blue: { light: '#95c8ff', dark: '#82b4f2' },
  pink: { light: '#f7a8c8', dark: '#e79abf' },
  purple: { light: '#c9b4ff', dark: '#b9a3f2' },
  orange: { light: '#ffbf8f', dark: '#f2a772' }
};
const colorHex = name => {
  if (name === 'default') return null;
  const c = COLOR_HEX[name];
  return c ? c[document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'] : null;
};

const state = {
  notes: [],
  filter: '',
  editingId: null,
  pendingAtts: new Map(),
  saveTimer: null,
  draw: { on: false, color: '#222831', size: 5, erase: false, strokes: [] }
};

const PKEY = 'inotes-prefs';
const prefs = {
  theme: 'dark', anim: 'on', defFont: 'default', defSize: 'md', defColor: 'default', hintDismissed: false
};
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PKEY);
    if (raw) Object.assign(prefs, JSON.parse(raw));
  } catch (e) { /* ignore */ }
}
function savePrefs() {
  try { localStorage.setItem(PKEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
}

const FONT_STACKS = {
  default: 'inherit',
  serif: '"Noto Naskh Arabic","Amiri","Traditional Arabic",Georgia,serif',
  mono: '"Consolas","Menlo","Courier New",monospace'
};
const FONT_LABELS = { default: 'الأساسي', serif: 'النسخ', mono: 'المضاها' };
const SIZE_PX = { sm: '14.5px', md: '16px', lg: '19px' };

/* ================= Toasts ================= */
const toastsEl = $('#toasts');
const toastIcons = { success: '#i-check', error: '#i-close', info: '#i-doc' };
function toast(msg, type = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<svg class="icon"><use href="${toastIcons[type] || toastIcons.info}"/></svg><span>${esc(msg)}</span>`;
  toastsEl.appendChild(el);
  setTimeout(() => {
    if (!el.isConnected) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  }, ms);
  return el;
}

/* ================= Modals ================= */
const modalRoot = $('#modalRoot'), modalEl = $('#modal');
function openModal(inner) {
  modalEl.innerHTML = inner;
  modalRoot.hidden = false;
  const first = modalEl.querySelector('.modal-input, button');
  setTimeout(() => { if (first) first.focus({ preventScroll: true }); }, 60);
  return modalEl;
}
function closeModal() {
  modalRoot.hidden = true;
  modalEl.innerHTML = '';
}
function confirmDialog({ title, message, okText }) {
  return new Promise(resolve => {
    openModal(`
      <div class="modal-head"><h3>${esc(title)}</h3>
        <button class="icon-btn" data-x type="button" aria-label="إغلاق"><svg class="icon"><use href="#i-close"/></svg></button></div>
      <div class="modal-body"><p class="modal-note" style="margin-top:2px">${esc(message)}</p></div>
      <div class="modal-foot">
        <button class="btn ghost" data-no type="button">إلغاء</button>
        <button class="btn primary" data-ok type="button">${esc(okText || 'تأكيد')}</button>
      </div>`);
    const okBtn = $('[data-ok]', modalEl);
    const dangerWords = ['حذف', 'مسح', 'إزالة'];
    if (dangerWords.some(w => (okText || '').includes(w))) {
      okBtn.style.background = 'linear-gradient(135deg,var(--danger),#d92b2b)';
      okBtn.style.boxShadow = '0 6px 18px var(--danger-soft)';
    }
    let settled = false;
    const done = v => { if (settled) return; settled = true; document.removeEventListener('keydown', escHandler); closeModal(); resolve(v); };
    const escHandler = ev => { if (ev.key === 'Escape') done(false); };
    document.addEventListener('keydown', escHandler);
    $('[data-ok]', modalEl).onclick = () => done(true);
    $('[data-no]', modalEl).onclick = () => done(false);
    $('[data-x]', modalEl).onclick = () => done(false);
    $('#modalBackdrop').onclick = () => done(false);
  });
}
function menuDialog(title, items) {
  return new Promise(resolve => {
    const rows = items.map((it, i) => `
      <button class="picker-row${it.danger ? ' danger' : ''}" data-i="${i}" type="button">
        <svg class="icon"><use href="${it.icon}"/></svg>
        <span class="picker-main">${esc(it.label)}${it.sub ? `<span class="picker-sub">${esc(it.sub)}</span>` : ''}</span>
      </button>`).join('');
    openModal(`
      <div class="modal-head"><h3>${esc(title)}</h3>
        <button class="icon-btn" data-x type="button" aria-label="إغلاق"><svg class="icon"><use href="#i-close"/></svg></button></div>
      <div class="modal-body"><div class="picker-list">${rows}</div></div>`);
    let settled = false;
    const done = v => { if (settled) return; settled = true; document.removeEventListener('keydown', escHandler); closeModal(); resolve(v); };
    const escHandler = ev => { if (ev.key === 'Escape') done(null); };
    document.addEventListener('keydown', escHandler);
    $$('[data-i]', modalEl).forEach(b => b.onclick = () => done(items[+b.dataset.i].key));
    $('[data-x]', modalEl).onclick = () => done(null);
    $('#modalBackdrop').onclick = () => done(null);
  });
}

/* ================= Theme ================= */
const themeBtn = $('#themeBtn'), themeMeta = $('#themeColorMeta');
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeMeta.content = t === 'light' ? '#eef1f8' : '#0b0e17';
  themeBtn.querySelector('use').setAttribute('href', t === 'light' ? '#i-moon' : '#i-sun');
}
themeBtn.addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const t = isLight ? 'dark' : 'light';
  prefs.theme = t; savePrefs(); applyTheme(t);
  toast(isLight ? 'الوضع الليلي 🌙' : 'الوضع النهاري ☀️', 'info', 1200);
});
function applyAnim() {
  document.body.setAttribute('data-anim', prefs.anim);
}

/* ================= Note body helpers ================= */
function bodyText(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
function cleanBodyHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html || '');
  $$('.att-draw', d).forEach(im => { if (!im.closest('.att')) im.remove(); });
  $$('.att-x', d).forEach(x => x.remove());
  $$('.att', d).forEach(h => { if (h.dataset.kind === 'audio') h.remove(); });
  $$('.att', d).forEach(h => h.removeAttribute('data-hydrated'));
  return d.innerHTML;
}
function sanitizeBody(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\ssrc="blob:[^"]*"/gi, '')
    .replace(/\ssrc='blob:[^']*'/gi, '')
    .replace(/\ssrc="data:image\/[^"]*"/gi, '')
    .replace(/\ssrc='data:image\/[^']*'/gi, '')
    .replace(/\sdata-hydrated="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}
function attPlaceholder(att) {
  if (att.kind === 'draw') {
    return `<span class="att" contenteditable="false" data-att="${esc(att.id)}" data-kind="draw"><img class="att-draw" alt="رسمة">${ATT_X}</span>`;
  }
  return '';
}

/* ================= Dashboard render ================= */
const notesGrid = $('#notesGrid');
const notesEmpty = $('#notesEmpty');
const notesNoResult = $('#notesNoResult');
const notesCountEl = $('#notesCount');

function sortedNotes() {
  return [...state.notes].sort((a, b) =>
    (b.pinned - a.pinned) || (b.updated - a.updated));
}
function filteredNotes() {
  const q = state.filter.trim();
  if (!q) return sortedNotes();
  const ql = q.toLowerCase();
  return sortedNotes().filter(n => {
    const t = (n.title || '').toLowerCase();
    const b = bodyText(n.body).toLowerCase();
    return t.includes(ql) || b.includes(ql);
  });
}
function renderGrid() {
  const list = filteredNotes();
  notesGrid.innerHTML = '';
  const noNotes = state.notes.length === 0;
  const noRes = !noNotes && list.length === 0;
  notesEmpty.classList.toggle('hidden', !(noNotes && !state.filter));
  notesNoResult.classList.toggle('hidden', !noRes);
  notesCountEl.textContent = noNotes ? '' : (state.filter ? `${list.length} من ${state.notes.length}` : `${state.notes.length} نوتة`);
  list.forEach((n, i) => {
    const li = document.createElement('li');
    li.className = 'note-card c-' + VC.indexOf(n.color || 'default');
    li.style.animationDelay = Math.min(i * 45, 400) + 'ms';
    li.dataset.id = n.id;
    if (n.pinned) li.classList.add('pinned');
    const txt = bodyText(n.body);
    let excerpt = txt.slice(0, 140);
    const badges = [];
    if ((n.atts || []).some(a => a.kind === 'draw')) badges.push('<span class="card-badge"><svg class="icon"><use href="#i-brush"/></svg></span>');
    if (!excerpt) excerpt = (badges.length ? '📐 محتوى وسائط' : 'نوتة فارغة');
    li.innerHTML = `
      <span class="card-top">
        <span class="card-title">${esc(n.title || 'بدون عنوان')}</span>
        ${n.pinned ? '<span class="card-pin"><svg class="icon"><use href="#i-pin"/></svg></span>' : ''}
      </span>
      <span class="card-excerpt">${esc(excerpt)}</span>
      <span class="card-badges">
        ${badges.join('')}
        <span class="card-date">${dateLabel(n.updated)}</span>
      </span>
      <button class="card-menu" data-menu aria-label="خيارات النوتة" type="button"><svg class="icon"><use href="#i-more"/></svg></button>`;
    notesGrid.appendChild(li);
  });
}
notesGrid.addEventListener('click', e => {
  const card = e.target.closest('.note-card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('[data-menu]')) { openNoteMenu(id); return; }
  openEditor(id);
});

async function openNoteMenu(id) {
  const n = getNote(id);
  if (!n) return;
  const hasDraw = (n.atts || []).some(a => a.kind === 'draw');
  const choice = await menuDialog(n.title || 'بدون عنوان', [
    { key: 'open', label: 'فتح النوتة', icon: '#i-edit' },
    n.pinned
      ? { key: 'unpin', label: 'إلغاء التثبيت', icon: '#i-pin-off' }
      : { key: 'pin', label: 'تثبيت النوتة', icon: '#i-pin', sub: 'تظهر أول القائمة دائماً' },
    { key: 'png', label: 'تصدير صورة PNG', icon: '#i-image' },
    { key: 'pdf', label: 'تصدير PDF', icon: '#i-download' },
    { key: 'txt', label: 'ملف نصي TXT', icon: '#i-doc', _fix: 1 },
    hasDraw ? { key: 'png-att', label: 'تصدير الرسمة وحدها', icon: '#i-brush' } : null,
    { key: 'del', label: 'حذف النوتة', icon: '#i-trash', danger: true }
  ].filter(Boolean));
  if (!choice) return;
  if (choice === 'open') openEditor(id);
  else if (choice === 'pin' || choice === 'unpin') {
    n.pinned = choice === 'pin';
    n.updated = Date.now();
    const ok = await dbQuotaSafePut('notes', n);
    if (ok) { renderGrid(); toast(n.pinned ? 'تم تثبيت النوتة 📌' : 'أُلغي التثبيت', 'info', 1300); }
  }
  else if (choice === 'png') exportPNG(n);
  else if (choice === 'pdf') exportPDF(n);
  else if (choice === 'txt') exportTXT(n);
  else if (choice === 'png-att') {
    const a = (n.atts || []).find(a => a.kind === 'draw');
    if (a) downloadBlob(a.blob, safeName(n.title || 'رسمة') + '.png');
  }
  else if (choice === 'del') {
    const ok = await confirmDialog({ title: 'حذف النوتة؟', message: `«${n.title || 'بدون عنوان'}» ستُحذف نهائياً مع كل محتوياتها (الرسم).`, okText: 'حذف نهائي' });
    if (!ok) return;
    await dbQuotaSafePut('notes', n).catch(() => {});
    await dbDelete('notes', n.id);
    state.notes = state.notes.filter(x => x.id !== n.id);
    (n.atts || []).forEach(a => { if (a._url) URL.revokeObjectURL(a._url); });
    renderGrid();
    toast('تم حذف النوتة 🗑', 'info', 1500);
  }
}
function safeName(s) {
  return String(s || 'iNotes').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || 'iNotes';
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

/* ================= Editor ================= */
const edSheet = $('#edSheet'), edBackdrop = $('#edBackdrop');
const edBody = $('#edBody'), edTitle = $('#edTitle');
const edLabel = $('#edLabel'), saveDot = $('#saveDot');
const edColorRow = $('#edColorRow');
const drawArea = $('#drawArea'), edBodyWrap = $('#edBodyWrap');
const drawCanvas = $('#drawCanvas');
const colorsRowHTML = VC.map(c =>
  `<button class="nc-swatch${c === 'default' ? ' none' : ''}" data-c="${c}" type="button" aria-label="لون ${c}" style="--sw:${c === 'default' ? 'none' : `var(--nc-${c})`}"></button>`
).join('');
edColorRow.innerHTML = colorsRowHTML;

function getNote(id) { return state.notes.find(n => n.id === id) || null; }
function currentNote() { return state.editingId ? getNote(state.editingId) : (state._new || null); }

let edOpen = false;
function openEditor(id, opts = {}) {
  let n = null;
  if (id) n = getNote(id);
  if (!n) {
    n = {
      id: uid(), title: '', body: '', color: prefs.defColor || 'default',
      pinned: false, created: Date.now(), updated: Date.now(),
      font: prefs.defFont || 'default', size: prefs.defSize || 'md',
      atts: []
    };
    state._new = n;
    state.notes.push(n);
  }
  state.editingId = n.id;
  state._new = null;
  edLabel.textContent = n.created === n.updated ? 'نوتة جديدة' : 'تعديل نوتة';
  edTitle.value = n.title || '';
  edBody.innerHTML = n.body || '';
  state.pendingAtts = new Map();
  hydrateAtts(n);
  applyEditorStyle(n);
  markColor(n.color || 'default');
  edBody.style.setProperty('--ed-fs', SIZE_PX[n.size] || SIZE_PX.md);
  edBody.style.setProperty('--ed-ff', FONT_STACKS[n.font] === 'inherit' ? '' : FONT_STACKS[n.font]);
  edSheet.classList.add('open');
  edBackdrop.classList.add('open');
  edSheet.setAttribute('aria-hidden', 'false');
  edOpen = true;
  document.body.style.overflow = 'hidden';
  updateFontUI();
  updateToolbarState();
  maybeAutoFocus(opts.focus);
}
function maybeAutoFocus(focus) {
  const empty = !edBody.textContent.trim() && !edBody.querySelector('.att');
  setTimeout(() => {
    if (focus === 'body' && empty) edBody.focus();
    else if (focus === 'title' || (empty && focus !== 'none')) { if (empty) edTitle.focus(); }
  }, 380);
}
function closeEditor() {
  flushSave();
  const n = currentNote();
  if (edOpen && n && isEmptyNote(n)) {
    state.notes = state.notes.filter(x => x.id !== n.id);
    dbDelete('notes', n.id).catch(() => {});
    renderGrid();
  }
  state.editingId = null;
  edSheet.classList.remove('open');
  edBackdrop.classList.remove('open');
  edSheet.setAttribute('aria-hidden', 'true');
  edOpen = false;
  document.body.style.overflow = '';
  renderGrid();
}
function isEmptyNote(n) {
  return !bodyText(n.body) && !edBody.querySelector('.att, .att-draw') && !edTitle.value.trim();
}
edClose.addEventListener('click', () => { edOpen ? closeEditor() : null; });
edBackdrop.addEventListener('click', () => { edOpen ? closeEditor() : null; });

function applyEditorStyle(n) {
  edBody.style.setProperty('--ed-fs', SIZE_PX[n.size] || SIZE_PX.md);
  const ff = FONT_STACKS[n.font] || 'inherit';
  edBody.style.setProperty('--ed-ff', ff === 'inherit' ? 'inherit' : ff);
}
function applyEditorAttr(kind) {
  // placeholder pseudo
  const hasContent = edBody.textContent.trim() || edBody.querySelector('.att');
  edBody.setAttribute('data-empty', hasContent ? '0' : '1');
}
document.addEventListener('selectionchange', () => { if (edOpen) updateToolbarState(); });

function markColor(c) {
  $$('.nc-swatch', edColorRow).forEach(b => b.classList.toggle('active', b.dataset.c === c));
}
edColorRow.addEventListener('click', e => {
  const b = e.target.closest('.nc-swatch');
  if (!b) return;
  const n = currentNote(); if (!n) return;
  n.color = b.dataset.c;
  markColor(n.color);
  scheduleSave();
});

/* ---- formatting ---- */
function exec(cmd, val) {
  edBody.focus();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, val);
  scheduleSave();
  updateToolbarState();
}
$$('#edToolbar [data-cmd]').forEach(b => {
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', () => exec(b.dataset.cmd));
});
function updateToolbarState() {
  $$('#edToolbar [data-cmd]').forEach(b => {
    try { b.classList.toggle('on', document.queryCommandState(b.dataset.cmd)); }
    catch (e) { /* ignore */ }
  });
}

/* font size cycle */
const sizeBtn = $('#sizeBtn');
sizeBtn.addEventListener('click', () => {
  const n = currentNote(); if (!n) return;
  const order = ['sm', 'md', 'lg'];
  n.size = order[(order.indexOf(n.size) + 1) % order.length];
  applyEditorStyle(n);
  sizeBtn.classList.toggle('on', n.size !== 'md');
  toast('حجم الخط: ' + ({ sm: 'صغير', md: 'متوسط', lg: 'كبير' })[n.size], 'info', 1100);
  scheduleSave();
});
/* font family cycle */
const fontBtn = $('#fontBtn');
fontBtn.addEventListener('click', () => {
  const n = currentNote(); if (!n) return;
  const order = ['default', 'serif', 'mono'];
  n.font = order[(order.indexOf(n.font) + 1) % order.length];
  applyEditorStyle(n);
  toast('الخط: ' + FONT_LABELS[n.font], 'info', 1100);
  scheduleSave();
});
function updateFontUI() {
  const n = currentNote(); if (!n) return;
  sizeBtn.classList.toggle('on', n.size !== 'md');
}

/* text/highlight color palettes */
const TEXT_COLORS = ['none', '#e5484d', '#ff6b1a', '#e59400', '#3a8f2e', '#2064a8', '#7048e8', '#c8446e', '#111827', '#6b7280'];
const HL_COLORS = ['none', '#fff176', '#cae86f', '#9be7de', '#9ec5fe', '#d0a8fc', '#ffabc4', '#ffcf9e'];
function paletteModal(colors, apply) {
  openModal(`
    <div class="modal-head"><h3>اختر لوناً</h3>
      <button class="icon-btn" data-x type="button" aria-label="إغلاق"><svg class="icon"><use href="#i-close"/></svg></button></div>
    <div class="modal-body">
      <div class="swatch-row">
        ${colors.map(c => c === 'none'
          ? '<button class="swatch none" data-c="none" type="button" aria-label="بلا لون"><svg class="icon sm" style="color:var(--text-3)"><use href="#i-close"/></svg></button>'
          : `<button class="swatch" data-c="${c}" type="button" style="--sw:${c}" aria-label="${c}"></button>`).join('')}
      </div>
    </div>`);
  $$('.swatch', modalEl).forEach(b => {
    b.onclick = () => {
      const c = b.dataset.c;
      document.removeEventListener('keydown', esc);
      closeModal();
      apply(c);
    };
  });
  const esc = ev => { if (ev.key === 'Escape') { closeModal(); } };
  document.addEventListener('keydown', esc);
  $('#modalBackdrop').onclick = () => { closeModal(); };
  $('[data-x]', modalEl).onclick = () => { closeModal(); };
}
$('#textColorBtn').addEventListener('click', () =>
  paletteModal(TEXT_COLORS, c => exec('foreColor', c === 'none' ? 'inherit' : c)));
$('#highlightBtn').addEventListener('click', () =>
  paletteModal(HL_COLORS, c => exec('hiliteColor', c === 'none' ? 'transparent' : c)));

/* ================= Emoji ================= */
const EMOJI_SETS = [
  ['وجهات 🙂', '😀 😃 😄 😁 😅 😂 🤣 😊 😍 🥰 😘 😎 🤩 😢 😭 😡 🤯 🥳 😴 🤔 🤗 😇 🙃 😤 😱 🤠 🤡 👻'],
  ['أيدي 👋', '👍 👎 👏 🙌 🤝 👌 🤞 ✌️ 🖖 🤙 💪 🫡 🙏 👋 🖐️ ✋ 🫶 👊 ✊ 🤛 🤜 🫰 👍'],
  ['قلوب 💛', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💖 💕 💓 💗 💞 💘 💝 💔 ❣️ 🔥 ⭐ ✨ 💫 🌟 💥'],
  ['حيوانات 🐱', '🐱 🐶 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦄 🐝 🦋 🐢 🐬 🐳 🦖 🐌 🐞'],
  ['طعام 🍕', '🍎 🍌 🍉 🍓 🍇 🍑 🥝 🥕 🌽 🍞 🧀 🍕 🍔 🌭 🍟 🧁 🍩 🍪 🍰 🍫 🍿 ☕ 🧃 🥤'],
  ['أشياء 📚', '📚 📖 📝 ✏️ 📌 📎 🔖 🏆 ⚽ 🎯 🎵 🎮 📱 💡 🔑 ⏰ 🌈 ☁️ ⚡ 🌙 ☂️ 🎁 ⚖️ 🚀'],
  ['رموز ✔️', '✔️ ✖️ ➕ ➖ ➗ ❓ ❗ ⚠️ ♻️ 🔱 🆗 🆕 🔝 🔜 ✳️ ✅ ❌ ➰ ➿ 🔔 🔕 📳 🔋 🆒']
];
let emojiPage = 0;
$('#emojiBtn').addEventListener('click', () => {
  emojiPage = 0;
  renderEmojiModal();
});
function renderEmojiModal() {
  const [name, ems] = EMOJI_SETS[emojiPage];
  const emos = ems.split(/\s+/).filter(Boolean);
  openModal(`
    <div class="modal-head">
      <div class="emoji-tabs">${EMOJI_SETS.map((s, i) => `<button class="emoji-tab${i === emojiPage ? ' active' : ''}" data-p="${i}" type="button" aria-label="${s[0]}">${s[0]}</button>`).join('')}</div>
      <button class="icon-btn" data-x type="button" aria-label="إغلاق"><svg class="icon"><use href="#i-close"/></svg></button></div>
    <div class="modal-body">
      <div class="emoji-grid">${emos.map(e => `<button class="emoji-cell" type="button">${e}</button>`).join('')}</div>
    </div>`);
  $$('.emoji-tab', modalEl).forEach(t => t.onclick = () => { emojiPage = +t.dataset.p; renderEmojiModal(); });
  $$('.emoji-cell', modalEl).forEach(c => {
    c.onclick = () => { exec('insertText', c.textContent); closeModal(); };
  });
  $('[data-x]', modalEl).onclick = () => closeModal();
  $('#modalBackdrop').onclick = () => closeModal();
}

/* ================= Cursor placement ================= */
function placeAtCursor(html) {
  edBody.focus();
  const sel = window.getSelection();
  let target = null;
  if (sel && sel.rangeCount && edBody.contains(sel.anchorNode)) target = sel.getRangeAt(0);
  if (!target) {
    target = document.createRange();
    target.selectNodeContents(edBody);
    target.collapse(false);
  }
  const frag = document.createElement('template');
  frag.innerHTML = html;
  target.deleteContents();
  target.insertNode(frag.content);
  target.collapse(false);
  const after = document.createElement('br');
  try { target.insertNode(after); } catch (e) { /* */ }
  scheduleSave();
  applyEditorAttr();
}

edBody.addEventListener('click', e => {
  const xbtn = e.target.closest('.att-x');
  if (!xbtn) return;
  e.preventDefault();
  e.stopPropagation();
  const holder = xbtn.closest('.att');
  if (!holder) return;
  holder.remove();
  scheduleSave();
  toast('تم إزالة الصورة 🖌', 'info', 1600);
});

/* ================= Draw mode ================= */
const DR_PENS = ['#222831', '#6b7280', '#e5484d', '#ff8a3d', '#e5b400', '#3a8f2e', '#22a89a', '#2064a8', '#7048e8', '#c8446e'];
const DR_SIZES = [3, 6, 11, 20];
const drawColors = $('#drawColors'), drawSizes = $('#drawSizes');
const dctx = drawCanvas.getContext('2d');
drawColors.innerHTML = DR_PENS.map(c =>
  `<button class="d-swatch${c === DR_PENS[0] ? ' active' : ''}" data-c="${c}" type="button" style="--dsw:${c}" aria-label="قلم ${c}"></button>`).join('');
drawSizes.innerHTML = DR_SIZES.map((s, i) =>
  `<button class="d-size${s === 6 ? ' active' : ''}" data-s="${s}" type="button" aria-label="سماكة ${s}"><i style="width:${Math.max(3, s)}px;height:${Math.max(3, s)}px"></i></button>`).join('');

$('#drawBtn').addEventListener('click', toggleDraw);
function toggleDraw() {
  if (!state.draw.on) enterDraw(); else exitDraw();
}
function enterDraw() {
  state.draw.on = true;
  $('#drawBtn').classList.add('on');
  drawArea.classList.remove('hidden');
  edBodyWrap.classList.add('hidden');
  setTimeout(sizeCanvas, 40);
}
function exitDraw() {
  state.draw.on = false;
  $('#drawBtn').classList.remove('on');
  drawArea.classList.add('hidden');
  edBodyWrap.classList.remove('hidden');
}
drawColors.addEventListener('click', e => {
  const b = e.target.closest('.d-swatch');
  if (!b) return;
  state.draw.color = b.dataset.c;
  state.draw.erase = false;
  $('#drawErase').classList.remove('on');
  $$('.d-swatch', drawColors).forEach(x => x.classList.toggle('active', x === b));
});
drawSizes.addEventListener('click', e => {
  const b = e.target.closest('.d-size');
  if (!b) return;
  state.draw.size = +b.dataset.s;
  state.draw.erase = false;
  $('#drawErase').classList.remove('on');
  $$('.d-size', drawSizes).forEach(x => x.classList.toggle('active', x === b));
});
$('#drawErase').addEventListener('click', () => {
  state.draw.erase = !state.draw.erase;
  $('#drawErase').classList.toggle('on', state.draw.erase);
});
$('#drawUndo').addEventListener('click', () => {
  state.draw.strokes.pop();
  redrawCanvas();
});
$('#drawDone').addEventListener('click', () => {
  if (!state.draw.strokes.length) { exitDraw(); return; }
  drawCanvas.toBlob(b => {
    if (!b) return;
    const att = { id: uid(), kind: 'draw', blob: b };
    state.pendingAtts.set(att.id, att);
    placeAtCursor(attPlaceholder(att));
    exitDraw();
  }, 'image/png');
});
function sizeCanvas() {
  const rect = drawCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  drawCanvas.width = Math.round(rect.width * dpr);
  drawCanvas.height = Math.round(rect.height * dpr);
  dctx.scale(dpr, dpr);
  dctx.lineCap = 'round';
  dctx.lineJoin = 'round';
  dctx.fillStyle = '#f8f9fc';
  dctx.fillRect(0, 0, rect.width, rect.height);
  redrawCanvas();
}
window.addEventListener('resize', () => { if (state.draw.on) sizeCanvas(); });

let drawing = false, last = null;
const canvasPos = e => {
  const r = drawCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
function redrawCanvas() {
  const rect = drawCanvas.getBoundingClientRect();
  dctx.fillStyle = '#f8f9fc';
  dctx.fillRect(0, 0, rect.width, rect.height);
  for (const s of state.draw.strokes) {
    strokePath(s);
  }
}
function strokePath(s) {
  dctx.strokeStyle = s.color;
  dctx.lineWidth = s.size;
  if (!s.pts.length) return;
  dctx.beginPath();
  const [p0, ...rest] = s.pts;
  dctx.moveTo(p0.x, p0.y);
  for (const p of rest) dctx.lineTo(p.x, p.y);
  dctx.stroke();
}
drawCanvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  drawCanvas.setPointerCapture(e.pointerId);
  drawing = true;
  last = canvasPos(e);
  const s = {
    color: state.draw.erase ? '#f8f9fc' : state.draw.color,
    size: state.draw.erase ? Math.max(24, state.draw.size * 2.6) : state.draw.size,
    pts: [last]
  };
  state.draw.strokes.push(s);
  dctx.strokeStyle = s.color;
  dctx.lineWidth = s.size;
  dctx.beginPath();
  dctx.arc(last.x, last.y, s.size / 2, 0, Math.PI * 2);
  dctx.fillStyle = s.color;
  dctx.fill();
});
drawCanvas.addEventListener('pointermove', e => {
  if (!drawing) return;
  const p = canvasPos(e);
  const dx = p.x - last.x, dy = p.y - last.y;
  if (dx * dx + dy * dy < 4) return;
  const s = state.draw.strokes[state.draw.strokes.length - 1];
  if (!s) return;
  s.pts.push(p);
  dctx.beginPath();
  dctx.moveTo(last.x, last.y);
  dctx.lineTo(p.x, p.y);
  dctx.stroke();
  last = p;
});
const endStroke = () => drawing = false;
drawCanvas.addEventListener('pointerup', endStroke);
drawCanvas.addEventListener('pointercancel', endStroke);

/* hydrate attachments of a note into DOM img/chips */
const ATT_X = `<button class="att-x" contenteditable="false" type="button" aria-label="إزالة المرفق" title="إزالة"><svg class="icon"><use href="#i-close"/></svg></button>`;
function hydrateAtts(n) {
  $$('.att', edBody).forEach(holder => {
    if (!$('.att-x', holder)) holder.insertAdjacentHTML('beforeend', ATT_X);
    holder.removeAttribute('data-hydrated');
  });
  $$('.att', edBody).forEach(holder => {
    if (holder.dataset.hydrated) return;
    holder.dataset.hydrated = '1';
    const id = holder.dataset.att;
    const kind = holder.dataset.kind;
    const att = (n.atts || []).find(a => a.id === id);
    if (!att || kind === 'audio') { holder.remove(); return; }
    if (kind === 'draw') {
      const img = $('img', holder);
      if (!img) return;
      if (!att._url || att._urlDead) {
        if (att._url) { URL.revokeObjectURL(att._url); att._url = null; }
        att._url = URL.createObjectURL(att.blob);
        att._urlDead = false;
      }
      img.src = att._url;
    }
  });
}

/* ================= Save ================= */
function flushSave() {
  if (!state.editingId) return;
  const n = currentNote();
  if (!n) return;
  const prevTitle = n.title;
  n.title = edTitle.value.trim();
  n.body = sanitizeBody(cleanBodyHtml(edBody.innerHTML));
  n.updated = Date.now();
  const newAtts = [];
  edBody.querySelectorAll('.att').forEach(holder => {
    const id = holder.dataset.att;
    if (!id) return;
    let a = state.pendingAtts.get(id) || (n.atts || []).find(x => x.id === id);
    if (a) {
      const copy = { id: a.id, kind: a.kind, blob: a.blob, dur: a.dur || 0, ext: a.ext || '' };
      newAtts.push(copy);
    }
  });
  const changedAtts = JSON.stringify((n.atts || []).map(a => a.id)) !== JSON.stringify(newAtts.map(a => a.id)) ||
    (n.atts || []).some(a => !a.blob && state.pendingAtts.get(a.id));
  n.atts = newAtts;
  state.pendingAtts = new Map();
  dbQuotaSafePut('notes', n).then(ok => { if (ok) showSaveDot(); });
  applyEditorAttr();
}
const scheduleSave = debounce(() => { if (edOpen) flushSave(); }, 650);
edBody.addEventListener('input', () => { scheduleSave(); applyEditorAttr(); });
edTitle.addEventListener('input', scheduleSave);
function showSaveDot() {
  saveDot.classList.add('show');
  setTimeout(() => saveDot.classList.remove('show'), 1500);
}

/* editor more menu */
$('#edMore').addEventListener('click', async () => {
  const n = currentNote(); if (!n) return;
  const items = [
    { key: 'pin', label: n.pinned ? 'إلغاء التثبيت' : 'تثبيت النوتة', icon: n.pinned ? '#i-pin-off' : '#i-pin' },
    { key: 'png', label: 'تصدير صورة PNG', icon: '#i-image' },
    { key: 'pdf', label: 'تصدير PDF', icon: '#i-download' },
    { key: 'txt', label: 'ملف نصي TXT', icon: '#i-doc' },
    { key: 'del', label: 'حذف النوتة', icon: '#i-trash', danger: true }
  ];
  flushSave();
  const choice = await menuDialog(n.title || 'بدون عنوان', items);
  if (!choice) return;
  if (choice === 'pin') {
    n.pinned = !n.pinned;
    await dbQuotaSafePut('notes', n);
    toast(n.pinned ? 'تم التثبيت 📌' : 'أُلغي التثبيت', 'info', 1200);
  } else if (choice === 'png') exportPNG(n);
  else if (choice === 'pdf') exportPDF(n);
  else if (choice === 'txt') exportTXT(n);
  else if (choice === 'del') {
    const ok = await confirmDialog({ title: 'حذف النوتة؟', message: 'سيتم الحذف نهائياً مع الرسم داخلها.', okText: 'حذف نهائي' });
    if (!ok) return;
    await dbDelete('notes', n.id).catch(() => {});
    state.editingId = null;
    state.notes = state.notes.filter(x => x.id !== n.id);
    closeEditor();
    renderGrid();
    toast('تم حذف النوتة 🗑', 'info', 1500);
  }
});

/* ================= Export engine ================= */
const EMPTY_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", Tahoma, Arial, sans-serif; }
`;
function notePalette(n) {
  const hex = colorHex(n.color || 'default');
  return hex || (document.documentElement.getAttribute('data-theme') === 'light' ? '#ffffff' : '#1c2436');
}
function textColor() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? '#232a3d' : '#eaf0fc';
}
function mutedColor() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? '#66708a' : '#90a0c4';
}
function buildExportFragments(n, attsData) {
  const d = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = n.title || 'بدون عنوان';
  title.style.cssText = `font-size:26px;font-weight:800;color:${textColor()};margin:0 0 10px;direction:rtl`;
  const body = document.createElement('div');
  body.innerHTML = n.body || '';
  body.style.cssText = `font-size:16px;line-height:1.9;color:${textColor()};direction:rtl;word-break:break-word`;
  body.querySelectorAll('.att').forEach(holder => {
    const id = holder.dataset.att;
    const att = (n.atts || []).find(a => a.id === id);
    if (!att) { holder.remove(); return; }
    if (att.kind === 'draw' && attsData[id]) {
      const img = document.createElement('img');
      img.setAttribute('src', attsData[id]);
      img.setAttribute('alt', 'رسمة');
      img.style.cssText = 'display:block;max-width:min(340px,62%);border-radius:14px;margin:10px 0';
      holder.replaceWith(img);
    } else {
      holder.remove();
    }
  });
  body.querySelectorAll('ul').forEach(u => u.style.cssText = 'margin:6px 22px;list-style:disc');
  return { titleEl: title, bodyEl: body };
}
async function attsToDataURLs(n) {
  const out = {};
  try {
    for (const a of (n.atts || [])) {
      if (a.kind !== 'draw' || !a.blob) continue;
      out[a.id] = await blobToDataURL(a.blob);
    }
  } catch (e) { /* ignore */ }
  return out;
}
const blobToDataURL = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = rej;
  fr.readAsDataURL(blob);
});

async function renderNoteCanvas(n) {
  const attsData = await attsToDataURLs(n);
  const { titleEl, bodyEl } = buildExportFragments(n, attsData);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-99999px;top:0;width:760px;';
  wrap.appendChild(titleEl); wrap.appendChild(bodyEl);
  document.body.appendChild(wrap);
  await document.fonts && document.fonts.ready;
  const H = Math.ceil(titleEl.offsetHeight + bodyEl.offsetHeight + 96);
  wrap.style.width = '800px';
  await new Promise(r => setTimeout(r, 60));
  const W = 800;
  const measureH = Math.ceil(titleEl.offsetHeight + bodyEl.offsetHeight) + 96;

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.setAttribute('dir', 'rtl');
  container.appendChild(titleEl.cloneNode(true));
  container.appendChild(bodyEl.cloneNode(true));
  const serialized = new XMLSerializer().serializeToString(
    (() => {
      const d2 = document.createElement('div');
      d2.appendChild(container);
      return d2.firstChild;
    })()
  );
  wrap.remove();

  const bg = notePalette(n);
  const tc = textColor();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${measureH > 120 ? measureH : 120}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml">
        <div style="background:${bg};font-family:'Noto Sans Arabic','Segoe UI',sans-serif;">
        ${serialized}
        </div>
      </div>
    </foreignObject>
  </svg>`;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = measureH * scale;
  const ctx = canvas.getContext('2d');
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.scale(scale, scale);
      rrect(ctx, 0, 0, W, measureH, 24);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.scale(1, 1);
      ctx.drawImage(img, 0, 0, W, measureH);
      resolve(canvas);
    };
    img.onerror = () => {
      ctx.scale(scale, scale);
      rrect(ctx, 0, 0, W, measureH, 24);
      ctx.fillStyle = bg;
      ctx.fill();
      resolve(canvas);
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' '));
  });
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
async function exportPNG(n) {
  toast('جاري تجهيز الصورة…', 'info', 1200);
  const canvas = await renderNoteCanvas(n);
  canvas.toBlob(b => {
    if (b) { downloadBlob(b, safeName(n.title || 'نوتة') + '.png'); toast('تم تصدير الصورة ✓', 'success'); }
    else toast('فشل التصدير', 'error');
  }, 'image/png');
}

/* handcrafted PDF: canvas JPEG embedded via DCTDecode */
async function exportPDF(n) {
  toast('جاري تجهيز PDF…', 'info', 1600);
  const canvas = await renderNoteCanvas(n);
  const jpegDataURL = canvas.toDataURL('image/jpeg', 0.92);
  const jpegBytes = dataURLToBytes(jpegDataURL);
  const iw = canvas.width, ih = canvas.height;
  const margin = 36;
  const pageW = 595.28;
  const imgW = pageW - margin * 2;
  const imgH = imgW * (ih / iw);
  const pageH = Math.ceil(margin + imgH + margin);
  const W = pageW.toFixed(2), H = pageH;
  const enc = s => {
    const bytes = [];
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 255);
    return bytes;
  };
  const objs = [];
  objs.push(enc('1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n'));
  objs.push(enc('2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n'));
  objs.push(enc(`3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources <</XObject <</Im0 4 0 R>>>> /Contents 5 0 R>>\nendobj\n`));
  const imgHdr = enc(`4 0 obj\n<</Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length}>>\nstream\n`);
  objs.push(imgHdr.concat(jpegBytes, enc('\nendstream\nendobj\n')));
  const content = `q ${imgW.toFixed(2)} 0 0 ${imgH.toFixed(2)} ${margin} ${(pageH - margin - imgH).toFixed(2)} cm /Im0 Do Q\n`;
  objs.push(enc(`5 0 obj\n<</Length ${content.length}>>\nstream\n${content}endstream\nendobj\n`));
  objs.push(enc('xref\n0 6\n0000000000 65535 f \n'));

  const parts = [enc('%PDF-1.4\n')];
  let offset = 4;
  const offsets = [0];
  for (const o of objs) { offsets.push(offset); parts.push(o); offset += o.length; }
  const xrefEntries = offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  parts.push(enc(xrefEntries));
  parts.push(enc(`trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${offset}\n%%EOF\n`));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const bin = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { bin.set(p, at); at += p.length; }
  downloadBlob(new Blob([bin], { type: 'application/pdf' }), safeName(n.title || 'نوتة') + '.pdf');
  toast('تم تصدير PDF ✓', 'success');
}
function dataURLToBytes(u) {
  const b64 = u.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function exportTXT(n) {
  const text = `${n.title || 'بدون عنوان'}\n${'─'.repeat(24)}\n\n${bodyText(n.body) || '—'}\n`;
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), safeName(n.title || 'نوتة') + '.txt');
  toast('تم تصدير الملف النصي ✓', 'success');
}

/* ================= Settings ================= */
const settingsBtn = $('#settingsBtn');
settingsBtn.addEventListener('click', openSettings);
function openSettings() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  openModal(`
    <div class="modal-head"><h3>الإعدادات ⚙️</h3>
      <button class="icon-btn" data-x type="button" aria-label="إغلاق"><svg class="icon"><use href="#i-close"/></svg></button></div>
    <div class="modal-body"><div class="set-list">
      <div class="set-item">
        <div class="info"><div class="t">المظهر</div><div class="d">الوضع الليلي أو النهاري</div></div>
        <div class="seg" role="group" aria-label="المظهر">
          <button class="seg-btn${isLight ? '' : ' active'}" data-theme-set="dark" type="button">🌙 داكن</button>
          <button class="seg-btn${isLight ? ' active' : ''}" data-theme-set="light" type="button">☀️ فاتح</button>
        </div>
      </div>
      <div class="set-item">
        <div class="info"><div class="t">الأنيميشن</div><div class="d">حركات الظهور والانتقالات</div></div>
        <button class="switch${prefs.anim !== 'off' ? ' on' : ''}" id="animSwitch" type="button" aria-label="تفعيل الأنيميشن"></button>
      </div>
      <div class="set-item">
        <div class="info"><div class="t">الخط الافتراضي</div><div class="d">للنوتات الجديدة</div></div>
        <div class="seg" role="group" aria-label="الخط الافتراضي">
          ${['default', 'serif', 'mono'].map(f => `<button class="seg-btn${prefs.defFont === f ? ' active' : ''}" data-font="${f}" type="button">${FONT_LABELS[f]}</button>`).join('')}
        </div>
      </div>
      <div class="set-item">
        <div class="info"><div class="t">الحجم الافتراضي</div><div class="d">للنوتات الجديدة</div></div>
        <div class="seg" role="group" aria-label="الحجم الافتراضي">
          ${['sm', 'md', 'lg'].map(s => `<button class="seg-btn${prefs.defSize === s ? ' active' : ''}" data-size="${s}" type="button">${{ sm: 'صغير', md: 'وسط', lg: 'كبير' }[s]}</button>`).join('')}
        </div>
      </div>
      <div class="set-item">
        <div class="info"><div class="t">لون النوتات الجديدة</div><div class="d">الشريط الأسفل لاختيار اللون داخل المحرر دايماً</div></div>
        <div class="swatch-row" style="padding:0">
          ${VC.map(c => c === 'default'
            ? `<button class="swatch none${prefs.defColor === 'default' ? ' active' : ''}" data-d-c="default" type="button" style="width:28px;height:28px"><svg class="icon sm" style="color:var(--text-3)"><use href="#i-close"/></svg></button>`
            : `<button class="swatch${prefs.defColor === c ? ' active' : ''}" data-d-c="${c}" type="button" style="--sw:var(--nc-${c});width:28px;height:28px"></button>`).join('')}
        </div>
      </div>
      <div class="set-item" style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="info"><div class="t">النسخ الاحتياطي</div><div class="d">ملف JSON يشمل كل النوتات والرسم</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn sm ghost" id="backupBtn" type="button" style="flex:1"><svg class="icon sm"><use href="#i-download"/></svg> تصدير نسخة</button>
          <button class="btn sm ghost" id="restoreBtn" type="button" style="flex:1"><svg class="icon sm"><use href="#i-up"/></svg> استيراد نسخة</button>
        </div>
      </div>
      <button class="btn sm danger" id="wipeBtn" type="button" style="width:100%;border:1.5px solid var(--danger-soft)">
        <svg class="icon sm"><use href="#i-trash"/></svg> مسح كل النوتات والإعدادات
      </button>
    </div></div>
    <div class="modal-foot"><span style="flex:1;font-size:11.5px;color:var(--text-3)">iNotes — يعمل أوفلاين 100% · نسخة v1.0.0</span></div>`);

  $$('[data-theme-set]', modalEl).forEach(b => b.onclick = () => {
    prefs.theme = b.dataset.themeSet; savePrefs(); applyTheme(prefs.theme);
    $$('.seg-btn[data-theme-set]', modalEl).forEach(x => x.classList.toggle('active', x === b));
  });
  $('#animSwitch').onclick = () => {
    prefs.anim = prefs.anim === 'off' ? 'on' : 'off';
    savePrefs(); applyAnim();
    $('#animSwitch').classList.toggle('on', prefs.anim !== 'off');
  };
  $$('[data-font]', modalEl).forEach(b => b.onclick = () => {
    prefs.defFont = b.dataset.font; savePrefs();
    $$('[data-font]', modalEl).forEach(x => x.classList.toggle('active', x === b));
  });
  $$('[data-size]', modalEl).forEach(b => b.onclick = () => {
    prefs.defSize = b.dataset.size; savePrefs();
    $$('[data-size]', modalEl).forEach(x => x.classList.toggle('active', x === b));
  });
  $$('[data-d-c]', modalEl).forEach(b => b.onclick = () => {
    prefs.defColor = b.dataset.d === undefined ? b.dataset.d || b.dataset['d-c'] || b.dataset.dc : b.dataset.d;
    prefs.defColor = b.getAttribute('data-d-c') || 'default';
    savePrefs();
    $$('[data-d-c]', modalEl).forEach(x => x.classList.toggle('active', x === b));
  });
  $('#backupBtn').onclick = exportBackup;
  $('#restoreBtn').onclick = () => $('#importFile').click();
  $('#wipeBtn').onclick = async () => {
    const ok = await confirmDialog({ title: 'تمسح كل حاجة؟', message: 'هيتم حذف كل النوتات (والرسم عليها) والإعدادات نهائياً. لا يمكن الرجوع!', okText: 'حذف نهائي' });
    if (!ok) return;
    const ok2 = await confirmDialog({ title: 'تأكيد أخير', message: 'هيتم مسح كل بيانات iNotes نهائياً.', okText: 'امسح الكل' });
    if (!ok2) return;
    await dbClear('notes').catch(() => {});
    state.notes = [];
    renderGrid();
    toast('تم مسح كل البيانات', 'success');
    closeModal();
  };
  $('[data-x]', modalEl).onclick = () => closeModal();
  $('#modalBackdrop').onclick = () => closeModal();
}

/* ================= Backup ================= */
async function exportBackup() {
  const notes = [];
  for (const n of state.notes) {
    const clone = { ...n, atts: [] };
    for (const a of (n.atts || [])) {
      const item = { ...a };
      if (a.blob) item.data = await blobToDataURL(a.blob);
      delete item.blob;
      clone.atts.push(item);
    }
    notes.push(clone);
  }
  const payload = { app: 'iNotes', v: 1, exported: Date.now(), notes, prefs };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const d = new Date();
  const name = `iNotes-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  downloadBlob(blob, name);
  toast('تم تصدير النسخة الاحتياطية ✓', 'success');
}
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    if (!data || data.app !== 'iNotes' || !Array.isArray(data.notes)) throw new Error('bad');
    const ok = await confirmDialog({
      title: 'استيراد نسخة؟',
      message: `الملف فيه ${data.notes.length} نوتة. هل تستبدل النوتات الحالية بالمحتوى ده؟`,
      okText: 'استيراد'
    });
    if (!ok) return;
    await dbClear('notes').catch(() => {});
    state.notes = [];
    for (const rn of data.notes) {
      const n = {
        id: rn.id || uid(),
        title: rn.title || '', body: sanitizeBody(rn.body || ''),
        color: VC.includes(rn.color) ? rn.color : 'default',
        pinned: !!rn.pinned,
        created: rn.created || Date.now(), updated: rn.updated || Date.now(),
        font: FONT_STACKS[rn.font] ? rn.font : 'default',
        size: SIZE_PX[rn.size] ? rn.size : 'md',
        atts: []
      };
      for (const ra of (rn.atts || [])) {
        if (ra.kind !== 'draw') continue;
        if (!ra.data) continue;
        try {
          const blob = await (await fetch(ra.data)).blob();
          n.atts.push({ id: ra.id || uid(), kind: ra.kind, blob, dur: ra.dur || 0, ext: ra.ext || '' });
        } catch (err) { /* skip */ }
      }
      state.notes.push(n);
    }
    if (data.prefs && typeof data.prefs === 'object') {
      ['theme', 'anim', 'defFont', 'defSize', 'defColor'].forEach(k => {
        if (k in data.prefs) prefs[k] = data.prefs[k];
      });
      savePrefs(); applyTheme(prefs.theme); applyAnim();
    }
    await Promise.all(state.notes.map(n => dbPut('notes', n)));
    renderGrid();
    toast(`تم استيراد ${state.notes.length} نوتة ✓`, 'success');
  } catch (err) {
    toast('تعذر استيراد الملف — تأكد إنه ملف نسخة iNotes صحيح', 'error', 3800);
  }
});

/* ================= Install / SW ================= */
const installBtn = $('#installBtn');
const installHint = $('#installHint');
let deferredPrompt = null;
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}
window.addEventListener('beforeinstallprompt', e => {
  window.__bipFired = true;
  deferredPrompt = e;
  e.preventDefault();
  if (!isStandalone()) installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const r = await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add('hidden');
  if (r && r.outcome === 'accepted') toast('تم تثبيت iNotes 🎉 افتحه من الشاشة الرئيسية', 'success', 3400);
});
$('#installHintDismiss').addEventListener('click', () => {
  installHint.classList.add('hidden');
  prefs.hintDismissed = true;
  savePrefs();
});
addEventListener('appinstalled', () => {
  installBtn.classList.add('hidden');
  installHint.classList.add('hidden');
});

const updateBanner = $('#updateBanner');
let updateWaiting = false;
function showUpdateBanner() { updateBanner.classList.remove('hidden'); }
$('#updateBtn').addEventListener('click', () => {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
  updateWaiting = true;
  navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
});
$('#updateDismiss').addEventListener('click', () => updateBanner.classList.add('hidden'));
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.search.indexOf('nosew') !== -1) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
    reg.addEventListener('updatefound', () => { reg.update(); });
    setInterval(() => { reg.update().catch(() => {}); }, 60000);
  }).catch(() => { /* offline dev? */ });
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && updateWaiting) location.reload();
  });
}

/* ================= Init ================= */
const fab = $('#fab');
fab.addEventListener('click', () => openEditor(null, { focus: 'title' }));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action="new-note"]');
  if (b) openEditor(null, { focus: 'title' });
});
$('#searchInput').addEventListener('input', e => {
  state.filter = e.target.value;
  $('#searchClear').classList.toggle('hidden', !state.filter);
  renderGrid();
});
$('#searchClear').addEventListener('click', () => {
  state.filter = '';
  $('#searchInput').value = '';
  $('#searchClear').classList.add('hidden');
  renderGrid();
  $('#searchInput').focus();
});

document.addEventListener('keydown', e => {
  if (!edOpen) return;
  if (e.key === 'Escape' && !modalRoot.hidden) return; // modal handles itself
  if (e.key === 'Escape' && state.draw.on) { exitDraw(); e.preventDefault(); return; }
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
});

async function init() {
  loadPrefs();
  applyTheme(prefs.theme === 'light' ? 'light' : 'dark');
  applyAnim();
  try { await openDB(); } catch (e) {
    toast('تعذر فتح قاعدة البيانات المحلية. جرّب متصفحاً حديثاً.', 'error', 5000);
    return;
  }
  try {
    let notes = await dbGetAll('notes');
    state.notes = (notes || []).filter(n => n && n.id).map(n => {
      n.atts = (n.atts || []).filter(a => a && a.blob instanceof Blob && a.kind !== 'audio');
      return n;
    }).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  } catch (e) {
    toast('خطأ أثناء قراءة نوتاتك المخزنة', 'error', 4000);
  }
  try { document.execCommand('defaultParagraphSeparator', false, 'br'); } catch (e) { /* */ }
  renderGrid();
  applyEditorAttr();
  checkInstallAvailability();
  registerSW();
  if (window.matchMedia('(display-mode: standalone)').matches) document.title = 'iNotes';
}
function checkInstallAvailability() {
  if (isStandalone()) { installBtn.classList.add('hidden'); installHint.classList.add('hidden'); return; }
  if (!window.__bipFired && !prefs.hintDismissed) {
    setTimeout(() => { if (!window.__bipFired && !isStandalone()) installHint.classList.remove('hidden'); }, 3200);
  }
}
init().then(() => { window.__ready = true; });
window.__inotes = state;
