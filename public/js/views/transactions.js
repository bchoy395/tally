import {
  api, state, h, money, fmtDate, pageHead, icon, categoryLabel, changed, attempt, options, accountOptions, categoryOptions,
  confirmDialog, qs, navigate, RANGES, rangeDates, todayISO, catPath, toast,
} from '../core.js';
import { openTxnEditor } from '../editor.js';

const selection = new Set();
let lastKey = '';
let refocus = false;

export async function render(el, _parts, query) {
  const f = Object.fromEntries(query);
  const key = query.toString();
  if (key !== lastKey) { selection.clear(); lastKey = key; }
  const limit = Number(f.limit) || 500;
  const data = await api(`/transactions${qs({ ...f, limit })}`);
  const set = (patch) => navigate(`#/transactions${qs({ ...f, ...patch, limit: '' })}`);

  const title = f.uncategorized ? 'Uncategorized transactions' : f.category_id ? catPath(Number(f.category_id)) || 'Transactions' : f.payee ? f.payee : 'Transactions';
  el.append(pageHead(title, f.category_id || f.payee || f.uncategorized ? h('a', { href: '#/transactions' }, 'Show all transactions') : 'Every account, searchable',
    h('button', { class: 'btn primary', onclick: () => openTxnEditor({ account_id: f.account_id }) }, icon('plus'), 'New transaction'),
    h('a', { class: 'btn', href: '/api/export.csv', download: '' }, 'Export CSV')));

  const search = h('input', { type: 'search', placeholder: 'Search payee, memo, amount…', value: f.q || '', 'data-search': true });
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { refocus = true; set({ q: search.value }); }, 300); });
  if (refocus) { refocus = false; requestAnimationFrame(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }); }
  const acct = h('select', { onchange: (e) => set({ account_id: e.target.value }) }, accountOptions(f.account_id, { blank: 'All accounts', includeClosed: true }));
  const cat = h('select', { onchange: (e) => set({ category_id: e.target.value, uncategorized: '' }) }, categoryOptions(f.category_id, { blank: 'All categories' }));
  const preset = Object.keys(RANGES).find((k) => k !== 'all' && rangeDates(k).from === (f.from || '') && rangeDates(k).to === (f.to || '')) || (f.from || f.to ? 'custom' : 'all');
  const range = h('select', { onchange: (e) => { if (e.target.value !== 'custom') set(rangeDates(e.target.value)); } },
    options([...Object.entries(RANGES), ...(preset === 'custom' ? [['custom', 'Custom']] : [])], preset));
  const from = h('input', { type: 'date', value: f.from || '', onchange: (e) => set({ from: e.target.value }), 'aria-label': 'From' });
  const to = h('input', { type: 'date', value: f.to || '', onchange: (e) => set({ to: e.target.value }), 'aria-label': 'To' });
  const unc = h('input', { type: 'checkbox', checked: !!f.uncategorized, onchange: (e) => set({ uncategorized: e.target.checked ? 1 : '', category_id: '' }) });

  const card = h('div', { class: 'card' },
    h('div', { class: 'filters' }, search, acct, cat, range, from, h('span', { class: 'muted' }, '–'), to, h('label', { class: 'check small' }, unc, 'Uncategorized only')),
    h('div', { class: 'filters small muted', style: { paddingTop: '8px', paddingBottom: '8px' } },
      `${data.total.toLocaleString()} transaction${data.total === 1 ? '' : 's'} · net ${money(data.sum)}`));

  const rows = data.rows;
  const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all shown', checked: rows.length > 0 && rows.every((t) => selection.has(t.id)) });
  const bulk = h('div', { class: 'bulkbar hidden' });
  const refreshBulk = () => {
    bulk.classList.toggle('hidden', selection.size === 0);
    bulk.firstChild && (bulk.firstChild.textContent = `${selection.size} selected`);
  };
  allBox.addEventListener('change', () => {
    for (const t of rows) if (allBox.checked) selection.add(t.id); else selection.delete(t.id);
    el.querySelectorAll('tbody input[type=checkbox]').forEach((cb) => { cb.checked = allBox.checked; cb.closest('tr').classList.toggle('sel', allBox.checked); });
    refreshBulk();
  });

  const tbody = h('tbody');
  const today = todayISO();
  for (const t of rows) {
    const cb = h('input', { type: 'checkbox', checked: selection.has(t.id), 'aria-label': 'Select' });
    const cl = categoryLabel(t);
    const tr = h('tr', { class: `click ${selection.has(t.id) ? 'sel' : ''} ${t.date > today ? 'future' : ''}`, onclick: (e) => { if (e.target !== cb) openTxnEditor({ id: t.id }); } },
      h('td', { class: 'w-check' }, cb),
      h('td', { class: 'date' }, fmtDate(t.date)),
      h('td', { class: 'payee' }, t.payee || h('span', { class: 'muted' }, '(no payee)'), t.memo ? h('div', { class: 'memo' }, t.memo) : null),
      h('td', { class: `cat ${cl ? '' : 'uncat'}` }, cl || 'Uncategorized'),
      h('td', { class: 'hide-sm ink-2' }, t.account_name),
      h('td', { class: 'hide-sm' }, t.status === 'R' ? h('span', { class: 'badge accent' }, 'R') : t.status === 'c' ? h('span', { class: 'badge' }, 'c') : ''),
      h('td', { class: `amt ${t.amount > 0 ? 'pos' : ''}` }, money(t.amount)));
    cb.addEventListener('change', () => { if (cb.checked) selection.add(t.id); else selection.delete(t.id); tr.classList.toggle('sel', cb.checked); refreshBulk(); });
    tbody.append(tr);
  }
  card.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, allBox), h('th', null, 'Date'), h('th', null, 'Payee'), h('th', null, 'Category'), h('th', { class: 'hide-sm' }, 'Account'), h('th', { class: 'hide-sm' }, 'Clr'), h('th', { class: 'r' }, 'Amount'))),
    tbody)));
  if (!rows.length) card.append(h('div', { class: 'empty' }, state.accounts.length ? 'No transactions match.' : 'Add an account to get started.'));
  if (data.total > rows.length) card.append(h('div', { class: 'more' }, h('button', { class: 'btn', onclick: () => navigate(`#/transactions${qs({ ...f, limit: limit + 1000 })}`) }, `Show more (${(data.total - rows.length).toLocaleString()} more)`)));
  el.append(card);

  // Bulk actions
  const bulkCat = h('select', null, categoryOptions('', { blank: 'Uncategorized' }));
  const run = async (body, msg) => {
    const r = await attempt(() => api.post('/transactions/bulk', { ids: [...selection], ...body }));
    if (!r) return;
    selection.clear();
    await changed();
    toast(`${msg(r.changed)}${r.skipped ? ` (${r.skipped} skipped — transfers and splits are edited one at a time)` : ''}`);
  };
  bulk.append(h('strong', null, ''),
    h('span', { class: 'spacer' }),
    bulkCat, h('button', { class: 'btn', onclick: () => run({ action: 'category', value: bulkCat.value || null }, (n) => `Categorized ${n}.`) }, 'Set category'),
    h('button', { class: 'btn', onclick: () => run({ action: 'status', value: 'c' }, (n) => `Marked ${n} cleared.`) }, 'Mark cleared'),
    h('button', { class: 'btn', onclick: () => run({ action: 'status', value: '' }, (n) => `Marked ${n} uncleared.`) }, 'Mark uncleared'),
    h('button', { class: 'btn danger', onclick: async () => {
      if (!(await confirmDialog(`Delete ${selection.size} transactions? Matching transfers in other accounts are removed too.`, { title: 'Delete transactions?', ok: 'Delete', danger: true }))) return;
      run({ action: 'delete' }, (n) => `Deleted ${n}.`);
    } }, 'Delete'),
    h('button', { class: 'btn ghost', onclick: () => { selection.clear(); changed(); } }, 'Clear selection'));
  el.append(bulk);
  refreshBulk();
}
