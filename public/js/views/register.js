import {
  api, state, h, clear, money, fmtDate, fmtDateLong, pageHead, icon, categoryLabel, changed, toast, attempt, options, field,
  openDialog, confirmDialog, parseAmount, todayISO, RANGES, rangeDates, ACCOUNT_TYPES, navigate, editButton,
} from '../core.js';
import { openTxnEditor } from '../editor.js';
import { openAccountDialog, openAdjustDialog } from './accounts.js';
import { bulkBar, selectable, selectAllBox } from './bulk.js';

const prefs = new Map(); // per-account filters survive re-renders
let recon = null;        // { accountId, date, balance, checked: Set }

const STATUS_FILTERS = [['', 'Any status'], ['uncleared', 'Uncleared'], ['cleared', 'Cleared'], ['unreconciled', 'Not reconciled'], ['reconciled', 'Reconciled']];

function matches(t, p) {
  if (p.range !== 'all') {
    const { from, to } = rangeDates(p.range);
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
  }
  if (p.status === 'uncleared' && t.status !== '') return false;
  if (p.status === 'cleared' && t.status !== 'c') return false;
  if (p.status === 'reconciled' && t.status !== 'R') return false;
  if (p.status === 'unreconciled' && t.status === 'R') return false;
  if (p.q) {
    const q = p.q.toLowerCase();
    const amt = parseAmount(p.q);
    const hay = `${t.payee} ${t.memo} ${t.num} ${categoryLabel(t)}`.toLowerCase();
    if (!hay.includes(q) && !(amt && Math.abs(t.amount) === Math.abs(amt))) return false;
  }
  return true;
}

function startReconcile(acct) {
  const date = h('input', { type: 'date', value: todayISO() });
  const bal = h('input', { type: 'text', class: 'money', inputmode: 'decimal', placeholder: '0.00' });
  const liability = acct.type === 'credit' || acct.type === 'loan';
  openDialog({
    title: `Reconcile ${acct.name}`,
    body: h('div', null,
      h('p', { class: 'muted', style: { marginTop: 0 } },
        acct.last_reconciled_date ? `Last reconciled ${fmtDateLong(acct.last_reconciled_date)} at ${money(acct.last_reconciled_balance)}.` : 'This account has not been reconciled yet.',
        ' Enter the ending date and balance from your statement.'),
      h('div', { class: 'form-grid' },
        field('Statement ending date', date, 'span-3'),
        field(liability ? 'Statement balance owed' : 'Statement ending balance', bal, 'span-3'))),
    actions: [{ label: 'Cancel' }, { label: 'Start reconciling', primary: true, submit: true, onClick: () => {
      let b = parseAmount(bal.value);
      if (b === null) throw new Error('Enter the statement balance.');
      if (liability && b > 0) b = -b;
      recon = { accountId: acct.id, date: date.value, balance: b, checked: null };
      changed();
    } }],
  });
}

function reconcileView(el, acct, rows) {
  const liability = acct.type === 'credit' || acct.type === 'loan';
  const show = (c) => money(liability ? -c : c);
  const base = acct.opening_balance + rows.filter((t) => t.status === 'R').reduce((s, t) => s + t.amount, 0);
  const open = rows.filter((t) => t.status !== 'R' && t.date <= recon.date);
  if (!recon.checked) recon.checked = new Set(open.filter((t) => t.status === 'c').map((t) => t.id));
  const cleared = h('div', { class: 'v' }), diff = h('div', { class: 'v' });
  const finish = h('button', { class: 'btn primary' }, 'Finish');
  const update = () => {
    const c = base + open.filter((t) => recon.checked.has(t.id)).reduce((s, t) => s + t.amount, 0);
    const d = recon.balance - c;
    cleared.textContent = show(c);
    diff.textContent = money(Math.abs(d));
    diff.className = `v ${d === 0 ? 'pos' : 'neg'}`;
    finish.textContent = d === 0 ? 'Finish' : 'Finish with adjustment…';
    finish.onclick = async () => {
      if (d !== 0 && !(await confirmDialog(`The difference is ${money(Math.abs(d))}. Tally will add a "Reconciliation Adjustment" for that amount so the account matches your statement.`, { title: 'Add an adjustment?', ok: 'Add adjustment & finish' }))) return;
      const r = await attempt(() => api.post(`/accounts/${acct.id}/reconcile`, { statement_date: recon.date, statement_balance: recon.balance, txn_ids: [...recon.checked], adjust: d !== 0 }));
      if (!r) return;
      recon = null;
      toast('Reconciled. Nice work.');
      await changed();
    };
  };
  const tbody = h('tbody');
  for (const t of open) {
    const cb = h('input', { type: 'checkbox', checked: recon.checked.has(t.id), 'aria-label': `Cleared: ${t.payee}` });
    const tr = h('tr', { class: `click ${recon.checked.has(t.id) ? 'sel' : ''}` },
      h('td', { class: 'w-check' }, cb),
      h('td', { class: 'date' }, fmtDate(t.date)),
      h('td', { class: 'hide-sm muted' }, t.num),
      h('td', { class: 'payee' }, t.payee, t.memo ? h('div', { class: 'memo' }, t.memo) : null),
      h('td', { class: 'amt' }, t.amount < 0 ? money(-t.amount) : ''),
      h('td', { class: 'amt pos' }, t.amount > 0 ? money(t.amount) : ''));
    const toggle = () => {
      if (recon.checked.has(t.id)) recon.checked.delete(t.id); else recon.checked.add(t.id);
      cb.checked = recon.checked.has(t.id);
      tr.classList.toggle('sel', cb.checked);
      update();
    };
    tr.addEventListener('click', (e) => { if (e.target !== cb) toggle(); });
    cb.addEventListener('change', () => { if (cb.checked !== recon.checked.has(t.id)) toggle(); });
    tbody.append(tr);
  }
  const all = h('button', { class: 'btn sm', onclick: () => { open.forEach((t) => recon.checked.add(t.id)); changed(); } }, 'Check all');
  const none = h('button', { class: 'btn sm', onclick: () => { recon.checked.clear(); changed(); } }, 'Clear all');
  el.append(h('div', { class: 'callout', style: { marginBottom: '12px' } },
    h('span', { class: 'grow' }, `Check off each transaction that appears on your statement ending ${fmtDateLong(recon.date)}. Missing one? Add it with `, h('kbd', null, 'N'), '.'),
    all, none));
  el.append(h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Date'), h('th', { class: 'hide-sm' }, 'Num'), h('th', null, 'Payee'), h('th', { class: 'r' }, acct.type === 'credit' ? 'Charges' : 'Payments'), h('th', { class: 'r' }, acct.type === 'credit' ? 'Payments' : 'Deposits'))),
    tbody)), open.length ? null : h('div', { class: 'empty' }, 'No unreconciled transactions up to this date.')));
  el.append(h('div', { class: 'recon-bar' },
    h('div', null, h('div', { class: 'label' }, liability ? 'Statement balance owed' : 'Statement balance'), h('div', { class: 'v' }, show(recon.balance))),
    h('div', null, h('div', { class: 'label' }, liability ? 'Cleared balance owed' : 'Cleared balance'), cleared),
    h('div', null, h('div', { class: 'label' }, 'Difference'), diff),
    h('div'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { recon = null; changed(); } }, 'Cancel'), finish)));
  update();
}

export async function render(el, [idStr]) {
  const id = Number(idStr);
  const acct = state.accounts.find((a) => a.id === id);
  if (!acct) { el.append(h('div', { class: 'empty' }, 'That account no longer exists.')); return; }
  if (!prefs.has(id)) prefs.set(id, { q: '', range: 'all', status: '', limit: 300, selection: new Set() });
  const p = prefs.get(id);
  const { rows } = await api(`/transactions?account_id=${id}&limit=50000`);
  const liability = acct.type === 'credit' || acct.type === 'loan';
  const reconciling = recon && recon.accountId === id;

  el.append(pageHead(acct.name, [ACCOUNT_TYPES[acct.type], acct.institution, acct.closed ? 'Closed' : ''].filter(Boolean).join(' · '),
    h('button', { class: 'btn primary', onclick: () => openTxnEditor({ account_id: id }) }, icon('plus'), 'New'),
    reconciling ? null : h('button', { class: 'btn', onclick: () => startReconcile(acct) }, 'Reconcile'),
    ['investment', 'asset', 'loan'].includes(acct.type) ? h('button', { class: 'btn', onclick: () => openAdjustDialog(acct) }, 'Update balance') : null,
    h('button', { class: 'btn', onclick: () => navigate(`#/import?account_id=${id}`) }, 'Import'),
    h('button', { class: 'btn', onclick: () => openAccountDialog(acct) }, 'Edit account')));

  const show = (c) => money(liability ? -c : c);
  const tiles = [
    [liability ? 'Balance owed' : 'Balance', show(acct.balance), 'Through today'],
    ['Cleared', show(acct.cleared_balance), 'Cleared and reconciled only'],
  ];
  if (acct.ending_balance !== acct.balance) tiles.push(['After scheduled', show(acct.ending_balance), 'Including future-dated entries']);
  tiles.push(['Last reconciled', acct.last_reconciled_date ? fmtDateLong(acct.last_reconciled_date) : 'Never', acct.last_reconciled_date ? show(acct.last_reconciled_balance) : 'Match it to a statement']);
  el.append(h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
    tiles.map(([l, v, sub]) => h('div', { class: 'card tile' }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, v), h('div', { class: 'delta' }, sub)))));

  if (reconciling) return reconcileView(el, acct, rows);

  const filtered = rows.filter((t) => matches(t, p));
  const search = h('input', { type: 'search', placeholder: 'Search payee, memo, amount…', value: p.q, 'data-search': true });
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { p.q = search.value; p.limit = 300; p.refocus = true; p.selection.clear(); changed(); }, 250); });
  if (p.refocus) { p.refocus = false; requestAnimationFrame(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }); }
  const range = h('select', { onchange: (e) => { p.range = e.target.value; p.selection.clear(); changed(); } }, options(Object.entries(RANGES), p.range));
  const status = h('select', { onchange: (e) => { p.status = e.target.value; p.selection.clear(); changed(); } }, options(STATUS_FILTERS, p.status));
  const sum = filtered.reduce((s, t) => s + t.amount, 0);
  const filtering = p.q || p.range !== 'all' || p.status;

  const card = h('div', { class: 'card' },
    h('div', { class: 'filters' }, search, range, status, h('span', { class: 'spacer' }),
      h('span', { class: 'muted small' }, `${filtered.length.toLocaleString()} transaction${filtered.length === 1 ? '' : 's'}${filtering ? ` · net ${money(sum)}` : ''}`),
      h('a', { class: 'btn sm ghost', href: `/api/export.csv?account_id=${id}`, download: '' }, 'Export CSV')));

  const [outH, inH] = acct.type === 'credit' ? ['Charge', 'Payment'] : ['Payment', 'Deposit'];
  const shown = filtered.slice(0, p.limit);
  const visible = new Set(shown.map((t) => t.id));
  for (const sid of [...p.selection]) if (!visible.has(sid)) p.selection.delete(sid);
  const bar = bulkBar(p.selection);
  const tbody = h('tbody');
  const today = todayISO();
  for (const t of shown) {
    const cl = categoryLabel(t);
    const clr = h('button', { class: `clr ${t.status}`, title: { '': 'Uncleared — click to mark cleared', c: 'Cleared — click to unmark', R: 'Reconciled' }[t.status], 'aria-label': 'Toggle cleared' }, t.status === 'R' ? 'R' : t.status === 'c' ? 'c' : '');
    clr.addEventListener('click', async (e) => {
      e.stopPropagation();
      let next = t.status === '' ? 'c' : '';
      if (t.status === 'R' && !(await confirmDialog('This transaction was reconciled against a statement. Mark it uncleared? That will change your reconciled balance.', { title: 'Un-reconcile?', ok: 'Mark uncleared' }))) return;
      if (t.status === 'R') next = '';
      if (await attempt(() => api.post('/transactions/bulk', { ids: [t.id], action: 'status', value: next }))) changed();
    });
    const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${t.payee || 'transaction'}` });
    const tr = h('tr', { class: `click ${t.date > today ? 'future' : ''}` },
      h('td', { class: 'w-check' }, cb),
      h('td', { class: 'date' }, fmtDate(t.date)),
      h('td', { class: 'hide-sm muted' }, t.num),
      h('td', { class: 'payee' }, t.payee || h('span', { class: 'muted' }, '(no payee)'), t.memo ? h('div', { class: 'memo' }, t.memo) : null),
      h('td', { class: `cat hide-sm ${cl ? '' : 'uncat'}` }, cl || 'Uncategorized'),
      h('td', null, clr),
      h('td', { class: 'amt' }, t.amount < 0 ? money(-t.amount) : ''),
      h('td', { class: 'amt pos' }, t.amount > 0 ? money(t.amount) : ''),
      h('td', { class: `amt hide-sm ${t.running_balance < 0 && !liability ? 'neg' : ''}` }, show(t.running_balance)),
      editButton(t.payee || 'transaction', () => openTxnEditor({ id: t.id })));
    selectable(tr, cb, t.id, p.selection, bar);
    tbody.append(tr);
  }
  card.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, selectAllBox(shown, p.selection, bar, card)), h('th', null, 'Date'), h('th', { class: 'hide-sm' }, 'Num'), h('th', null, 'Payee'), h('th', { class: 'hide-sm' }, 'Category'),
      h('th', { title: 'Cleared status' }, 'Clr'), h('th', { class: 'r' }, outH), h('th', { class: 'r' }, inH), h('th', { class: 'r hide-sm' }, liability ? 'Owed' : 'Balance'), h('th', null, h('span', { class: 'sr-only' }, 'Edit')))),
    tbody)));
  if (!filtered.length) {
    card.append(h('div', { class: 'empty' }, rows.length ? 'No transactions match these filters.' : 'No transactions yet. Press N to add one, or import a statement.'));
  }
  if (filtered.length > p.limit) {
    card.append(h('div', { class: 'more' }, h('button', { class: 'btn', onclick: () => { p.limit += 1000; changed(); } }, `Show more (${(filtered.length - p.limit).toLocaleString()} older)`)));
  }
  el.append(card, bar);
  el.append(h('p', { class: 'muted small' }, 'Click rows to select them · ', h('kbd', null, 'N'), ' new transaction · ', h('kbd', null, '/'), ' search'));
}
