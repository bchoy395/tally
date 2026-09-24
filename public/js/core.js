// Shared plumbing: API calls, app state, formatting, DOM helpers, dialogs, toasts.

export const state = {
  accounts: [],
  categories: [],
  catById: new Map(),
  settings: { currency: 'USD' },
  payees: null,
};

/* ---------------------------------------------------------------- API */

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Tally': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}
api.post = (p, b = {}) => api(p, { method: 'POST', body: b });
api.put = (p, b = {}) => api(p, { method: 'PUT', body: b });
api.del = (p) => api(p, { method: 'DELETE' });

export async function loadState() {
  const [accounts, categories, settings] = await Promise.all([api('/accounts'), api('/categories'), api('/settings')]);
  state.accounts = accounts;
  state.categories = categories;
  state.catById = new Map(categories.map((c) => [c.id, c]));
  state.settings = settings;
  state.payees = null;
  moneyFmt = null;
}

export async function getPayees() {
  if (!state.payees) state.payees = await api('/payees');
  return state.payees;
}

// Views register a re-render hook; mutations call changed() so the sidebar and view stay current.
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function changed() {
  await loadState();
  for (const fn of listeners) await fn();
}

/* ---------------------------------------------------------------- formatting */

let moneyFmt = null;
function fmt() {
  if (!moneyFmt) {
    try { moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency }); }
    catch { moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }); }
  }
  return moneyFmt;
}
export function money(cents, { signed = false } = {}) {
  if (cents === null || cents === undefined) return '';
  const s = fmt().format(cents / 100);
  return signed && cents > 0 ? `+${s}` : s;
}
export function moneyCompact(cents) {
  const v = cents / 100;
  if (Math.abs(v) < 1000) return fmt().format(Math.round(v)).replace(/\.00$/, '').replace(/[.,]00(?=\D*$)/, '');
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  } catch { return String(Math.round(v)); }
}
// "12.50", "$1,200", "(40)", "10+2.5*2" → cents. Returns null when unreadable.
export function parseAmount(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^\d.,+\-*/() ]/g, '');
  if (/,\d{1,2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const v = evalArith(s);
  if (v === null || !Number.isFinite(v)) return null;
  const c = Math.round(v * 100);
  return neg ? -c : c;
}
function evalArith(src) {
  let i = 0;
  const peek = () => src[i];
  const skip = () => { while (src[i] === ' ') i++; };
  const num = () => {
    skip();
    if (peek() === '(') { i++; const v = expr(); skip(); if (src[i++] !== ')') throw 0; return v; }
    if (peek() === '-') { i++; return -num(); }
    if (peek() === '+') { i++; return num(); }
    const m = src.slice(i).match(/^\d*\.?\d+|^\d+\.?/);
    if (!m) throw 0;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const term = () => { let v = num(); for (;;) { skip(); const c = peek(); if (c === '*') { i++; v *= num(); } else if (c === '/') { i++; v /= num(); } else return v; } };
  const expr = () => { let v = term(); for (;;) { skip(); const c = peek(); if (c === '+') { i++; v += term(); } else if (c === '-') { i++; v -= term(); } else return v; } };
  try { const v = expr(); skip(); return i === src.length ? v : null; } catch { return null; }
}
export const centsToInput = (c) => (c === null || c === undefined || c === 0 ? '' : (Math.abs(c) / 100).toFixed(2));

const pad = (n) => String(n).padStart(2, '0');
export function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function isoToDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function dateToISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function addDays(iso, n) { const d = isoToDate(iso); d.setDate(d.getDate() + n); return dateToISO(d); }
export function shiftMonth(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export function monthEnd(ym) { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; }
export function fmtDate(iso, opts) {
  if (!iso) return '';
  const d = isoToDate(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
export const fmtDateLong = (iso) => fmtDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtMonth = (ym, long = true) => isoToDate(`${ym}-01`).toLocaleDateString(undefined, { month: long ? 'long' : 'short', year: 'numeric' });
export const fmtMonthShort = (ym) => isoToDate(`${ym}-01`).toLocaleDateString(undefined, { month: 'short' });

// Named date ranges used by filters and reports.
export const RANGES = {
  this_month: 'This month', last_month: 'Last month', last_30: 'Last 30 days', last_90: 'Last 90 days',
  ytd: 'Year to date', last_12: 'Last 12 months', last_year: 'Last year', all: 'All dates',
};
export function rangeDates(key) {
  const t = todayISO(), ym = t.slice(0, 7), y = Number(t.slice(0, 4));
  switch (key) {
    case 'this_month': return { from: `${ym}-01`, to: monthEnd(ym) };
    case 'last_month': { const p = shiftMonth(ym, -1); return { from: `${p}-01`, to: monthEnd(p) }; }
    case 'last_30': return { from: addDays(t, -29), to: t };
    case 'last_90': return { from: addDays(t, -89), to: t };
    case 'ytd': return { from: `${y}-01-01`, to: t };
    case 'last_12': return { from: `${shiftMonth(ym, -11)}-01`, to: monthEnd(ym) };
    case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: '', to: '' };
  }
}

export const ACCOUNT_TYPES = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash', credit: 'Credit card', loan: 'Loan / mortgage', asset: 'Property / other asset', investment: 'Investment / retirement',
};
export const ACCOUNT_GROUPS = [
  ['Banking', ['checking', 'savings', 'cash']],
  ['Credit cards', ['credit']],
  ['Investments', ['investment']],
  ['Property & assets', ['asset']],
  ['Loans', ['loan']],
];

export function catPath(id) { const c = state.catById.get(id); return c ? c.path : ''; }
export function accountName(id) { const a = state.accounts.find((x) => x.id === id); return a ? a.name : ''; }

// How a transaction's category column reads.
export function categoryLabel(t) {
  if (t.split_parent_id) return `Split from [${t.transfer_account_name}]`;
  if (t.transfer_id && t.transfer_account_name) return `[${t.transfer_account_name}]`;
  if (t.split_count) return `Split (${t.split_count})`;
  if (t.category_id) return catPath(t.category_id);
  return '';
}

/* ---------------------------------------------------------------- DOM */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

export function amountCell(cents, cls = '') {
  return h('td', { class: `amt ${cls} ${cents > 0 ? 'pos' : ''}` }, money(cents));
}

export function options(list, selected) {
  return list.map(([value, label]) => h('option', { value, selected: String(value) === String(selected ?? '') }, label));
}
export function accountOptions(selected, { blank = null, includeClosed = false, exclude = null } = {}) {
  const opts = [];
  if (blank !== null) opts.push(['', blank]);
  for (const a of state.accounts) if ((includeClosed || !a.closed || a.id === Number(selected)) && a.id !== exclude) opts.push([a.id, a.name]);
  return options(opts, selected);
}
export function categoryOptions(selected, { blank = 'Uncategorized', kinds = null } = {}) {
  const opts = blank === null ? [] : [['', blank]];
  for (const c of state.categories) if ((!kinds || kinds.includes(c.kind)) && (!c.hidden || c.id === Number(selected))) opts.push([c.id, `${' '.repeat(c.depth)}${c.name}`]);
  return options(opts, selected);
}

let dlId = 0;
// A datalist-backed input accepting "Category:Sub" paths or "[Account]" transfers.
export function categoryInput({ value = '', excludeAccount = null, allowTransfer = true, placeholder = 'Category' } = {}) {
  const id = `dl-cat-${++dlId}`;
  const list = h('datalist', { id });
  for (const c of state.categories) if (!c.hidden) list.append(h('option', { value: c.path }));
  if (allowTransfer) for (const a of state.accounts) if (!a.closed && a.id !== excludeAccount) list.append(h('option', { value: `[${a.name}]` }, 'Transfer'));
  const input = h('input', { type: 'text', value, placeholder, autocomplete: 'off' });
  input.setAttribute('list', id);
  return { input, list, wrap: h('span', { style: { display: 'contents' } }, input, list) };
}
// Resolves category-input text: {category_id} | {transfer_account_id} | {create} | {} for blank.
export function resolveCategoryText(text) {
  const t = String(text || '').trim();
  if (!t) return {};
  const tr = t.match(/^\[(.+)\]$/);
  if (tr) {
    const a = state.accounts.find((x) => x.name.toLowerCase() === tr[1].trim().toLowerCase());
    return a ? { transfer_account_id: a.id } : { error: `There's no account named "${tr[1]}".` };
  }
  const lower = t.toLowerCase().replace(/\s*:\s*/g, ':');
  const exact = state.categories.find((c) => c.path.toLowerCase() === lower);
  if (exact) return { category_id: exact.id };
  const leaf = state.categories.filter((c) => c.name.toLowerCase() === lower);
  if (leaf.length === 1) return { category_id: leaf[0].id };
  return { create: t.replace(/\s*:\s*/g, ':') };
}
export async function ensureCategory(path, kind) {
  const { id } = await api.post('/categories/ensure', { path, kind });
  await loadState();
  return id;
}

/* ---------------------------------------------------------------- dialogs */

export function openDialog({ title, body, actions = [], wide = false, onClose, left = [] }) {
  const dlg = h('dialog', { class: wide ? 'wide' : '' });
  const err = h('div', { class: 'error-text', role: 'alert' });
  const foot = h('div', { class: 'dlg-foot' }, ...left, h('div', { class: 'spacer' }), err);
  const close = () => { dlg.close(); };
  const btns = actions.map((a) => {
    const b = h('button', { type: a.submit ? 'submit' : 'button', class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}` }, a.label);
    if (!a.submit) b.addEventListener('click', () => (a.onClick ? run(a.onClick) : close()));
    return b;
  });
  foot.append(...btns);
  const form = h('form', { class: 'dlg', method: 'dialog', novalidate: true },
    h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { type: 'button', class: 'btn ghost icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'dlg-body' }, body),
    foot);
  const submitAction = actions.find((a) => a.submit);
  let busy = false;
  async function run(fn) {
    if (busy) return;
    busy = true; err.textContent = '';
    btns.forEach((b) => { b.disabled = true; });
    try {
      const r = await fn();
      if (r !== false) close();
    } catch (e) { err.textContent = e.message; }
    finally { busy = false; btns.forEach((b) => { b.disabled = false; }); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); if (submitAction) run(submitAction.onClick); });
  dlg.append(form);
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('.dlg-body input:not([type=hidden]):not([readonly]), .dlg-body select, .dlg-body textarea');
  if (first) first.focus();
  return { dlg, close, setError: (m) => { err.textContent = m; }, run };
}

export function confirmDialog(message, { title = 'Are you sure?', ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    openDialog({
      title,
      body: h('p', { style: { margin: '4px 0' } }, message),
      actions: [{ label: 'Cancel' }, { label: ok, primary: !danger, danger, submit: true, onClick: () => { answer = true; } }],
      onClose: () => resolve(answer),
    });
  });
}

export function toast(message, type = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: `toast ${type}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3200);
}
export async function attempt(fn, success) {
  try { const r = await fn(); if (success) toast(success); return r; }
  catch (e) { toast(e.message, 'error'); return undefined; }
}

export function field(label, control, cls = '') {
  return h('label', { class: `field ${cls}` }, h('span', null, label), control);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsText(file);
  });
}

export const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  budget: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.5 6.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  logo: '<path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19V3"/>',
};
export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span.firstChild;
}

export function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', { class: 'titles' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
    h('div', { class: 'row wrap' }, ...actions));
}

export function navigate(hash) { if (location.hash !== hash) location.hash = hash; }
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}
export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== null && v !== undefined && v !== false) p.set(k, v);
  const s2 = p.toString();
  return s2 ? `?${s2}` : '';
}

export function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('tally-theme') || 'auto'; } catch {}
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}

export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;

// The per-row Edit button (rows themselves select, they don't open).
export function editButton(what, onclick) {
  return h('td', { class: 'act' }, h('button', { type: 'button', class: 'btn sm', 'aria-label': `Edit ${what}`, onclick: (e) => { e.stopPropagation(); onclick(); } }, 'Edit'));
}
