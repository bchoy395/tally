import {
  api, h, field, options, openDialog, confirmDialog, parseAmount, centsToInput, todayISO, changed, toast, ACCOUNT_TYPES, navigate, money,
} from '../core.js';

// Liabilities are stored negative; people type what they owe as a positive number.
const isLiability = (type) => type === 'credit' || type === 'loan';

export function openAccountDialog(acct = null, { type = 'checking' } = {}) {
  const name = h('input', { type: 'text', value: acct ? acct.name : '', maxlength: 100, required: true, placeholder: 'e.g. Chase Checking' });
  const typeSel = h('select', null, options(Object.entries(ACCOUNT_TYPES), acct ? acct.type : type));
  const inst = h('input', { type: 'text', value: acct ? acct.institution : '', maxlength: 100, placeholder: 'Optional' });
  const opening = h('input', { type: 'text', class: 'money', inputmode: 'decimal', placeholder: '0.00',
    value: acct && acct.opening_balance ? centsToInput(acct.opening_balance) : '' });
  if (acct && acct.opening_balance < 0 && !isLiability(acct.type)) opening.value = `-${opening.value}`;
  if (acct && acct.opening_balance > 0 && isLiability(acct.type)) opening.value = `-${opening.value}`;
  const openingLabel = h('span');
  const setLabel = () => { openingLabel.textContent = isLiability(typeSel.value) ? 'Amount owed at start' : 'Starting balance'; };
  setLabel();
  typeSel.addEventListener('change', setLabel);
  const asOf = h('input', { type: 'date', value: acct ? acct.opening_date || '' : todayISO() });
  const notes = h('textarea', { rows: 2, maxlength: 2000 }, acct ? acct.notes : '');
  const closed = h('input', { type: 'checkbox', checked: acct ? !!acct.closed : false });

  const body = h('div', { class: 'form-grid' },
    field('Account name', name, 'span-4'),
    field('Type', typeSel, 'span-2'),
    field('Bank or institution', inst, 'span-6'),
    h('label', { class: 'field span-3' }, openingLabel, opening),
    field('As of', asOf, 'span-3'),
    field('Notes', notes, 'span-6'),
    acct ? h('label', { class: 'check span-6' }, closed, 'Account is closed (hide it from the sidebar and pickers)') : null,
    h('p', { class: 'muted small span-6', style: { margin: 0 } }, acct ? '' : 'Tip: to bring over history, create the account, then use Import with a QIF, OFX/QFX or CSV file from your bank or Quicken.'));

  const left = [];
  if (acct) {
    left.push(h('button', { type: 'button', class: 'btn danger', onclick: async () => {
      const ok = await confirmDialog(`Delete "${acct.name}" and its ${acct.txn_count} transactions? Transfers into other accounts become uncategorized. A backup is saved first.`,
        { title: 'Delete account?', ok: 'Delete account', danger: true });
      if (!ok) return;
      try { await api.del(`/accounts/${acct.id}`); dlg.close(); navigate('#/dashboard'); await changed(); toast('Account deleted.'); } catch (e) { dlg.setError(e.message); }
    } }, 'Delete account'));
  }

  const dlg = openDialog({
    title: acct ? `Edit ${acct.name}` : 'Add an account',
    body, left,
    actions: [{ label: 'Cancel' }, { label: acct ? 'Save' : 'Add account', primary: true, submit: true, onClick: async () => {
      let ob = opening.value.trim() ? parseAmount(opening.value) : 0;
      if (ob === null) throw new Error("Couldn't read the starting balance.");
      if (isLiability(typeSel.value)) ob = -ob;
      const payload = { name: name.value, type: typeSel.value, institution: inst.value, opening_balance: ob, opening_date: asOf.value || null, notes: notes.value, closed: closed.checked };
      const saved = acct ? await api.put(`/accounts/${acct.id}`, payload) : await api.post('/accounts', payload);
      await changed();
      if (!acct) navigate(`#/account/${saved.id}`);
      return true;
    } }],
  });
}

export function openAdjustDialog(acct) {
  const date = h('input', { type: 'date', value: todayISO() });
  const bal = h('input', { type: 'text', class: 'money', inputmode: 'decimal', placeholder: '0.00' });
  openDialog({
    title: `Update ${acct.name} balance`,
    body: h('div', null,
      h('p', { class: 'muted', style: { marginTop: 0 } }, `Current balance is ${money(acct.balance)}. Enter the value on your latest statement and Tally records the change as a balance adjustment (not counted as income or spending).`),
      h('div', { class: 'form-grid' }, field('Date', date, 'span-3'), field('New balance', bal, 'span-3'))),
    actions: [{ label: 'Cancel' }, { label: 'Update balance', primary: true, submit: true, onClick: async () => {
      let b = parseAmount(bal.value);
      if (b === null) throw new Error('Enter the new balance.');
      if (isLiability(acct.type) && b > 0) b = -b;
      const r = await api.post(`/accounts/${acct.id}/adjust`, { date: date.value, balance: b });
      await changed();
      toast(r ? `Recorded a ${money(r.amount, { signed: true })} adjustment.` : 'Balance already matches.');
      return true;
    } }],
  });
}
