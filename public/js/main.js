import { state, h, clear, icon, money, loadState, onChange, parseHash, ACCOUNT_GROUPS, toast, applyTheme } from './core.js';
import { openTxnEditor } from './editor.js';
import { openAccountDialog } from './views/accounts.js';
import * as dashboard from './views/dashboard.js';
import * as register from './views/register.js';
import * as transactions from './views/transactions.js';
import * as budget from './views/budget.js';
import * as reports from './views/reports.js';
import * as bills from './views/bills.js';
import * as categories from './views/categories.js';
import * as rules from './views/rules.js';
import * as importer from './views/import.js';
import * as settings from './views/settings.js';

const ROUTES = { dashboard, account: register, transactions, budget, reports, bills, categories, rules, import: importer, settings };
const NAV = [
  ['dashboard', 'Home', 'home'], ['transactions', 'Transactions', 'list'], ['budget', 'Budget', 'budget'],
  ['reports', 'Reports', 'chart'], ['bills', 'Bills & recurring', 'calendar'],
];
const NAV_2 = [['import', 'Import', 'upload'], ['categories', 'Categories', 'tag'], ['rules', 'Rules', 'wand'], ['settings', 'Settings', 'gear']];

const app = document.getElementById('app');
const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Main' });
const main = h('main', { class: 'main', id: 'main' });
const mobileBar = h('div', { class: 'mobile-bar' },
  h('button', { class: 'btn ghost icon-btn', 'aria-label': 'Menu', onclick: () => app.classList.toggle('nav-open') }, icon('menu')),
  h('strong', null, 'Tally'));
app.append(sidebar, h('div', null, mobileBar, main));

function renderSidebar(route) {
  clear(sidebar);
  const link = ([key, label, ic]) => h('a', { href: `#/${key}`, class: route === key ? 'active' : '' }, icon(ic), label);
  sidebar.append(
    h('div', { class: 'brand' }, icon('logo', 20), 'Tally'),
    h('div', { class: 'nav' }, NAV.map(link)));

  const open = state.accounts.filter((a) => !a.closed);
  const acctSection = h('div', { class: 'side-section' },
    h('div', { class: 'side-head' }, h('span', null, 'Accounts'), h('button', { title: 'Add account', 'aria-label': 'Add account', onclick: () => openAccountDialog() }, '+')));
  const current = route === 'account' ? Number(parseHash().parts[1]) : null;
  for (const [label, types] of ACCOUNT_GROUPS) {
    const list = open.filter((a) => types.includes(a.type));
    if (!list.length) continue;
    const total = list.reduce((s, a) => s + a.balance, 0);
    acctSection.append(h('div', { class: 'acct-group-label' }, h('span', null, label), h('span', { class: 'num' }, money(total))));
    for (const a of list) {
      acctSection.append(h('a', { class: `acct-link ${current === a.id ? 'active' : ''}`, href: `#/account/${a.id}` },
        h('span', { class: 'name' }, a.name), h('span', { class: `bal ${a.balance < 0 ? 'neg' : ''}` }, money(a.balance))));
    }
  }
  const closed = state.accounts.filter((a) => a.closed);
  if (closed.length) {
    const det = h('details', null, h('summary', { class: 'acct-group-label', style: { cursor: 'pointer' } }, `Closed (${closed.length})`),
      closed.map((a) => h('a', { class: `acct-link ${current === a.id ? 'active' : ''}`, href: `#/account/${a.id}` }, h('span', { class: 'name muted' }, a.name))));
    if (closed.some((a) => a.id === current)) det.open = true;
    acctSection.append(det);
  }
  if (open.length) {
    acctSection.append(h('div', { class: 'networth' }, h('span', null, 'Net worth'), h('span', { class: 'num' }, money(open.reduce((s, a) => s + a.balance, 0)))));
  } else {
    acctSection.append(h('div', { class: 'muted small', style: { padding: '6px 10px' } }, 'No accounts yet.'));
  }
  sidebar.append(acctSection, h('div', { class: 'side-foot nav' }, NAV_2.map(link),
    h('a', { href: '/help', target: '_blank', rel: 'noopener' }, icon('help'), 'Help')));
}

let rendering = 0;
async function render({ keepScroll = false } = {}) {
  const ticket = ++rendering;
  const { parts, query } = parseHash();
  const route = ROUTES[parts[0]] ? parts[0] : 'dashboard';
  renderSidebar(route);
  app.classList.remove('nav-open');
  const y = window.scrollY;
  const container = h('div');
  try {
    await ROUTES[route].render(container, parts.slice(1), query);
  } catch (e) {
    console.error(e);
    container.append(h('div', { class: 'callout bad' }, `Couldn't load this page: ${e.message}`));
  }
  if (ticket !== rendering) return;
  clear(main).append(container);
  document.title = `${container.querySelector('h1')?.textContent || 'Tally'} · Tally`;
  window.scrollTo(0, keepScroll ? y : 0);
}

window.addEventListener('hashchange', () => render());
onChange(() => render({ keepScroll: true }));

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
  if (e.key === 'n') {
    e.preventDefault();
    const { parts } = parseHash();
    openTxnEditor({ account_id: parts[0] === 'account' ? Number(parts[1]) : null });
  } else if (e.key === '/') {
    const s = document.querySelector('[data-search]');
    if (s) { e.preventDefault(); s.focus(); }
  }
});

applyTheme();
loadState().then(() => render()).catch((e) => {
  toast(e.message, 'error');
  main.append(h('div', { class: 'callout bad' }, "Can't reach the Tally server. Is it still running?"));
});
