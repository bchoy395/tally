'use strict';
// A year of realistic, deterministic household finances for exploring the app.

const U = require('./util');

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadSample(L, today = U.todayISO()) {
  const r = rng(42);
  const between = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const startMonth = U.shiftMonth(U.monthOf(today), -12);
  const start = U.monthStart(startMonth);

  L.tx(() => {
    const acct = (name, type, opening, institution) => L.saveAccount({ name, type, opening_balance: opening, opening_date: start, institution }).id;
    const checking = acct('Everyday Checking', 'checking', 420000, 'First Harbor Bank');
    const savings = acct('High-Yield Savings', 'savings', 1250000, 'First Harbor Bank');
    const visa = acct('Visa Rewards', 'credit', -61240, 'Summit Card Services');
    const mortgage = acct('Home Mortgage', 'loan', -28650000, 'Keystone Home Loans');
    acct('Home (est. value)', 'asset', 46500000, '');
    const invest = acct('Retirement 401(k)', 'investment', 4815000, 'Evergreen Investments');
    const cash = acct('Wallet', 'cash', 12000, '');
    const cat = (p) => L.ensureCategoryPath(p);

    const txns = [];
    const add = (t) => { if (t.date <= today) txns.push(t); };
    const cardByMonth = new Map();
    const charge = (date, payee, category, amount) => {
      add({ account_id: visa, date, payee, category_id: cat(category), amount: -amount });
      const m = U.monthOf(date);
      cardByMonth.set(m, (cardByMonth.get(m) || 0) + amount);
    };

    // Biweekly paycheck on Fridays
    let pay = start;
    while (new Date(`${pay}T00:00:00Z`).getUTCDay() !== 5) pay = U.addDays(pay, 1);
    for (; pay <= today; pay = U.addDays(pay, 14)) {
      add({ account_id: checking, date: pay, payee: 'Acme Robotics Payroll', category_id: cat('Salary'), amount: 284017, memo: 'Direct deposit' });
    }

    let principal = 70500, loanBal = 28650000;
    for (let i = 0; i <= 12; i++) {
      const m = U.shiftMonth(startMonth, i);
      const d = (day) => U.addMonths(`${m}-01`, 0, day);
      // Mortgage: one payment, split between principal (transfer), interest and escrow.
      const interest = Math.round(loanBal * 0.0055 / 12 * 10);
      add({ account_id: checking, date: d(1), payee: 'Keystone Home Loans', amount: -(principal + interest + 31000), splits: [
        { transfer_account_id: mortgage, amount: -principal, memo: 'Principal' },
        { category_id: cat('Home:Mortgage Interest'), amount: -interest, memo: 'Interest' },
        { category_id: cat('Home:Property Tax'), amount: -31000, memo: 'Escrow' },
      ] });
      loanBal -= principal; principal += 300;
      add({ account_id: checking, date: d(3), payee: 'Transfer to Savings', transfer_account_id: savings, amount: -50000 });
      add({ account_id: checking, date: d(6), payee: 'Pacific Power', category_id: cat('Bills & Utilities:Electricity'), amount: -between(78, 168) });
      add({ account_id: checking, date: d(9), payee: 'Metro Water District', category_id: cat('Bills & Utilities:Water & Sewer'), amount: -between(38, 61) });
      add({ account_id: checking, date: d(12), payee: 'Northwind Fiber', category_id: cat('Bills & Utilities:Internet'), amount: -7499 });
      add({ account_id: checking, date: d(15), payee: 'Cellular One', category_id: cat('Bills & Utilities:Mobile Phone'), amount: -8812 });
      add({ account_id: checking, date: d(18), payee: 'ATM Withdrawal', transfer_account_id: cash, amount: -10000 });
      add({ account_id: checking, date: d(22), payee: 'Lakeside Auto Insurance', category_id: cat('Auto & Transport:Auto Insurance'), amount: -13850 });
      add({ account_id: savings, date: d(28), payee: 'Interest Paid', category_id: cat('Interest'), amount: between(38, 55) });
      if (i % 3 === 1) add({ account_id: checking, date: d(24), payee: 'Riverside Dental', category_id: cat('Health:Dental'), amount: -between(40, 180) });

      // Card spending
      for (const day of [2, 9, 16, 23, 29]) charge(d(day), pick(['Fresh Market', "Trader Joe's", 'Green Grocer Co-op', 'Safeway']), 'Food:Groceries', between(62, 178));
      const eats = 5 + Math.floor(r() * 5);
      for (let k = 0; k < eats; k++) charge(d(1 + Math.floor(r() * 27)), pick(['Blue Door Bistro', 'Taqueria El Sol', 'Noodle House', 'Pizzeria Uno Mas', 'The Corner Deli', 'Sushi Kaito']), 'Food:Restaurants', between(14, 86));
      for (let k = 0; k < 6; k++) charge(d(1 + Math.floor(r() * 27)), pick(['Bean There Coffee', 'Morning Ritual Cafe']), 'Food:Coffee', between(4, 9));
      for (let k = 0; k < 3; k++) charge(d(4 + k * 9), pick(['Shell', 'Chevron', 'Costco Gas']), 'Auto & Transport:Fuel', between(38, 64));
      charge(d(5), 'StreamFlix', 'Entertainment:Streaming', 1549);
      charge(d(11), 'TuneBox Music', 'Entertainment:Streaming', 1199);
      charge(d(14), 'City Fitness Club', 'Health:Fitness', 4500);
      for (let k = 0; k < 3; k++) charge(d(2 + Math.floor(r() * 26)), pick(['Online Marketplace', 'Target', 'Home Depot', 'Bookshop Lane']), pick(['Shopping:Household', 'Shopping:Clothing', 'Home:Maintenance', 'Shopping:Books']), between(12, 140));
      if (r() < 0.4) charge(d(19), 'Neighborhood Pharmacy', 'Health:Pharmacy', between(8, 45));
      if (m.endsWith('-12')) { charge(d(8), 'Gift Emporium', 'Gifts & Donations:Gifts', 24300); charge(d(15), 'Online Marketplace', 'Gifts & Donations:Gifts', 18950); add({ account_id: checking, date: d(20), payee: 'Food Bank Donation', category_id: cat('Gifts & Donations:Charity'), amount: -15000 }); }
      if (m.endsWith('-07')) { charge(d(10), 'SkyWays Airlines', 'Travel:Airfare', 61240); charge(d(21), 'Harborview Inn', 'Travel:Lodging', 88700); }
      if (m.endsWith('-03')) add({ account_id: checking, date: d(28), payee: 'State Revenue Dept', category_id: cat('Taxes:State Tax'), amount: -41200 });
      if (m.endsWith('-04')) add({ account_id: checking, date: d(16), payee: 'US Treasury', category_id: cat('Refunds'), amount: 86300, memo: 'Federal tax refund' });

      // Cash spending
      add({ account_id: cash, date: d(19), payee: 'Farmers Market', category_id: cat('Food:Groceries'), amount: -between(18, 40) });
      add({ account_id: cash, date: d(26), payee: 'Parking Meter', category_id: cat('Auto & Transport:Parking & Tolls'), amount: -between(4, 12) });

      // Pay last month's card balance
      const prev = U.shiftMonth(m, -1);
      const due = i === 0 ? 61240 : cardByMonth.get(prev) || 0;
      if (due) add({ account_id: checking, date: d(20), payee: 'Summit Card Services', transfer_account_id: visa, amount: -due, memo: 'Card payment' });

      // Retirement account: contributions and market moves
      add({ account_id: checking, date: d(25), payee: 'Evergreen 401(k) Contribution', transfer_account_id: invest, amount: -40000 });
    }

    txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const t of txns) L.saveTxn(t);
    // Market value updates at month end
    let value = 4815000;
    for (let i = 0; i < 12; i++) {
      const date = U.monthEnd(U.shiftMonth(startMonth, i));
      if (date > today) break;
      value = Math.round((value + 40000) * (1 + (r() * 0.05 - 0.015)));
      L.adjustBalance(invest, { date, balance: value });
    }
    // Older activity is reconciled, the last few weeks cleared, the last few days pending — on both sides of transfers.
    L.run("UPDATE transactions SET status = CASE WHEN date <= ? THEN 'R' WHEN date <= ? THEN 'c' ELSE '' END", U.addDays(today, -40), U.addDays(today, -6));
    const reconciled = U.addDays(today, -40);
    for (const a of L.listAccounts()) L.run('UPDATE accounts SET last_reconciled_date = ?, last_reconciled_balance = ? WHERE id = ?', reconciled, a.opening_balance + L.get("SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE account_id = ? AND status = 'R'", a.id).s, a.id);
    // An unreconciled uncategorized pair to show how that looks
    L.saveTxn({ account_id: visa, date: U.addDays(today, -2), payee: 'SQ *POP-UP MARKET', amount: -2350 });
    L.saveTxn({ account_id: visa, date: U.addDays(today, -1), payee: 'AMZN MKTP US*2K4', amount: -3899 });

    for (const month of [U.shiftMonth(U.monthOf(today), -1), U.monthOf(today)]) {
      const budget = {
        'Food:Groceries': 70000, 'Food:Restaurants': 30000, 'Food:Coffee': 4000, 'Bills & Utilities:Electricity': 13000,
        'Bills & Utilities:Internet': 7500, 'Bills & Utilities:Mobile Phone': 9000, 'Bills & Utilities:Water & Sewer': 6000,
        'Auto & Transport:Fuel': 16000, 'Auto & Transport:Auto Insurance': 14000, 'Entertainment:Streaming': 3000,
        'Health:Fitness': 4500, 'Shopping:Household': 15000, 'Shopping:Clothing': 10000, 'Home:Maintenance': 10000,
        'Home:Mortgage Interest': 135000, 'Home:Property Tax': 31000, Salary: 568000,
      };
      for (const [p, amt] of Object.entries(budget)) L.setBudget(month, cat(p), amt);
    }

    const next = (day) => { let d = U.addMonths(`${U.monthOf(today)}-01`, 0, day); if (d <= today) d = U.addMonths(d, 1, day); return d; };
    L.saveScheduled({ account_id: checking, payee: 'Acme Robotics Payroll', amount: 284017, category_id: cat('Salary'), frequency: 'biweekly', next_date: pay, auto_enter: 1 });
    L.saveScheduled({ account_id: checking, payee: 'Northwind Fiber', amount: -7499, category_id: cat('Bills & Utilities:Internet'), frequency: 'monthly', next_date: next(12) });
    L.saveScheduled({ account_id: checking, payee: 'Cellular One', amount: -8812, category_id: cat('Bills & Utilities:Mobile Phone'), frequency: 'monthly', next_date: next(15) });
    L.saveScheduled({ account_id: checking, payee: 'Transfer to Savings', amount: -50000, transfer_account_id: savings, frequency: 'monthly', next_date: next(3) });
    L.saveScheduled({ account_id: checking, payee: 'Lakeside Auto Insurance', amount: -13850, category_id: cat('Auto & Transport:Auto Insurance'), frequency: 'monthly', next_date: next(22) });
    L.saveScheduled({ account_id: visa, payee: 'StreamFlix', amount: -1549, category_id: cat('Entertainment:Streaming'), frequency: 'monthly', next_date: next(5) });

    L.saveRule({ match: 'AMZN', payee: 'Online Marketplace', category_id: cat('Shopping:Household') });
    L.saveRule({ match: 'SQ *', payee: 'Square Merchant' });
  });
}

module.exports = { loadSample };
