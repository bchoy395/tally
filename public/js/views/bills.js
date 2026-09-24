import {
  api, state, h, money, fmtDate, pageHead, icon, changed, attempt, toast, options, accountOptions, field, openDialog, confirmDialog,
  categoryInput, resolveCategoryText, ensureCategory, parseAmount, centsToInput, todayISO, catPath,
} from '../core.js';

const FREQ = [['monthly', 'Monthly'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly'], ['once', 'Once']];
const freqLabel = Object.fromEntries(FREQ);

function openScheduleDialog(s = null) {
  if (!state.accounts.some((a) => !a.closed)) { toast('Add an account first.', 'error'); return; }
  const acct = h('select', null, accountOptions(s ? s.account_id : ''));
  const payee = h('input', { type: 'text', value: s ? s.payee : '', maxlength: 200, placeholder: 'e.g. Electric company' });
  const out = h('input', { type: 'text', class: 'money', inputmode: 'decimal', placeholder: '0.00', value: s && s.amount < 0 ? centsToInput(s.amount) : '' });
  const inn = h('input', { type: 'text', class: 'money', inputmode: 'decimal', placeholder: '0.00', value: s && s.amount > 0 ? centsToInput(s.amount) : '' });
  out.addEventListener('input', () => { if (out.value) inn.value = ''; });
  inn.addEventListener('input', () => { if (inn.value) out.value = ''; });
  const cat = categoryInput({ value: s ? (s.transfer_account_id ? `[${s.transfer_account_name}]` : s.category_path || '') : '' });
  const freq = h('select', null, options(FREQ, s ? s.frequency : 'monthly'));
  const next = h('input', { type: 'date', value: s ? s.next_date : todayISO() });
  const end = h('input', { type: 'date', value: s ? s.end_date || '' : '' });
  const memo = h('input', { type: 'text', value: s ? s.memo : '' });
  const auto = h('input', { type: 'checkbox', checked: s ? !!s.auto_enter : false });
  const left = s ? [h('button', { type: 'button', class: 'btn danger', onclick: async () => {
    if (!(await confirmDialog(`Stop scheduling "${s.payee}"? Transactions already entered stay.`, { title: 'Delete schedule?', ok: 'Delete', danger: true }))) return;
    await attempt(() => api.del(`/scheduled/${s.id}`)); dlg.close(); await changed();
  } }, 'Delete')] : [];
  const dlg = openDialog({
    title: s ? 'Edit scheduled transaction' : 'Schedule a bill or deposit',
    left,
    body: h('div', { class: 'form-grid' },
      field('Payee', payee, 'span-4'), field('Account', acct, 'span-2'),
      field('Payment', out, 'span-3'), field('Deposit', inn, 'span-3'),
      field('Category', cat.wrap, 'span-6'),
      field('Repeats', freq, 'span-2'), field('Next date', next, 'span-2'), field('Ends (optional)', end, 'span-2'),
      field('Memo', memo, 'span-6'),
      h('label', { class: 'check span-6' }, auto, 'Enter automatically on the due date (good for paychecks and autopay)')),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: async () => {
      const o = parseAmount(out.value), i = parseAmount(inn.value);
      if (o === null && i === null) throw new Error('Enter an amount.');
      const amount = (i || 0) - (o || 0);
      let c = resolveCategoryText(cat.input.value);
      if (c.error) throw new Error(c.error);
      if (c.create) c = { category_id: await ensureCategory(c.create, amount > 0 ? 'income' : 'expense') };
      const body = { account_id: Number(acct.value), payee: payee.value, amount, category_id: c.category_id ?? null, transfer_account_id: c.transfer_account_id ?? null,
        frequency: freq.value, next_date: next.value, end_date: end.value || null, memo: memo.value, auto_enter: auto.checked };
      if (s) await api.put(`/scheduled/${s.id}`, body); else await api.post('/scheduled', body);
      await changed();
      return true;
    } }],
  });
}

export async function render(el) {
  const [list, upcoming] = await Promise.all([api('/scheduled'), api('/scheduled/upcoming?days=45')]);
  el.append(pageHead('Bills & recurring', 'Scheduled bills, paychecks and transfers', h('button', { class: 'btn primary', onclick: () => openScheduleDialog() }, icon('plus'), 'Schedule')));
  const catText = (s) => (s.transfer_account_id ? `[${s.transfer_account_name}]` : s.category_path || 'Uncategorized');

  const up = h('div', { class: 'card', style: { marginBottom: '16px' } }, h('div', { class: 'card-head' }, h('h2', null, 'Next 45 days')));
  if (!upcoming.length) up.append(h('div', { class: 'empty' }, 'Nothing scheduled.'));
  else {
    const tb = h('tbody');
    let running = 0;
    for (const u of upcoming) {
      running += u.amount;
      tb.append(h('tr', null,
        h('td', { class: 'date' }, fmtDate(u.date), u.overdue ? [' ', h('span', { class: 'badge bad' }, 'Overdue')] : null),
        h('td', null, u.payee, h('div', { class: 'memo' }, `${u.account_name} · ${catText(u)}`)),
        h('td', { class: 'hide-sm' }, u.auto_enter ? h('span', { class: 'badge accent' }, 'Auto') : ''),
        h('td', { class: `amt ${u.amount > 0 ? 'pos' : ''}` }, money(u.amount)),
        h('td', { class: 'amt hide-sm muted' }, money(running)),
        h('td', { class: 'r' }, u.is_next ? h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn sm', onclick: async () => { if (await attempt(() => api.post(`/scheduled/${u.id}/enter`), `Entered ${u.payee}.`)) await changed(); } }, 'Enter'),
          h('button', { class: 'btn sm ghost', onclick: async () => { if (await attempt(() => api.post(`/scheduled/${u.id}/skip`), 'Skipped this one.')) await changed(); } }, 'Skip')) : null)));
    }
    up.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'Due'), h('th', null, 'Payee'), h('th', { class: 'hide-sm' }, ''), h('th', { class: 'r' }, 'Amount'), h('th', { class: 'r hide-sm' }, 'Cumulative'), h('th', null, ''))),
      tb)));
  }
  el.append(up);

  const all = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'All schedules')));
  if (!list.length) all.append(h('div', { class: 'empty' }, 'Schedule rent, subscriptions and paychecks so they show up here before they hit your account.'));
  else {
    all.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'Payee'), h('th', null, 'Repeats'), h('th', null, 'Next'), h('th', { class: 'hide-sm' }, 'Account'), h('th', { class: 'hide-sm' }, 'Category'), h('th', { class: 'r' }, 'Amount'))),
      h('tbody', null, list.map((s) => h('tr', { class: 'click', onclick: () => openScheduleDialog(s) },
        h('td', null, s.payee, s.auto_enter ? [' ', h('span', { class: 'badge accent' }, 'Auto')] : null),
        h('td', { class: 'ink-2' }, freqLabel[s.frequency], s.end_date ? h('div', { class: 'memo' }, `until ${fmtDate(s.end_date)}`) : null),
        h('td', { class: 'date' }, fmtDate(s.next_date)),
        h('td', { class: 'hide-sm ink-2' }, s.account_name),
        h('td', { class: 'cat hide-sm' }, catText(s)),
        h('td', { class: `amt ${s.amount > 0 ? 'pos' : ''}` }, money(s.amount))))))));
  }
  el.append(all);
}
