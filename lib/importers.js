'use strict';
// Parsers for bank/Quicken export formats. Every parser returns plain rows with ISO dates and integer cents;
// nothing here touches the database.

const { parseMoney, parseDate, detectDateOrder } = require('./util');

function detectFormat(text, filename = '') {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'qif') return 'qif';
  if (ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (/OFXHEADER|<OFX>/i.test(text.slice(0, 4000))) return 'ofx';
  if (/^\s*!(Type|Account|Option)/im.test(text.slice(0, 4000))) return 'qif';
  return 'csv';
}

/* ------------------------------------------------------------------ CSV */

function splitCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';

  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const HEADER_PATTERNS = {
  date: [/^(transaction |trans\.? |posting |post(ed)? )?date$/i, /date/i],
  payee: [/^(payee|description|merchant|name)$/i, /payee|description|merchant|name|details|narrative/i],
  amount: [/^amount$/i, /amount|value/i],
  debit: [/^(debit|withdrawals?|outflow|money out)$/i, /debit|withdraw|outflow|money out/i],
  credit: [/^(credit|deposits?|inflow|money in)$/i, /credit|deposit|inflow|money in/i],
  memo: [/^(memo|notes?)$/i, /memo|note|reference|remarks/i],
  category: [/^category$/i, /category/i],
  num: [/^(check|cheque|num|number|check ?#|check number)$/i, /check|cheque/i],
  type: [/^(transaction type|type|dr\/cr|debit\/credit)$/i, /^(transaction type|dr\/cr)$/i],
};

function guessMapping(headers) {
  const map = {};
  const used = new Set();
  for (const pass of [0, 1]) {
    for (const [key, pats] of Object.entries(HEADER_PATTERNS)) {
      if (map[key] !== undefined) continue;
      const idx = headers.findIndex((h, i) => !used.has(i) && pats[pass].test(h) && !/balance/i.test(h));
      if (idx >= 0) { map[key] = idx; used.add(idx); }
    }
  }
  if (map.amount !== undefined) { delete map.debit; delete map.credit; }
  return map;
}

function guessMappingFromContent(rows) {
  const n = rows[0].length;
  const sample = rows.slice(0, 50);
  const map = {};
  const score = (i, fn) => sample.filter((r) => fn(r[i])).length / sample.length;
  for (let i = 0; i < n; i++) if (map.date === undefined && score(i, (v) => parseDate(v)) > 0.8) map.date = i;
  for (let i = 0; i < n; i++) {
    if (i === map.date) continue;
    if (map.amount === undefined && score(i, (v) => /\d\.\d\d\)?-?$/.test(v || '') && parseMoney(v) !== null) > 0.8) map.amount = i;
  }
  let best = -1, bestLen = 0;
  for (let i = 0; i < n; i++) {
    if (i === map.date || i === map.amount) continue;
    const len = sample.reduce((s, r) => s + (parseMoney(r[i]) === null ? (r[i] || '').length : 0), 0);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  if (best >= 0) map.payee = best;
  return map;
}

// opts: { mapping?, dateOrder?: 'auto'|'MDY'|'DMY', negate?: bool, hasHeader?: bool }
function parseCSV(text, opts = {}) {
  const all = splitCSV(text);
  if (!all.length) return { headers: [], mapping: {}, rows: [], errors: ['The file is empty.'] };
  let headerIdx = -1;
  if (opts.hasHeader !== false) {
    headerIdx = all.slice(0, 15).findIndex((r) => r.length >= 3 && r.some((c) => /date/i.test(c)) && !r.some((c) => parseDate(c)));
    if (headerIdx < 0 && !all[0].some((c) => parseDate(c) || parseMoney(c) !== null)) headerIdx = 0;
  }
  const width = Math.max(...all.map((r) => r.length));
  const headers = headerIdx >= 0 ? all[headerIdx] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const data = all.slice(headerIdx + 1);
  let mapping = opts.mapping && Object.keys(opts.mapping).length ? opts.mapping : null;
  if (!mapping) {
    mapping = headerIdx >= 0 ? guessMapping(headers) : {};
    if (mapping.date === undefined || (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined)) {
      mapping = { ...(data.length ? guessMappingFromContent(data) : {}), ...mapping };
    }
  }
  const col = (r, k) => (mapping[k] === undefined || mapping[k] === null || mapping[k] === '' ? '' : (r[+mapping[k]] || ''));
  const dateOrder = !opts.dateOrder || opts.dateOrder === 'auto' ? detectDateOrder(data.map((r) => col(r, 'date'))) : opts.dateOrder;

  const rows = [], errors = [];
  data.forEach((r, i) => {
    const line = i + headerIdx + 2;
    const date = parseDate(col(r, 'date'), dateOrder);
    let amount;
    if (mapping.amount !== undefined && mapping.amount !== '') amount = parseMoney(col(r, 'amount'));
    else {
      const d = parseMoney(col(r, 'debit')), c = parseMoney(col(r, 'credit'));
      amount = d === null && c === null ? null : Math.abs(c || 0) - Math.abs(d || 0);
    }
    if (!date && amount === null) return; // blank/footer lines
    if (!date) { errors.push(`Line ${line}: couldn't read the date "${col(r, 'date')}".`); return; }
    if (amount === null) { errors.push(`Line ${line}: couldn't read the amount.`); return; }
    // Exports like Mint's list positive amounts plus a debit/credit column.
    const kind = col(r, 'type').toLowerCase();
    if (/^(debit|dr|withdrawal|sale|purchase|payment out)$/.test(kind)) amount = -Math.abs(amount);
    else if (/^(credit|cr|deposit)$/.test(kind)) amount = Math.abs(amount);
    if (opts.negate) amount = -amount;
    rows.push({
      date, amount,
      payee: col(r, 'payee'),
      memo: col(r, 'memo'),
      num: col(r, 'num'),
      category: col(r, 'category'),
    });
  });
  return { headers, mapping, dateOrder, rows, errors };
}

/* ------------------------------------------------------------------ OFX / QFX */

function ofxField(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? decodeEntities(m[1].trim()) : '';
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function parseOFX(text) {
  const rows = [], errors = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    const date = parseDate(ofxField(b, 'DTPOSTED'));
    const amount = parseMoney(ofxField(b, 'TRNAMT'));
    if (!date || amount === null) { errors.push(`Skipped a transaction with an unreadable date or amount (${ofxField(b, 'FITID') || 'no id'}).`); continue; }
    const name = ofxField(b, 'NAME') || ofxField(b, 'PAYEE');
    const memo = ofxField(b, 'MEMO');
    rows.push({
      date, amount,
      payee: name || memo,
      memo: name ? memo : '',
      num: ofxField(b, 'CHECKNUM'),
      import_id: ofxField(b, 'FITID') || null,
    });
  }
  const ledger = text.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i);
  const statement = ledger ? { balance: parseMoney(ofxField(ledger[1], 'BALAMT')), date: parseDate(ofxField(ledger[1], 'DTASOF')) } : null;
  const acct = ofxField(text, 'ACCTID');
  const isCC = /<CCSTMTRS>/i.test(text);
  return { rows, errors, statement, account: { number: acct ? acct.slice(-4) : '', type: isCC ? 'credit' : 'checking' } };
}

/* ------------------------------------------------------------------ QIF */

const QIF_ACCOUNT_TYPES = {
  bank: 'checking', cash: 'cash', ccard: 'credit', 'oth a': 'asset', 'oth l': 'loan',
  invst: 'investment', port: 'investment', '401(k)/403(b)': 'investment', invoice: 'asset',
};
const TARGET = '__target__';

function stripClass(cat) {
  // "Food:Groceries/Vacation" → "Food:Groceries"; transfers keep their brackets.
  const i = cat.indexOf('/');
  return (i >= 0 ? cat.slice(0, i) : cat).trim();
}
function qifStatus(c) {
  c = (c || '').trim();
  if (c === 'X' || c === 'R') return 'R';
  if (c === '*' || c.toLowerCase() === 'c') return 'c';
  return '';
}
function splitCategory(raw) {
  const v = stripClass(raw || '');
  const t = v.match(/^\[(.+)\]$/);
  return t ? { transfer: t[1].trim() } : { category: v };
}

// Returns { accounts: [{name, type, txns}], categories: [{path, kind}], warnings, dateOrder }.
// Transactions in a file without !Account headers belong to the pseudo-account TARGET.
function parseQIF(text, opts = {}) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const dateOrder = !opts.dateOrder || opts.dateOrder === 'auto'
    ? detectDateOrder(lines.filter((l) => l[0] === 'D').map((l) => l.slice(1)))
    : opts.dateOrder;
  const accounts = new Map();
  const categories = new Map();
  const warnings = [];
  let mode = 'txn', section = 'bank', inList = false, current = null;
  let rec = {}, skippedInvest = 0, skippedOther = 0;

  const account = (name, type) => {
    const key = name.toLowerCase();
    if (!accounts.has(key)) accounts.set(key, { name, type: type || 'checking', txns: [], described: false });
    const a = accounts.get(key);
    if (type && !a.described) { a.type = type; a.described = true; }
    return a;
  };

  const flush = () => {
    const r = rec; rec = {};
    if (!Object.keys(r).length) return;
    if (mode === 'account') {
      if (!r.N) return;
      const type = QIF_ACCOUNT_TYPES[(r.T || '').toLowerCase()] || 'checking';
      const a = account(r.N, type);
      if (!inList) current = a;
    } else if (mode === 'cat') {
      if (r.N && !r.N.startsWith('[')) categories.set(r.N.toLowerCase(), { path: stripClass(r.N), kind: r.I !== undefined ? 'income' : 'expense' });
    } else if (mode === 'txn') {
      const date = parseDate(r.D, dateOrder);
      const amount = parseMoney(r.T !== undefined ? r.T : r.U);
      if (!date || amount === null) { warnings.push(`Skipped a record with date "${r.D || ''}" and amount "${r.T || r.U || ''}".`); return; }
      const acct = current || account(TARGET);
      const txn = { date, amount, payee: r.P || '', memo: r.M || '', num: r.N || '', status: qifStatus(r.C) };
      Object.assign(txn, splitCategory(r.L));
      if (r.splits && r.splits.length) {
        txn.splits = r.splits.map((s) => ({ ...splitCategory(s.S), memo: s.E || '', amount: parseMoney(s.$) || 0 }));
        delete txn.category; delete txn.transfer;
        const sum = txn.splits.reduce((a, s) => a + s.amount, 0);
        if (sum !== amount) txn.splits.push({ category: '', memo: 'Unassigned remainder', amount: amount - sum });
        if (txn.splits.length === 1 && !txn.splits[0].memo) {
          Object.assign(txn, txn.splits[0].transfer ? { transfer: txn.splits[0].transfer } : { category: txn.splits[0].category });
          delete txn.splits;
        }
      }
      if (txn.category) {
        const key = txn.category.toLowerCase();
        if (!categories.has(key)) categories.set(key, { path: txn.category, kind: amount > 0 ? 'income' : 'expense' });
      }
      for (const s of txn.splits || []) {
        if (s.category && !categories.has(s.category.toLowerCase())) categories.set(s.category.toLowerCase(), { path: s.category, kind: s.amount > 0 ? 'income' : 'expense' });
      }
      // "Opening Balance" that transfers to its own account sets the opening balance.
      if (/^opening balance$/i.test(txn.payee) && !txn.splits) {
        const self = txn.transfer !== undefined && (acct.name === TARGET || txn.transfer.toLowerCase() === acct.name.toLowerCase());
        if (self || (!txn.transfer && !txn.category)) { acct.opening = { amount, date }; return; }
      }
      acct.txns.push(txn);
    } else if (mode === 'invst') skippedInvest++;
    else skippedOther++;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    if (line[0] === '!') {
      flush();
      const h = line.slice(1).trim().toLowerCase();
      if (h === 'option:autoswitch') inList = true;
      else if (h === 'clear:autoswitch') inList = false;
      else if (h === 'account') mode = 'account';
      else if (h.startsWith('type:')) {
        section = h.slice(5).trim();
        if (section === 'cat') mode = 'cat';
        else if (section === 'invst') mode = 'invst';
        else if (['bank', 'cash', 'ccard', 'oth a', 'oth l', 'invoice'].includes(section)) {
          mode = 'txn';
          if (current && !current.described) current.type = QIF_ACCOUNT_TYPES[section] || current.type;
          if (!current) account(TARGET).type = QIF_ACCOUNT_TYPES[section] || 'checking';
        } else mode = 'skip';
      }
      continue;
    }
    if (line[0] === '^') { flush(); continue; }
    const code = line[0], val = line.slice(1).trim();
    if (mode === 'txn' && (code === 'S' || code === 'E' || code === '$')) {
      rec.splits = rec.splits || [];
      if (code === 'S' || !rec.splits.length || (code in rec.splits[rec.splits.length - 1])) rec.splits.push({});
      rec.splits[rec.splits.length - 1][code] = val;
    } else if (mode === 'txn' && code === 'A') {
      // address lines — ignored
    } else rec[code] = val;
  }
  flush();

  if (skippedInvest) warnings.push(`${skippedInvest} investment transactions were skipped (investment holdings aren't tracked; use "Update balance" on investment accounts instead).`);
  if (skippedOther) warnings.push(`${skippedOther} memorized/class/price records were skipped.`);
  const list = [...accounts.values()].filter((a) => a.name !== TARGET || a.txns.length || a.opening)
    .map(({ described, ...a }) => a);
  return { accounts: list, categories: [...categories.values()], warnings, dateOrder };
}

module.exports = { detectFormat, splitCSV, parseCSV, guessMapping, parseOFX, parseQIF, TARGET };
