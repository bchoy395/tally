import {
  api, h, money, fmtDate, fmtMonth, fmtMonthShort, pageHead, icon, categoryLabel, changed, attempt, qs, monthEnd, todayISO, editButton,
} from '../core.js';
import { areaChart, barList } from '../charts.js';
import { openTxnEditor } from '../editor.js';
import { openAccountDialog } from './accounts.js';

function welcome(el) {
  el.append(h('div', { class: 'welcome' },
    h('h1', null, 'Welcome to Tally'),
    h('p', { class: 'lead' }, 'Your money, on your computer. Everything is stored in one private file on this Mac. Nothing is sent anywhere.'),
    h('div', { class: 'grid cols-3 choices' },
      h('div', { class: 'card choice' }, h('h2', null, 'Move from Quicken'),
        h('p', null, 'Import a QIF export. Accounts, categories, splits and transfers come across together.'),
        h('a', { class: 'btn primary', href: '#/import' }, 'Import a file')),
      h('div', { class: 'card choice' }, h('h2', null, 'Start fresh'),
        h('p', null, 'Add your checking account, cards and loans, then import statements from your bank (OFX, QFX or CSV).'),
        h('button', { class: 'btn', onclick: () => openAccountDialog() }, 'Add an account')),
      h('div', { class: 'card choice' }, h('h2', null, 'Look around first'),
        h('p', null, 'Load a year of realistic sample data to try things out. You can erase it later in Settings.'),
        h('button', { class: 'btn', onclick: async () => { await attempt(() => api.post('/sample'), 'Sample data loaded.'); await changed(); } }, 'Load sample data')))));
}

function delta(cur, prev, upIsGood) {
  if (!prev) return h('div', { class: 'delta' }, 'No data for last month');
  const d = cur - prev;
  if (!d) return h('div', { class: 'delta' }, 'Same as last month');
  const good = (d > 0) === upIsGood;
  return h('div', { class: `delta ${good ? 'pos' : 'neg'}` }, `${d > 0 ? '▲' : '▼'} ${money(Math.abs(d))} vs last month`);
}

function meter(spent, budget) {
  const pct = budget ? spent / budget : 0;
  return h('div', { class: `meter ${pct > 1 ? 'over' : pct > 0.9 ? 'warn' : ''}`, role: 'meter', 'aria-valuenow': Math.round(pct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('span', { style: { width: `${Math.min(100, pct * 100)}%` } }));
}

export async function render(el) {
  const d = await api('/dashboard');
  if (!d.has_accounts) return welcome(el);
  const monthName = fmtMonth(d.month);
  el.append(pageHead('Home', new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    h('button', { class: 'btn primary', onclick: () => openTxnEditor() }, icon('plus'), 'New transaction')));

  if (d.uncategorized) {
    el.append(h('div', { class: 'callout', style: { marginBottom: '16px' } },
      h('span', { class: 'grow' }, `${d.uncategorized} transaction${d.uncategorized === 1 ? ' needs' : 's need'} a category.`),
      h('a', { class: 'btn sm', href: '#/transactions?uncategorized=1' }, 'Review')));
  }

  const hero = h('div', { class: 'card tile hero' },
    h('div', { class: 'label' }, 'Net worth'),
    h('div', { class: 'value' }, money(d.net_worth)),
    h('div', { class: 'delta' }, `Assets ${money(d.assets)} · Liabilities ${money(d.liabilities)}`));
  if (d.trend.length > 1) {
    const chart = h('div', { style: { marginTop: '12px' } });
    hero.append(chart);
    areaChart(chart, {
      labels: d.trend.map((m) => fmtMonthShort(m.month)), titles: d.trend.map((m) => fmtMonth(m.month)),
      values: d.trend.map((m) => m.net), height: 170,
      rows: (i) => [{ label: 'Assets', value: money(d.trend[i].assets) }, { label: 'Liabilities', value: money(d.trend[i].liabilities) }, { label: 'Net worth', value: money(d.trend[i].net) }],
    });
  }
  const tiles = h('div', { class: 'grid', style: { alignContent: 'start' } },
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, `Income in ${monthName}`), h('div', { class: 'value' }, money(d.this_month.income)), delta(d.this_month.income, d.last_month.income, true)),
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, `Spending in ${monthName}`), h('div', { class: 'value' }, money(d.this_month.expense)), delta(d.this_month.expense, d.last_month.expense, false)),
    h('a', { class: 'card tile', href: '#/budget', style: { color: 'inherit', textDecoration: 'none' } },
      h('div', { class: 'label' }, 'Budget'),
      d.budget.budgeted
        ? [h('div', { class: 'value' }, d.budget.spent > d.budget.budgeted ? `${money(d.budget.spent - d.budget.budgeted)} over` : `${money(d.budget.budgeted - d.budget.spent)} left`),
          h('div', { style: { margin: '8px 0 4px' } }, meter(d.budget.spent, d.budget.budgeted)),
          h('div', { class: 'delta' }, `${money(d.budget.spent)} spent of ${money(d.budget.budgeted)}`)]
        : [h('div', { class: 'value muted' }, 'Not set'), h('div', { class: 'delta' }, 'Set spending targets for each category →')]));
  el.append(h('div', { class: 'grid dash' }, hero, tiles));

  const from = `${d.month}-01`, to = monthEnd(d.month);
  const spend = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, `Spending in ${monthName}`), h('a', { href: '#/reports/spending', class: 'small' }, 'All reports')),
    h('div', { class: 'card-body' }, barList(d.top_spending.map((i) => ({
      label: i.label, value: i.amount, budget: i.budget,
      note: i.budget ? `of ${money(i.budget)}` : '',
      href: `#/transactions${qs({ from, to, ...(i.uncategorized ? { uncategorized: 1 } : { category_id: i.category_id }) })}`,
    })), { empty: 'No spending yet this month.' })));

  const bills = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Upcoming bills'), h('a', { href: '#/bills', class: 'small' }, 'Manage')));
  const billBody = h('div', { class: 'card-body' });
  if (!d.upcoming.length) billBody.append(h('div', { class: 'empty' }, 'Nothing due in the next two weeks.'));
  else {
    const tbody = h('tbody');
    for (const b of d.upcoming) {
      tbody.append(h('tr', null,
        h('td', { class: 'date' }, fmtDate(b.date), b.overdue ? [' ', h('span', { class: 'badge bad' }, 'Overdue')] : null),
        h('td', null, b.payee, h('div', { class: 'memo' }, b.account_name)),
        h('td', { class: `amt ${b.amount > 0 ? 'pos' : 'neg'}` }, money(b.amount)),
        h('td', { class: 'r' }, b.is_next ? h('button', { class: 'btn sm', onclick: async () => {
          const r = await attempt(() => api.post(`/scheduled/${b.id}/enter`), `Entered ${b.payee}.`);
          if (r) await changed();
        } }, 'Enter') : null)));
    }
    billBody.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, tbody)));
  }
  bills.append(billBody);
  el.append(h('div', { class: 'grid cols-2', style: { marginTop: '16px' } }, spend, bills));

  const recent = h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'card-head' }, h('h2', null, 'Recent transactions'), h('a', { href: '#/transactions', class: 'small' }, 'See all')));
  const tb = h('tbody');
  for (const t of d.recent) {
    const cl = categoryLabel(t);
    tb.append(h('tr', { class: t.date > todayISO() ? 'future' : '' },
      h('td', { class: 'date' }, fmtDate(t.date)),
      h('td', { class: 'payee' }, t.payee || h('span', { class: 'muted' }, '(no payee)')),
      h('td', { class: `cat ${cl ? '' : 'uncat'} hide-sm` }, cl || 'Uncategorized'),
      h('td', { class: 'hide-sm ink-2' }, t.account_name),
      h('td', { class: `amt ${t.amount > 0 ? 'pos' : ''}` }, money(t.amount)),
      editButton(t.payee || 'transaction', () => openTxnEditor({ id: t.id }))));
  }
  recent.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, tb)));
  el.append(recent);
}
