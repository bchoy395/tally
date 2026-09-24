import {
  api, h, money, fmtMonth, pageHead, changed, attempt, toast, qs, shiftMonth, monthEnd, todayISO, parseAmount, centsToInput,
} from '../core.js';

let showAll = false;

export async function render(el, [monthParam]) {
  const current = todayISO().slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam || '') ? monthParam : current;
  const b = await api(`/budget/${month}`);
  const from = `${month}-01`, to = monthEnd(month);

  // Every number on the page is bound to a function so edits update totals in place (no re-render, focus stays put).
  const binds = [];
  const bind = (fn) => { binds.push(fn); fn(); };
  const recalc = () => binds.forEach((fn) => fn());

  el.append(pageHead('Budget', null,
    h('div', { class: 'seg' },
      h('button', { type: 'button', 'aria-label': 'Previous month', onclick: () => { location.hash = `#/budget/${shiftMonth(month, -1)}`; } }, '‹'),
      h('button', { type: 'button', class: month === current ? 'on' : '', onclick: () => { location.hash = `#/budget/${current}`; } }, fmtMonth(month)),
      h('button', { type: 'button', 'aria-label': 'Next month', onclick: () => { location.hash = `#/budget/${shiftMonth(month, 1)}`; } }, '›')),
    h('button', { class: 'btn', onclick: async () => {
      const r = await attempt(() => api.post(`/budget/${month}/copy`, { from: shiftMonth(month, -1) }));
      if (r) { toast(r.copied ? `Copied ${r.copied} amounts from ${fmtMonth(shiftMonth(month, -1))}.` : 'Nothing new to copy.'); await changed(); }
    } }, 'Copy last month'),
    h('button', { class: 'btn', title: 'Sets empty categories to their 3-month average, rounded up to $10', onclick: async () => {
      const r = await attempt(() => api.post(`/budget/${month}/fill`));
      if (r) { toast(r.filled ? `Filled ${r.filled} categories from your 3-month averages.` : 'No empty categories with recent spending.'); await changed(); }
    } }, 'Fill from averages'),
    h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: showAll, onchange: (e) => { showAll = e.target.checked; changed(); } }), 'Show all categories')));

  const rows = b.rows;
  const sumOf = (list, k) => list.reduce((s, r) => s + r[k], 0);
  const expense = rows.filter((r) => r.kind === 'expense');
  const income = rows.filter((r) => r.kind === 'income');

  const tile = (label, valueFn, subFn) => {
    const v = h('div', { class: 'value' }), sub = h('div', { class: 'delta' });
    bind(() => { v.textContent = valueFn(); sub.textContent = subFn ? subFn() : ''; });
    return h('div', { class: 'card tile' }, h('div', { class: 'label' }, label), v, sub);
  };
  const spent = () => sumOf(expense, 'actual') + b.uncategorized.spending;
  el.append(h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
    tile('Budgeted spending', () => money(sumOf(expense, 'budget')), () => `${expense.filter((r) => r.budget).length} categories`),
    tile('Spent so far', () => money(spent()), () => (b.uncategorized.spending ? `incl. ${money(b.uncategorized.spending)} uncategorized` : '')),
    tile('Left to spend', () => { const l = sumOf(expense, 'budget') - spent(); return l < 0 ? `${money(-l)} over` : money(l); },
      () => (month === current ? `${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() - new Date().getDate()} days left in the month` : '')),
    tile('Income', () => money(sumOf(income, 'actual') + b.uncategorized.income), () => (sumOf(income, 'budget') ? `of ${money(sumOf(income, 'budget'))} expected` : ''))));

  const visible = (r) => showAll || r.budget || r.actual || r.avg3 > 0;
  const meterFor = (list, kind) => {
    const bar = h('span');
    const m = h('div', { class: 'meter' }, bar);
    bind(() => {
      const bud = sumOf(list, 'budget'), act = sumOf(list, 'actual');
      const pct = bud ? act / bud : act > 0 ? 1.01 : 0;
      bar.style.width = `${Math.min(100, Math.max(0, pct) * 100)}%`;
      m.className = `meter ${kind === 'income' ? (pct >= 1 ? 'good' : '') : pct > 1 ? 'over' : pct > 0.9 ? 'warn' : ''}`;
    });
    return m;
  };
  const leftCell = (list, kind) => {
    const td = h('td', { class: 'amt' });
    bind(() => {
      const bud = sumOf(list, 'budget'), act = sumOf(list, 'actual');
      td.replaceChildren();
      if (!bud) { td.append(h('span', { class: 'muted' }, '—')); return; }
      const left = bud - act;
      if (kind === 'expense' && left < 0) td.append(h('span', { class: 'badge bad' }, '▲ Over'), ' ', h('span', { class: 'neg' }, money(-left)));
      else if (kind === 'income' && left <= 0) td.append(h('span', { class: 'pos' }, `+${money(-left)}`));
      else td.append(money(left));
    });
    return td;
  };
  const actualLink = (list, catId, includeSub) => {
    const a = h('a', { href: `#/transactions${qs({ category_id: catId, from, to, include_sub: includeSub ? '' : 0 })}`, tabindex: '-1' });
    bind(() => { a.textContent = money(sumOf(list, 'actual')); });
    return h('td', { class: 'amt' }, a);
  };
  const budgetInput = (r) => {
    const input = h('input', { type: 'text', class: 'money budget-input', inputmode: 'decimal', value: r.budget ? centsToInput(r.budget) : '',
      placeholder: r.avg3 > 0 ? `avg ${Math.round(r.avg3 / 100)}` : '0', 'aria-label': `Budget for ${r.path}` });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', async () => {
      const v = input.value.trim() ? parseAmount(input.value) : 0;
      if (v === null || v < 0) { toast('Enter a positive amount.', 'error'); input.value = r.budget ? centsToInput(r.budget) : ''; return; }
      try {
        await api.put(`/budget/${month}/${r.id}`, { amount: v });
        r.budget = v;
        input.value = v ? centsToInput(v) : '';
        recalc();
      } catch (e) { toast(e.message, 'error'); }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    return h('td', { class: 'r' }, input);
  };

  function section(kind, list) {
    const tops = list.filter((r) => r.depth === 0);
    const tbody = h('tbody');
    for (const top of tops) {
      const group = list.filter((r) => r.top_id === top.id);
      if (!group.some(visible)) continue;
      const kids = group.filter((r) => r.id !== top.id);
      if (!kids.length) {
        tbody.append(h('tr', null, h('td', null, h('strong', null, top.name)), budgetInput(top), actualLink([top], top.id, false), leftCell([top], kind), h('td', { class: 'meter-cell' }, meterFor([top], kind))));
        continue;
      }
      const bud = h('td', { class: 'amt' });
      bind(() => { bud.textContent = money(sumOf(group, 'budget')); });
      tbody.append(h('tr', { class: 'group' }, h('td', null, top.name), bud, actualLink(group, top.id, true), leftCell(group, kind), h('td', { class: 'meter-cell' }, meterFor(group, kind))));
      for (const r of group) {
        if (!visible(r) && !(r.id === top.id && showAll)) continue;
        tbody.append(h('tr', null,
          h('td', { style: { paddingLeft: `${16 + r.depth * 16}px` } }, r.id === top.id ? h('span', { class: 'ink-2' }, `${top.name} (general)`) : r.name),
          budgetInput(r), actualLink([r], r.id, false), leftCell([r], kind), h('td', { class: 'meter-cell' }, meterFor([r], kind))));
      }
    }
    if (kind === 'expense' && b.uncategorized.spending) {
      tbody.append(h('tr', null, h('td', null, h('em', { class: 'muted' }, 'Uncategorized spending')), h('td'),
        h('td', { class: 'amt' }, h('a', { href: `#/transactions${qs({ uncategorized: 1, from, to })}` }, money(b.uncategorized.spending))), h('td'), h('td')));
    }
    return h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, kind === 'expense' ? 'Spending' : 'Income'), h('th', { class: 'r' }, 'Budget'), h('th', { class: 'r' }, kind === 'expense' ? 'Spent' : 'Received'), h('th', { class: 'r' }, kind === 'expense' ? 'Left' : 'To come'), h('th', null, ''))),
        tbody)),
      tbody.children.length ? null : h('div', { class: 'empty' }, 'No activity yet. Tick "Show all categories" to set budgets ahead of time.'));
  }
  el.append(section('expense', expense), section('income', income));
  el.append(h('p', { class: 'muted small' }, 'Type an amount and press Enter or Tab. Amounts in grey are your 3-month averages. Spending is net of refunds; transfers between your accounts don\'t count.'));
}
