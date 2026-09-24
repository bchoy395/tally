'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { open } = require('../lib/db');
const { Ledger } = require('../lib/ledger');
const { loadSample } = require('../lib/sample');

function fresh() {
  const L = new Ledger(open(':memory:'));
  const ck = L.saveAccount({ name: 'Checking', type: 'checking', opening_balance: 100000 }).id;
  const sv = L.saveAccount({ name: 'Savings', type: 'savings' }).id;
  const cc = L.saveAccount({ name: 'Card', type: 'credit' }).id;
  const cat = (p, k) => L.ensureCategoryPath(p, k);
  return { L, ck, sv, cc, cat };
}
const bal = (L, id) => L.getAccount(id).ending_balance;

test('balances, running balance and cleared balance', () => {
  const { L, ck, cat } = fresh();
  L.saveTxn({ account_id: ck, date: '2024-01-02', payee: 'A', amount: -2500, category_id: cat('Food:Groceries'), status: 'c' });
  L.saveTxn({ account_id: ck, date: '2024-01-01', payee: 'B', amount: 5000 });
  const a = L.getAccount(ck);
  assert.equal(a.ending_balance, 102500);
  assert.equal(a.cleared_balance, 97500);
  const rows = L.listTxns({ account_id: ck }).rows;
  assert.deepEqual(rows.map((r) => [r.payee, r.running_balance]), [['A', 102500], ['B', 105000]]);
});

test('transfers keep both sides in sync through edit and delete', () => {
  const { L, ck, sv, cc } = fresh();
  const t = L.saveTxn({ account_id: ck, date: '2024-02-01', payee: 'Move', amount: -30000, transfer_account_id: sv });
  assert.equal(bal(L, sv), 30000);
  assert.equal(t.transfer_account_id, sv);
  L.saveTxn({ ...t, amount: -45000, date: '2024-02-03' }, t.id);
  const other = L.listTxns({ account_id: sv }).rows[0];
  assert.equal(other.amount, 45000);
  assert.equal(other.date, '2024-02-03');
  assert.equal(other.transfer_account_id, ck);
  // Editing from the other side updates the original
  L.saveTxn({ ...other, amount: 10000 }, other.id);
  assert.equal(bal(L, ck), 90000);
  // Retarget to another account
  L.saveTxn({ ...L.getTxn(t.id), transfer_account_id: cc }, t.id);
  assert.equal(bal(L, sv), 0);
  assert.equal(bal(L, cc), 10000);
  // Convert to a regular expense
  L.saveTxn({ ...L.getTxn(t.id), transfer_account_id: null }, t.id);
  assert.equal(bal(L, cc), 0);
  L.saveTxn({ ...L.getTxn(t.id), transfer_account_id: sv }, t.id);
  L.deleteTxn(t.id);
  assert.equal(L.get('SELECT COUNT(*) n FROM transactions').n, 0);
});

test('splits: validation, split transfers, and reports use split categories', () => {
  const { L, ck, sv, cat } = fresh();
  const food = cat('Food'), fun = cat('Fun');
  assert.throws(() => L.saveTxn({ account_id: ck, date: '2024-03-01', amount: -1000, splits: [{ category_id: food, amount: -400 }] }), /add up/);
  const t = L.saveTxn({ account_id: ck, date: '2024-03-01', payee: 'Mixed', amount: -10000, splits: [
    { category_id: food, amount: -6000 }, { category_id: fun, amount: -1000 }, { transfer_account_id: sv, amount: -3000, memo: 'to savings' },
  ] });
  assert.equal(t.splits.length, 3);
  assert.equal(bal(L, sv), 3000);
  const counterpart = L.listTxns({ account_id: sv }).rows[0];
  assert.equal(counterpart.split_parent_id, t.id);
  assert.throws(() => L.saveTxn({ ...counterpart, amount: 1 }, counterpart.id), /split/);
  assert.throws(() => L.deleteTxn(counterpart.id), /split/);
  const rep = L.spendingReport({ from: '2024-03-01', to: '2024-03-31' });
  assert.deepEqual(rep.items.map((i) => [i.label, i.amount]), [['Food', 6000], ['Fun', 1000]]);
  // Category filter finds split transactions
  assert.equal(L.listTxns({ category_id: fun }).total, 1);
  // Re-splitting keeps the counterpart's cleared status
  L.run("UPDATE transactions SET status = 'c' WHERE id = ?", counterpart.id);
  L.saveTxn({ ...t, payee: 'Mixed 2', splits: t.splits.map((s) => ({ ...s })) }, t.id);
  const cp2 = L.listTxns({ account_id: sv }).rows[0];
  assert.equal(cp2.status, 'c');
  assert.equal(cp2.payee, 'Mixed 2');
  // Dropping the splits removes the counterpart
  L.saveTxn({ ...L.getTxn(t.id), splits: [], category_id: food }, t.id);
  assert.equal(bal(L, sv), 0);
  L.deleteTxn(t.id);
  assert.equal(L.get('SELECT COUNT(*) n FROM splits').n, 0);
});

test('transfers are excluded from income/expense', () => {
  const { L, ck, sv, cat } = fresh();
  L.saveTxn({ account_id: ck, date: '2024-04-02', amount: 200000, category_id: cat('Salary', 'income') });
  L.saveTxn({ account_id: ck, date: '2024-04-03', amount: -50000, transfer_account_id: sv });
  L.saveTxn({ account_id: ck, date: '2024-04-04', amount: -1234 });
  L.saveTxn({ account_id: ck, date: '2024-04-05', amount: 500 });
  const m = L.cashflowReport({ months: 1, end: '2024-04' }).months[0];
  assert.deepEqual(m, { month: '2024-04', income: 200500, expense: 1234, net: 199266 });
});

test('reconcile marks transactions and enforces the difference', () => {
  const { L, ck } = fresh();
  const a = L.saveTxn({ account_id: ck, date: '2024-05-01', amount: -1000, status: 'c' });
  const b = L.saveTxn({ account_id: ck, date: '2024-05-02', amount: -2000 });
  L.saveTxn({ account_id: ck, date: '2024-05-20', amount: -5000 });
  assert.throws(() => L.reconcile(ck, { statement_date: '2024-05-15', statement_balance: 97500, txn_ids: [a.id, b.id] }), /off by/);
  assert.equal(L.getTxn(a.id).status, 'c', 'failed reconcile rolls back');
  L.reconcile(ck, { statement_date: '2024-05-15', statement_balance: 97000, txn_ids: [a.id, b.id] });
  assert.equal(L.getTxn(b.id).status, 'R');
  assert.equal(L.getAccount(ck).last_reconciled_balance, 97000);
  L.reconcile(ck, { statement_date: '2024-05-31', statement_balance: 96900, txn_ids: [], adjust: true });
  assert.equal(L.listTxns({ account_id: ck, q: 'Reconciliation' }).rows[0].amount, -100);
});

test('budget actuals, copy and fill from average', () => {
  const { L, ck, cat } = fresh();
  const g = cat('Food:Groceries');
  for (const m of ['01', '02', '03']) L.saveTxn({ account_id: ck, date: `2024-${m}-10`, amount: -30000, category_id: g });
  L.saveTxn({ account_id: ck, date: '2024-04-10', amount: -12000, category_id: g });
  L.saveTxn({ account_id: ck, date: '2024-04-11', amount: 2000, category_id: g }); // refund
  L.setBudget('2024-04', g, 25000);
  const b = L.getBudget('2024-04');
  const row = b.rows.find((r) => r.id === g);
  assert.deepEqual([row.budget, row.actual, row.avg3], [25000, 10000, 30000]);
  assert.equal(L.copyBudget('2024-04', '2024-05').copied, 1);
  assert.equal(L.getBudget('2024-05').rows.find((r) => r.id === g).budget, 25000);
  assert.equal(L.fillBudgetFromAverage('2024-06').filled, 1);
  assert.equal(L.getBudget('2024-06').rows.find((r) => r.id === g).budget, 14000, 'avg of 0+300+100 → 133.33, rounded up to $10');
  assert.equal(L.fillBudgetFromAverage('2024-04').filled, 0, 'does not overwrite');
  L.setBudget('2024-04', g, 0);
  assert.equal(L.fillBudgetFromAverage('2024-04').filled, 1);
  assert.equal(L.getBudget('2024-04').rows.find((r) => r.id === g).budget, 30000);
});

test('scheduled transactions enter, skip, and auto-enter', () => {
  const { L, ck, sv, cat } = fresh();
  const rent = L.saveScheduled({ account_id: ck, payee: 'Rent', amount: -150000, category_id: cat('Home:Rent'), frequency: 'monthly', next_date: '2024-01-31' });
  L.enterScheduled(rent.id);
  assert.equal(L.listScheduled()[0].next_date, '2024-02-29');
  L.skipScheduled(rent.id);
  assert.equal(L.listScheduled()[0].next_date, '2024-03-31');
  L.saveScheduled({ account_id: ck, payee: 'Save', amount: -1000, transfer_account_id: sv, frequency: 'weekly', next_date: '2024-03-01', auto_enter: 1, end_date: '2024-03-20' });
  assert.equal(L.autoEnterDue('2024-04-01'), 3);
  assert.equal(bal(L, sv), 3000);
  assert.equal(L.listScheduled().length, 1, 'ended schedule is removed');
  const up = L.upcoming(70, '2024-03-01');
  assert.deepEqual(up.map((u) => [u.date, u.overdue]), [['2024-03-31', false], ['2024-04-30', false]]);
});

test('import preview flags duplicates and applies rules and payee memory', () => {
  const { L, ck, cat } = fresh();
  const g = cat('Food:Groceries');
  L.saveTxn({ account_id: ck, date: '2024-06-01', payee: 'Corner Market', amount: -1500, category_id: g });
  L.saveRule({ match: 'NETFLIX', payee: 'Netflix', category_id: cat('Entertainment:Streaming') });
  const csv = 'Date,Description,Amount\n06/02/2024,Corner Market,-15.00\n06/03/2024,Corner Market,-22.00\n06/04/2024,NETFLIX.COM 866,-15.49\n';
  const p = L.previewImport({ text: csv, filename: 'x.csv', account_id: ck });
  assert.deepEqual(p.rows.map((r) => [r.payee, r.duplicate, r.category_id !== null, r.include]),
    [['Corner Market', 'likely', true, false], ['Corner Market', null, true, true], ['Netflix', null, true, true]]);
  const res = L.commitImport({ account_id: ck, rows: p.rows.filter((r) => r.include) });
  assert.equal(res.imported, 2);
  assert.equal(L.listTxns({ account_id: ck }).total, 3);
});

test('OFX re-import is recognised by FITID', () => {
  const { L, ck } = fresh();
  const ofx = '<OFX><STMTTRN><DTPOSTED>20240701<TRNAMT>-5.00<FITID>X9<NAME>Snack</STMTTRN></OFX>';
  const p1 = L.previewImport({ text: ofx, filename: 'a.ofx', account_id: ck });
  L.commitImport({ account_id: ck, rows: p1.rows });
  const p2 = L.previewImport({ text: ofx, filename: 'a.ofx', account_id: ck });
  assert.equal(p2.rows[0].duplicate, 'exact');
});

test('QIF migration creates accounts, links transfers once, and skips re-imports', () => {
  const L = new Ledger(open(':memory:'));
  const text = fs.readFileSync(require.resolve('./importers.test.js'), 'utf8').match(/const QIF = `([\s\S]*?)`;/)[1];
  const res = L.importQIF({ text });
  assert.deepEqual(res.accounts_created.sort(), ['Brokerage', 'Checking', 'Mortgage']);
  assert.equal(res.linked_transfers, 1);
  const accts = Object.fromEntries(L.listAccounts().map((a) => [a.name, a]));
  assert.equal(accts.Checking.ending_balance, 100000 - 5420 - 150000 + 200000);
  assert.equal(accts.Mortgage.ending_balance, -20000000 + 30000);
  assert.equal(accts.Mortgage.txn_count, 1, 'principal appears once in the loan');
  const loanTxn = L.listTxns({ account_id: accts.Mortgage.id }).rows[0];
  assert.ok(loanTxn.split_parent_id, 'loan side is linked to the split in checking');
  assert.ok(L.categoryMap().size > 0 && [...L.categoryMap().values()].some((c) => c.path === 'Food:Groceries'));
  const again = L.importQIF({ text });
  assert.equal(again.imported, 0);
  assert.ok(again.duplicates >= 3);
});

test('QIF: split transfer seen first from the loan side is not duplicated', () => {
  const L = new Ledger(open(':memory:'));
  const text = `!Account\nNLoan\nTOth L\n^\n!Type:Oth L\nD2/1/2024\nT500.00\nPBank\nL[Chk]\n^\n!Account\nNChk\nTBank\n^\n!Type:Bank\nD2/1/2024\nT-700.00\nPBank\nSInterest\n$-200.00\nS[Loan]\n$-500.00\n^\n`;
  L.importQIF({ text });
  const accts = Object.fromEntries(L.listAccounts().map((a) => [a.name, a]));
  assert.equal(accts.Loan.txn_count, 1);
  assert.equal(accts.Loan.ending_balance, 50000);
  assert.equal(accts.Chk.ending_balance, -70000);
  const parent = L.listTxns({ account_id: accts.Chk.id }).rows[0];
  const full = L.getTxn(parent.id);
  assert.equal(full.splits.find((s) => s.transfer_account_id).transfer_account_id, accts.Loan.id);
});

test('category delete reassigns and merges budgets; no cycles', () => {
  const { L, ck, cat } = fresh();
  const a = cat('Old'), b = cat('New'), child = cat('Old:Child');
  L.saveTxn({ account_id: ck, date: '2024-08-01', amount: -100, category_id: a });
  L.setBudget('2024-08', a, 1000); L.setBudget('2024-08', b, 500);
  assert.throws(() => L.saveCategory({ name: 'Old', parent_id: child }, a), /inside itself/);
  L.deleteCategory(a, b);
  assert.equal(L.listTxns({ category_id: b }).total, 1);
  assert.equal(L.getBudget('2024-08').rows.find((r) => r.id === b).budget, 1500);
  assert.equal(L.get('SELECT parent_id FROM categories WHERE id = ?', child).parent_id, null);
});

test('backup/restore round-trips the whole file', () => {
  const L = new Ledger(open(':memory:'));
  loadSample(L, '2026-06-15');
  const before = JSON.stringify(L.listAccounts());
  const dump = L.backup();
  L.eraseAll();
  assert.equal(L.listAccounts().length, 0);
  L.restore(JSON.parse(JSON.stringify(dump)));
  assert.equal(JSON.stringify(L.listAccounts()), before);
  assert.throws(() => L.restore({ nope: 1 }), /backup/);
});

test('sample data is internally consistent', () => {
  const L = new Ledger(open(':memory:'));
  loadSample(L, '2026-06-15');
  // Every transfer pair nets to zero, and every split sums to its transaction.
  const bad = L.get(`SELECT COUNT(*) n FROM transactions t JOIN transactions l ON l.id = t.transfer_id AND l.transfer_id = t.id WHERE t.amount + l.amount != 0`).n;
  assert.equal(bad, 0);
  const badSplits = L.get(`SELECT COUNT(*) n FROM transactions t WHERE EXISTS (SELECT 1 FROM splits s WHERE s.txn_id = t.id)
    AND t.amount != (SELECT SUM(amount) FROM splits s WHERE s.txn_id = t.id)`).n;
  assert.equal(badSplits, 0);
  const nw = L.netWorthReport({ months: 12, end: '2026-06' }).months;
  const total = L.listAccounts().reduce((s, a) => s + a.ending_balance, 0);
  assert.equal(nw[nw.length - 1].net, total);
});
