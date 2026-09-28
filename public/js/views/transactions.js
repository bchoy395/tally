import {
  api, state, h, money, fmtDate, pageHead, icon, categoryLabel, options, accountOptions, categoryOptions,
  qs, navigate, RANGES, rangeDates, todayISO, catPath, editButton, sortableTable,
} from '../core.js';
import { openTxnEditor } from '../editor.js';
import { bulkBar, selectable, selectAllBox } from './bulk.js';

const selection = new Set();
let lastKey = '';
let refocus = false;

export async function render(el, _parts, query) {
  const f = Object.fromEntries(query);
  const key = query.toString();
  if (key !== lastKey) { selection.clear(); lastKey = key; }
  const limit = Number(f.limit) || 500;
  // Fetch every match so sorting covers all of them; only the first `limit` rows are drawn.
  const data = await api(`/transactions${qs({ ...f, limit: 50000 })}`);
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
  const bar = bulkBar(selection);
  const today = todayISO();
  const renderRow = (t) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${t.payee || 'transaction'}` });
    const cl = categoryLabel(t);
    const tr = h('tr', { class: `click ${t.date > today ? 'future' : ''}` },
      h('td', { class: 'w-check' }, cb),
      h('td', { class: 'date' }, fmtDate(t.date)),
      h('td', { class: 'payee' }, t.payee || h('span', { class: 'muted' }, '(no payee)'), t.memo ? h('div', { class: 'memo' }, t.memo) : null),
      h('td', { class: `cat ${cl ? '' : 'uncat'}` }, cl || 'Uncategorized'),
      h('td', { class: 'hide-sm ink-2' }, t.account_name),
      h('td', { class: 'hide-sm' }, t.status === 'R' ? h('span', { class: 'badge accent' }, 'R') : t.status === 'c' ? h('span', { class: 'badge' }, 'c') : ''),
      h('td', { class: `amt ${t.amount > 0 ? 'pos' : ''}` }, money(t.amount)),
      editButton(t.payee || 'transaction', () => openTxnEditor({ id: t.id })));
    selectable(tr, cb, t.id, selection, bar);
    return tr;
  };
  const allBox = selectAllBox(selection, bar, card);
  const table = sortableTable({
    id: 'transactions', rows, renderRow, limit, defaultSort: { key: 'date', dir: 'desc' },
    columns: [
      { head: allBox },
      { label: 'Date', key: 'date', value: (t) => [t.date, t.id] },
      { label: 'Payee', key: 'payee', value: (t) => t.payee || null },
      { label: 'Category', key: 'category', value: (t) => categoryLabel(t) || null },
      { label: 'Account', key: 'account', cls: 'hide-sm', value: (t) => t.account_name },
      { label: 'Clr', key: 'status', cls: 'hide-sm', value: (t) => ({ '': 0, c: 1, R: 2 })[t.status] },
      { label: 'Amount', key: 'amount', cls: 'r', value: (t) => t.amount },
      { head: h('span', { class: 'sr-only' }, 'Edit') },
    ],
    onBody: () => { allBox.sync(); bar.refresh(); },
  });
  card.append(h('div', { class: 'table-wrap' }, table.table));
  if (!rows.length) card.append(h('div', { class: 'empty' }, state.accounts.length ? 'No transactions match.' : 'Add an account to get started.'));
  if (rows.length > limit) card.append(h('div', { class: 'more' }, h('button', { class: 'btn', onclick: () => navigate(`#/transactions${qs({ ...f, limit: limit + 1000 })}`) }, `Show more (${(rows.length - limit).toLocaleString()} more)`)));
  if (data.total > rows.length) card.append(h('p', { class: 'muted small', style: { padding: '0 16px' } }, `Showing the ${rows.length.toLocaleString()} most recent matches. Narrow the dates or search to see older ones.`));
  el.append(card, h('p', { class: 'muted small' }, 'Click rows to select them, then act on them together below. Use Edit to change one. Click a column heading to sort.'), bar);
}
