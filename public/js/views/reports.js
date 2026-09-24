import { api, h, money, fmtMonth, fmtMonthShort, fmtDateLong, pageHead, options, qs, RANGES, rangeDates, monthEnd } from '../core.js';
import { barList, columnChart, areaChart } from '../charts.js';

const TABS = [['spending', 'Spending'], ['income', 'Income'], ['payees', 'Payees'], ['cashflow', 'Income vs spending'], ['networth', 'Net worth']];

function go(tab, query) { location.hash = `#/reports/${tab}${qs(query)}`; }

function tabs(active, query) {
  return h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, label]) =>
    h('a', { href: `#/reports/${k}${qs({ range: query.range, from: query.from, to: query.to })}`, class: k === active ? 'on' : '', role: 'tab', 'aria-selected': k === active ? 'true' : 'false' }, label)));
}

async function breakdown(el, tab, q) {
  const custom = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.to || '');
  const range = custom ? 'custom' : q.range && RANGES[q.range] && q.range !== 'all' ? q.range : 'this_month';
  const group = tab === 'payees' ? 'payee' : q.group === 'top' ? 'top' : 'category';
  const kind = tab === 'income' ? 'income' : 'expense';
  const { from, to } = custom ? { from: q.from, to: q.to } : rangeDates(range);
  const r = await api(`/reports/spending${qs({ from, to, kind, group })}`);
  const rangeSel = h('select', { onchange: (e) => go(tab, { ...q, range: e.target.value, from: '', to: '' }) },
    options([...Object.entries(RANGES).filter(([k]) => k !== 'all'), ...(custom ? [['custom', 'Custom']] : [])], range));
  const controls = h('div', { class: 'row wrap', style: { marginBottom: '16px' } }, rangeSel,
    tab !== 'payees' ? h('div', { class: 'seg' },
      h('button', { class: group === 'category' ? 'on' : '', onclick: () => go(tab, { ...q, group: '' }) }, 'Subcategories'),
      h('button', { class: group === 'top' ? 'on' : '', onclick: () => go(tab, { ...q, group: 'top' }) }, 'Top level')) : null,
    h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `${fmtDateLong(from)} – ${fmtDateLong(to)}`));
  const total = h('div', { class: 'card tile', style: { marginBottom: '16px' } },
    h('div', { class: 'label' }, kind === 'income' ? 'Total income' : tab === 'payees' ? 'Total spending' : 'Total spending'),
    h('div', { class: 'value' }, money(r.total)),
    h('div', { class: 'delta' }, `${r.items.length} ${tab === 'payees' ? 'payees' : 'categories'} · click a bar to see its transactions`));
  const items = r.items.slice(0, 60).map((i) => ({
    label: i.label, value: i.amount,
    note: r.total ? `${Math.round((i.amount / r.total) * 100)}%` : '',
    href: `#/transactions${qs({ from, to, ...(i.payee !== undefined ? { payee: i.payee } : i.uncategorized ? { uncategorized: 1 } : { category_id: i.category_id, include_sub: group === 'top' ? '' : 0 }) })}`,
  }));
  el.append(controls, total, h('div', { class: 'card' }, h('div', { class: 'card-body', style: { paddingTop: '16px' } },
    barList(items, { color: kind === 'income' ? 'var(--series-1)' : 'var(--series-2)' }),
    r.items.length > 60 ? h('p', { class: 'muted small' }, `Showing the top 60 of ${r.items.length}.`) : null)));
}

async function cashflow(el, q) {
  const months = [6, 12, 24].includes(Number(q.months)) ? Number(q.months) : 12;
  const { months: data } = await api(`/reports/cashflow?months=${months}`);
  el.append(h('div', { class: 'row', style: { marginBottom: '16px' } },
    h('div', { class: 'seg' }, [6, 12, 24].map((m) => h('button', { class: m === months ? 'on' : '', onclick: () => go('cashflow', { ...q, months: m }) }, `${m} months`)))));
  const inc = data.reduce((s, m) => s + m.income, 0), exp = data.reduce((s, m) => s + m.expense, 0);
  el.append(h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } },
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, 'Income'), h('div', { class: 'value' }, money(inc)), h('div', { class: 'delta' }, `${money(Math.round(inc / months))} a month on average`)),
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, 'Spending'), h('div', { class: 'value' }, money(exp)), h('div', { class: 'delta' }, `${money(Math.round(exp / months))} a month on average`)),
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, 'Saved'), h('div', { class: `value ${inc - exp < 0 ? 'neg' : ''}` }, money(inc - exp)), h('div', { class: 'delta' }, inc ? `${Math.round(((inc - exp) / inc) * 100)}% of income` : ''))));
  const chart = h('div');
  el.append(h('div', { class: 'card' }, h('div', { class: 'card-body', style: { paddingTop: '16px' } },
    h('div', { class: 'legend' }, h('span', null, h('i', { class: 'key', style: { background: 'var(--series-1)' } }), 'Income'), h('span', null, h('i', { class: 'key', style: { background: 'var(--series-2)' } }), 'Spending')),
    chart)));
  columnChart(chart, {
    labels: data.map((m) => fmtMonthShort(m.month)), titles: data.map((m) => fmtMonth(m.month)),
    series: [{ name: 'Income', values: data.map((m) => m.income), color: 'var(--series-1)' }, { name: 'Spending', values: data.map((m) => m.expense), color: 'var(--series-2)' }],
    onClick: (i) => go('spending', { from: `${data[i].month}-01`, to: monthEnd(data[i].month) }),
  });
  el.append(table(['Month', 'Income', 'Spending', 'Net'], [...data].reverse().map((m) => [fmtMonth(m.month), money(m.income), money(m.expense), h('span', { class: m.net < 0 ? 'neg' : '' }, money(m.net))])));
}

async function networth(el, q) {
  const months = [12, 24, 60, 120].includes(Number(q.months)) ? Number(q.months) : 24;
  const { months: data } = await api(`/reports/networth?months=${months}`);
  el.append(h('div', { class: 'row', style: { marginBottom: '16px' } },
    h('div', { class: 'seg' }, [[12, '1 year'], [24, '2 years'], [60, '5 years'], [120, '10 years']].map(([m, l]) => h('button', { class: m === months ? 'on' : '', onclick: () => go('networth', { ...q, months: m }) }, l)))));
  if (!data.length) { el.append(h('div', { class: 'empty' }, 'No history yet.')); return; }
  const last = data[data.length - 1], first = data[0];
  el.append(h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } },
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, 'Net worth'), h('div', { class: 'value' }, money(last.net)),
      h('div', { class: `delta ${last.net - first.net >= 0 ? 'pos' : 'neg'}` }, `${last.net - first.net >= 0 ? '▲' : '▼'} ${money(Math.abs(last.net - first.net))} since ${fmtMonth(first.month)}`)),
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, 'Assets'), h('div', { class: 'value' }, money(last.assets))),
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, 'Liabilities'), h('div', { class: 'value' }, money(last.liabilities)))));
  const chart = h('div');
  el.append(h('div', { class: 'card' }, h('div', { class: 'card-body', style: { paddingTop: '16px' } }, chart)));
  areaChart(chart, {
    labels: data.map((m) => (months > 24 ? fmtMonth(m.month, false) : fmtMonthShort(m.month))), titles: data.map((m) => fmtMonth(m.month)),
    values: data.map((m) => m.net), height: 300,
    rows: (i) => [{ label: 'Assets', value: money(data[i].assets) }, { label: 'Liabilities', value: money(data[i].liabilities) }, { label: 'Net worth', value: money(data[i].net) }],
  });
  el.append(table(['Month end', 'Assets', 'Liabilities', 'Net worth'], [...data].reverse().map((m) => [fmtMonth(m.month), money(m.assets), money(m.liabilities), money(m.net)])));
}

function table(headers, rows) {
  return h('details', { class: 'card', style: { marginTop: '16px' } },
    h('summary', { style: { padding: '12px 16px', cursor: 'pointer', fontWeight: 600 } }, 'Table view'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, headers.map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i ? 'amt' : '' }, c))))))));
}

export async function render(el, [tab = 'spending'], query) {
  const q = Object.fromEntries(query);
  if (!TABS.some(([k]) => k === tab)) tab = 'spending';
  el.append(pageHead('Reports', null), tabs(tab, q));
  if (tab === 'cashflow') return cashflow(el, q);
  if (tab === 'networth') return networth(el, q);
  return breakdown(el, tab, q);
}
