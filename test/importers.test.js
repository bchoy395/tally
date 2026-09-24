'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../lib/util');
const IMP = require('../lib/importers');

test('parseMoney handles bank formats exactly', () => {
  const cases = { '12.34': 1234, '-12.34': -1234, '$1,234.56': 123456, '(45.00)': -4500, '45.00-': -4500, '0.1': 10, '1,5': 150,
    '1.234,56': 123456, '+7': 700, '': null, 'abc': null, '-$3.10': -310, '19.995': 2000, 'USD 5.00': 500 };
  for (const [s, v] of Object.entries(cases)) assert.equal(U.parseMoney(s), v, s);
  assert.equal(U.parseMoney(0.1 + 0.2), 30);
});

test('parseDate handles US, ISO, OFX, Quicken and month-name dates', () => {
  assert.equal(U.parseDate('01/15/2024'), '2024-01-15');
  assert.equal(U.parseDate('1/5/24'), '2024-01-05');
  assert.equal(U.parseDate("1/15'24"), '2024-01-15');
  assert.equal(U.parseDate(" 1/ 5' 4"), '2004-01-05');
  assert.equal(U.parseDate('2024-02-29'), '2024-02-29');
  assert.equal(U.parseDate('2023-02-29'), null);
  assert.equal(U.parseDate('20240115120000.000[-5:EST]'), '2024-01-15');
  assert.equal(U.parseDate('Jan 15, 2024'), '2024-01-15');
  assert.equal(U.parseDate('15-Jan-2024'), '2024-01-15');
  assert.equal(U.parseDate('15/01/2024', 'DMY'), '2024-01-15');
  assert.equal(U.detectDateOrder(['03/04/2024', '25/04/2024']), 'DMY');
  assert.equal(U.detectDateOrder(['03/04/2024', '04/25/2024']), 'MDY');
});

test('addMonths keeps the anchor day across short months', () => {
  assert.equal(U.addMonths('2024-01-31', 1, 31), '2024-02-29');
  assert.equal(U.addMonths('2024-02-29', 1, 31), '2024-03-31');
  assert.equal(U.addMonths('2024-11-15', 3), '2025-02-15');
});

test('CSV: preamble, quoted commas, debit/credit columns', () => {
  const csv = [
    'Account: Checking ****1234',
    'Export date,2024-03-01',
    '',
    'Posted Date,Description,Debit,Credit,Balance',
    '02/01/2024,"ACME, INC PAYROLL",,"2,500.00",3000.00',
    '02/03/2024,Coffee Shop,4.50,,2995.50',
    'Total,,,,',
  ].join('\n');
  const r = IMP.parseCSV(csv);
  assert.deepEqual(r.headers, ['Posted Date', 'Description', 'Debit', 'Credit', 'Balance']);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map((x) => [x.date, x.payee, x.amount]), [['2024-02-01', 'ACME, INC PAYROLL', 250000], ['2024-02-03', 'Coffee Shop', -450]]);
});

test('CSV: Mint-style positive amounts with a transaction type column, and categories', () => {
  const csv = 'Date,Description,Original Description,Amount,Transaction Type,Category,Account Name\n' +
    '3/02/2024,Whole Foods,WHOLEFDS #123,54.20,debit,Groceries,Visa\n3/05/2024,Employer,PAYROLL,2000.00,credit,Paycheck,Checking\n';
  const r = IMP.parseCSV(csv);
  assert.deepEqual(r.rows.map((x) => [x.amount, x.category, x.payee]), [[-5420, 'Groceries', 'Whole Foods'], [200000, 'Paycheck', 'Employer']]);
});

test('CSV: detects day-first dates and semicolons', () => {
  const csv = 'Date;Payee;Amount\n28/02/2024;Bakery;-3,50\n01/03/2024;Refund;10,00\n';
  const r = IMP.parseCSV(csv);
  assert.equal(r.dateOrder, 'DMY');
  assert.deepEqual(r.rows.map((x) => [x.date, x.amount]), [['2024-02-28', -350], ['2024-03-01', 1000]]);
});

test('CSV without a header row is mapped from content', () => {
  const r = IMP.parseCSV('01/02/2024,-12.00,Gas Station,\n01/03/2024,-40.10,Grocery Store,\n');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[1], { date: '2024-01-03', amount: -4010, payee: 'Grocery Store', memo: '', num: '', category: '' });
});

test('the downloadable spreadsheet template imports as money out / money in', () => {
  const fs = require('node:fs');
  const r = IMP.parseCSV(fs.readFileSync(require.resolve('../public/tally-import-template.csv'), 'utf8'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => [x.date, x.payee, x.amount, x.category, x.num]), [
    ['2026-09-01', 'Corner Grocery', -5420, 'Food:Groceries', ''],
    ['2026-09-03', 'City Water', -3810, 'Bills & Utilities:Water & Sewer', '1042'],
    ['2026-09-15', 'Social Security', 185000, 'Other Income', ''],
  ]);
  // The same file after Excel re-saves it: CRLF, reformatted dates, $ signs, thousands separators
  const excel = 'Date,Payee,Money Out,Money In,Category,Memo,Check Number\r\n9/1/2026,Corner Grocery,$54.20,,,,\r\n1-Sep-26,Pharmacy,"$1,204.00",,,,\r\n';
  assert.deepEqual(IMP.parseCSV(excel).rows.map((x) => [x.date, x.amount]), [['2026-09-01', -5420], ['2026-09-01', -120400]]);
});

test('OFX (SGML, unclosed tags) parses transactions and statement balance', () => {
  const ofx = `OFXHEADER:100
DATA:OFXSGML

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>123<ACCTID>987654321<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20240101
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240105120000[-5:EST]<TRNAMT>-42.17<FITID>A1<NAME>GROCERY &amp; MORE<MEMO>POS 1234
<STMTTRN><TRNTYPE>CHECK<DTPOSTED>20240106<TRNAMT>-100.00<FITID>A2<CHECKNUM>1042<NAME>CHECK 1042
</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1234.56<DTASOF>20240131</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.equal(IMP.detectFormat(ofx, 'x.qfx'), 'ofx');
  const r = IMP.parseOFX(ofx);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { date: '2024-01-05', amount: -4217, payee: 'GROCERY & MORE', memo: 'POS 1234', num: '', import_id: 'A1' });
  assert.equal(r.rows[1].num, '1042');
  assert.deepEqual(r.statement, { balance: 123456, date: '2024-01-31' });
  assert.equal(r.account.number, '4321');
});

const QIF = `!Option:AutoSwitch
!Account
NChecking
TBank
^
NMortgage
TOth L
^
!Clear:AutoSwitch
!Type:Cat
NFood
E
^
NFood:Groceries
E
^
NSalary
I
^
!Account
NChecking
TBank
^
!Type:Bank
D1/ 1'24
T1,000.00
CX
POpening Balance
L[Checking]
^
D1/ 5'24
T-54.20
C*
PGrocery Store
LFood:Groceries/Weekly
^
D1/10'24
T-1,500.00
N101
PHome Loan Co
SMortgage Interest
$-1,200.00
S[Mortgage]
EPrincipal
$-300.00
^
D1/15'24
T2,000.00
PEmployer
LSalary
^
!Account
NMortgage
TOth L
^
!Type:Oth L
D1/ 1'24
T-200,000.00
POpening Balance
L[Mortgage]
^
D1/10'24
T300.00
PHome Loan Co
L[Checking]
^
!Account
NBrokerage
TInvst
^
!Type:Invst
D1/12'24
NBuy
YACME
I10
Q5
T50
^
`;

test('QIF: multi-account Quicken export', () => {
  assert.equal(IMP.detectFormat(QIF), 'qif');
  const r = IMP.parseQIF(QIF);
  const names = r.accounts.map((a) => [a.name, a.type, a.txns.length]);
  assert.deepEqual(names, [['Checking', 'checking', 3], ['Mortgage', 'loan', 1], ['Brokerage', 'investment', 0]]);
  const ck = r.accounts[0];
  assert.deepEqual(ck.opening, { amount: 100000, date: '2024-01-01' });
  assert.equal(ck.txns[0].category, 'Food:Groceries');
  assert.equal(ck.txns[0].status, 'c');
  assert.deepEqual(ck.txns[1].splits, [{ category: 'Mortgage Interest', memo: '', amount: -120000 }, { transfer: 'Mortgage', memo: 'Principal', amount: -30000 }]);
  assert.equal(ck.txns[1].num, '101');
  assert.equal(r.accounts[1].opening.amount, -20000000);
  assert.ok(r.categories.find((c) => c.path === 'Salary' && c.kind === 'income'));
  assert.ok(r.warnings.some((w) => /investment/.test(w)));
});

test('QIF: single-account bank export goes to the target account', () => {
  const r = IMP.parseQIF('!Type:CCard\nD03/01/2024\nT-20.00\nPStore\n^\n');
  assert.equal(r.accounts.length, 1);
  assert.equal(r.accounts[0].name, IMP.TARGET);
  assert.equal(r.accounts[0].type, 'credit');
});
