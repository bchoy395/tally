// The transaction editor: payee QuickFill, categories or [Account] transfers, and splits.
import {
  api, state, h, clear, field, options, accountOptions, categoryInput, resolveCategoryText, ensureCategory, openDialog,
  confirmDialog, parseAmount, centsToInput, money, todayISO, catPath, accountName, getPayees, changed, toast,
} from './core.js';

const labelsFor = (acct) => (acct && acct.type === 'credit' ? ['Charge', 'Payment'] : ['Payment', 'Deposit']);

async function categoryFromText(text, amount) {
  const r = resolveCategoryText(text);
  if (r.error) throw new Error(r.error);
  if (r.create) {
    const ok = await confirmDialog(`"${r.create}" isn't a category yet. Create it?`, { title: 'New category', ok: 'Create category' });
    if (!ok) throw new Error('Pick an existing category or create the new one.');
    return { category_id: await ensureCategory(r.create, amount > 0 ? 'income' : 'expense') };
  }
  return r;
}

export async function openTxnEditor({ id = null, account_id = null, date = null, onSaved = null } = {}) {
  const open = state.accounts.filter((a) => !a.closed);
  if (!open.length) { toast('Add an account first.', 'error'); return; }
  let t = null, note = null;
  if (id) {
    t = await api(`/transactions/${id}`);
    if (t.split_parent_id) {
      note = `This is part of a split transaction in ${t.transfer_account_name}. You're editing the original.`;
      t = await api(`/transactions/${t.split_parent_id}`);
    }
  }
  const payees = await getPayees();
  const startAcct = t ? t.account_id : Number(account_id) || open[0].id;
  const acctOf = (aid) => state.accounts.find((a) => a.id === Number(aid));

  const acctSel = h('select', null, accountOptions(startAcct));
  const dateIn = h('input', { type: 'date', value: t ? t.date : date || todayISO(), required: true });
  const numIn = h('input', { type: 'text', value: t ? t.num : '', maxlength: 20, placeholder: 'Optional' });
  const payeeList = h('datalist', { id: 'dl-payees' }, payees.slice(0, 2000).map((p) => h('option', { value: p.payee })));
  const payeeIn = h('input', { type: 'text', value: t ? t.payee : '', autocomplete: 'off', maxlength: 200 });
  payeeIn.setAttribute('list', 'dl-payees');
  const outIn = h('input', { type: 'text', class: 'money', inputmode: 'decimal', placeholder: '0.00', value: t && t.amount < 0 ? centsToInput(t.amount) : '' });
  const inIn = h('input', { type: 'text', class: 'money', inputmode: 'decimal', placeholder: '0.00', value: t && t.amount > 0 ? centsToInput(t.amount) : '' });
  outIn.addEventListener('input', () => { if (outIn.value) inIn.value = ''; });
  inIn.addEventListener('input', () => { if (inIn.value) outIn.value = ''; });
  const initialCat = t && !t.split_count ? (t.transfer_account_id ? `[${t.transfer_account_name}]` : catPath(t.category_id)) : '';
  const cat = categoryInput({ value: initialCat, excludeAccount: startAcct, placeholder: 'Category, or [Account] for a transfer' });
  const memoIn = h('input', { type: 'text', value: t ? t.memo : '', maxlength: 1000 });
  const statusSel = h('select', null, options([['', 'Uncleared'], ['c', 'Cleared'], ['R', 'Reconciled']], t ? t.status : ''));
  const outLabel = h('span'), inLabel = h('span');
  const setLabels = () => { const [a, b] = labelsFor(acctOf(acctSel.value)); outLabel.textContent = a; inLabel.textContent = b; };
  setLabels();
  acctSel.addEventListener('change', setLabels);

  // Splits
  let splits = null; // [{cat, memo, amount}] when split mode is on
  let dir = t ? (t.amount > 0 ? 1 : -1) : -1;
  const splitBox = h('div', { class: 'splits hidden' });
  const splitBtn = h('button', { type: 'button', class: 'btn' }, 'Split…');
  const totalOut = h('b', { class: 'num' });
  const dirSeg = h('div', { class: 'seg' });

  const rowSum = () => (splits || []).reduce((s, r) => s + (parseAmount(r.amount.value) || 0), 0);
  function syncTotal() {
    const sum = rowSum();
    totalOut.textContent = money(sum * dir);
    const v = centsToInput(sum);
    if (dir < 0) { outIn.value = sum < 0 ? `-${v}` : v; inIn.value = ''; } else { inIn.value = sum < 0 ? `-${v}` : v; outIn.value = ''; }
  }
  function renderDir() {
    clear(dirSeg);
    const [a, b] = labelsFor(acctOf(acctSel.value));
    for (const [d, label] of [[-1, a], [1, b]]) {
      dirSeg.append(h('button', { type: 'button', class: dir === d ? 'on' : '', onclick: () => { dir = d; renderDir(); syncTotal(); } }, label));
    }
  }
  function addRow(r = { cat: '', memo: '', amount: '' }) {
    const ci = categoryInput({ value: r.cat, excludeAccount: Number(acctSel.value) });
    const row = { cat: ci.input, memo: h('input', { type: 'text', value: r.memo, placeholder: 'Memo' }), amount: h('input', { type: 'text', class: 'money', inputmode: 'decimal', value: r.amount, placeholder: '0.00' }) };
    row.amount.addEventListener('input', syncTotal);
    splits.push(row);
    return row;
  }
  function renderSplits() {
    clear(splitBox);
    const tbody = h('tbody');
    for (const row of splits) {
      tbody.append(h('tr', null,
        h('td', { style: { width: '42%' } }, row.cat.parentNode || h('span', { style: { display: 'contents' } }, row.cat, row.cat.nextSibling)),
        h('td', null, row.memo),
        h('td', { style: { width: '22%' } }, row.amount),
        h('td', { style: { width: '36px' } }, h('button', { type: 'button', class: 'btn ghost icon-btn sm', 'aria-label': 'Remove line', onclick: () => { splits.splice(splits.indexOf(row), 1); renderSplits(); syncTotal(); } }, '✕'))));
    }
    splitBox.append(h('table', null, tbody), h('div', { class: 'foot' },
      h('button', { type: 'button', class: 'btn sm', onclick: () => { addRow(); renderSplits(); splits[splits.length - 1].cat.focus(); } }, '+ Add line'),
      h('span', { class: 'muted' }, 'Direction'), dirSeg,
      h('span', { class: 'spacer' }),
      h('span', null, 'Total ', totalOut),
      h('button', { type: 'button', class: 'btn sm ghost', onclick: unsplit }, 'Remove split')));
    renderDir();
  }
  function enterSplit(lines) {
    splits = [];
    for (const l of lines) addRow(l);
    splitBox.classList.remove('hidden');
    cat.input.disabled = true; cat.input.value = ''; cat.input.placeholder = 'Split — see lines below';
    outIn.readOnly = true; inIn.readOnly = true;
    splitBtn.classList.add('hidden');
    renderSplits(); syncTotal();
  }
  function unsplit() {
    const first = splits && splits[0];
    splits = null;
    splitBox.classList.add('hidden');
    cat.input.disabled = false; cat.input.placeholder = 'Category, or [Account] for a transfer';
    if (first) cat.input.value = first.cat.value;
    outIn.readOnly = false; inIn.readOnly = false;
    splitBtn.classList.remove('hidden');
  }
  splitBtn.addEventListener('click', () => {
    const o = parseAmount(outIn.value), i = parseAmount(inIn.value);
    dir = i ? 1 : -1;
    const amt = Math.abs(i || o || 0);
    enterSplit([{ cat: cat.input.value, memo: '', amount: amt ? centsToInput(amt) : '' }, { cat: '', memo: '', amount: '' }]);
    splits[splits.length - 1].cat.focus();
  });
  const splitLine = (sp) => ({
    cat: sp.transfer_account_id ? `[${accountName(sp.transfer_account_id)}]` : catPath(sp.category_id),
    memo: sp.memo,
    amount: ((sp.amount * dir) / 100).toFixed(2),
  });

  // QuickFill from the payee's last transaction
  payeeIn.addEventListener('change', async () => {
    if (t || splits || outIn.value || inIn.value || cat.input.value) return;
    const p = payees.find((x) => x.payee.toLowerCase() === payeeIn.value.trim().toLowerCase());
    if (!p) return;
    payeeIn.value = p.payee;
    if (p.amount < 0) outIn.value = centsToInput(p.amount); else inIn.value = centsToInput(p.amount);
    if (p.split_count) {
      const full = await api(`/transactions/${p.id}`);
      dir = full.amount > 0 ? 1 : -1;
      enterSplit(full.splits.map(splitLine));
    } else if (p.transfer_account_id && p.transfer_account_id !== Number(acctSel.value)) cat.input.value = `[${accountName(p.transfer_account_id)}]`;
    else if (p.category_id) cat.input.value = catPath(p.category_id);
    outIn.select();
  });

  const [ol, il] = [outLabel, inLabel];
  const body = h('div', null,
    note ? h('div', { class: 'dlg-note' }, note) : null,
    h('div', { class: 'form-grid' },
      field('Account', acctSel, 'span-3'),
      field('Date', dateIn, 'span-2'),
      field('Num', numIn, 'span-1'),
      field('Payee', h('span', { style: { display: 'contents' } }, payeeIn, payeeList), 'span-6'),
      h('label', { class: 'field span-3' }, ol, outIn),
      h('label', { class: 'field span-3' }, il, inIn),
      h('label', { class: 'field span-6' }, h('span', null, 'Category'), h('div', { class: 'row' }, h('div', { class: 'grow', style: { display: 'flex' } }, cat.wrap), splitBtn)),
      field('Memo', memoIn, 'span-4'),
      field('Status', statusSel, 'span-2')),
    splitBox,
    h('p', { class: 'muted small', style: { margin: '12px 0 0' } }, 'Tip: type ', h('kbd', null, '['), ' in Category to transfer to another account. Amounts accept math like 12.40+3.'));
  cat.input.style.flex = '1';

  if (t && t.split_count) enterSplit(t.splits.map(splitLine));

  async function save(andNew) {
    if (!dateIn.value) throw new Error('Enter a date.');
    const payload = { account_id: Number(acctSel.value), date: dateIn.value, payee: payeeIn.value, memo: memoIn.value, num: numIn.value, status: statusSel.value };
    if (splits) {
      const lines = [];
      for (const r of splits) {
        const a = parseAmount(r.amount.value);
        if (a === null && !r.cat.value && !r.memo.value) continue;
        if (a === null) throw new Error('Every split line needs an amount.');
        const c = await categoryFromText(r.cat.value, a * dir);
        lines.push({ category_id: c.category_id ?? null, transfer_account_id: c.transfer_account_id ?? null, memo: r.memo.value, amount: a * dir });
      }
      if (!lines.length) throw new Error('Add at least one split line.');
      payload.splits = lines;
      payload.amount = lines.reduce((s, l) => s + l.amount, 0);
    } else {
      const o = parseAmount(outIn.value), i = parseAmount(inIn.value);
      if (o === null && i === null) throw new Error('Enter an amount.');
      payload.amount = (i || 0) - (o || 0);
      const c = await categoryFromText(cat.input.value, payload.amount);
      payload.category_id = c.category_id ?? null;
      payload.transfer_account_id = c.transfer_account_id ?? null;
      if (t && t.split_count) payload.splits = [];
    }
    const saved = t ? await api.put(`/transactions/${t.id}`, payload) : await api.post('/transactions', payload);
    await changed();
    if (onSaved) onSaved(saved);
    if (andNew) setTimeout(() => openTxnEditor({ account_id: payload.account_id, date: payload.date, onSaved }), 0);
    return true;
  }

  const left = [];
  if (t) {
    left.push(h('button', { type: 'button', class: 'btn danger', onclick: async () => {
      const msg = t.transfer_id || t.split_count ? 'This also removes the matching transfer in the other account.' : 'This transaction will be permanently removed.';
      if (!(await confirmDialog(msg, { title: 'Delete transaction?', ok: 'Delete', danger: true }))) return;
      try { await api.del(`/transactions/${t.id}`); dlg.close(); await changed(); toast('Transaction deleted.'); } catch (e) { dlg.setError(e.message); }
    } }, 'Delete'));
  }
  const dlg = openDialog({
    title: t ? 'Edit transaction' : 'New transaction',
    body, wide: true, left,
    actions: [
      { label: 'Cancel' },
      ...(t ? [] : [{ label: 'Save & new', onClick: () => save(true) }]),
      { label: 'Save', primary: true, submit: true, onClick: () => save(false) },
    ],
  });
  if (!t) payeeIn.focus();
  return dlg;
}
