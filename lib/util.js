'use strict';

const pad = (n) => String(n).padStart(2, '0');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mkDate(y, m, d) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return mkDate(y, m, d) === s;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Adds months, clamping to month end; anchorDay keeps "the 31st" from drifting to the 28th forever.
function addMonths(iso, n, anchorDay) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = anchorDay || d;
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

const monthOf = (iso) => iso.slice(0, 7);
function monthStart(ym) { return `${ym}-01`; }
function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
function shiftMonth(ym, n) { return addMonths(`${ym}-01`, n).slice(0, 7); }
function isMonth(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }

// Parses a money string to integer cents. Handles $, commas, (parens), trailing minus, decimal comma.
function parseMoney(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.trim();
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/[\s$€£¥]|USD|CAD|EUR|GBP/gi, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  // Decimal comma: "1.234,56" or "12,50"
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [i, f = ''] = s.split('.');
  let cents = parseInt(i || '0', 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
  if (f.length > 2 && Number(f[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function expandYear(y, apostrophe) {
  if (y.length > 2) return Number(y);
  const n = Number(y);
  if (apostrophe) return 2000 + n; // Quicken writes 1/15'24 for 2024
  const pivot = (new Date().getFullYear() % 100) + 10;
  return n <= pivot ? 2000 + n : 1900 + n;
}

// Parses common bank/Quicken date formats to ISO. order: 'MDY' | 'DMY' for ambiguous numeric dates.
function parseDate(raw, order = 'MDY') {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return mkDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return mkDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)];
    return mo ? mkDate(expandYear(m[3]), mo, +m[2]) : null;
  }
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s,-]+(\d{2,4})/))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
    return mo ? mkDate(expandYear(m[3]), mo, +m[1]) : null;
  }
  const t = s.replace(/\s+/g, '');
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})(['/.-])(\d{1,4})/))) {
    const y = expandYear(m[4], m[3] === "'");
    const a = +m[1], b = +m[2];
    return order === 'DMY' ? mkDate(y, b, a) : mkDate(y, a, b);
  }
  return null;
}

// Looks at a set of numeric dates and decides whether they are month-first or day-first.
function detectDateOrder(values) {
  let mdy = 0, dmy = 0;
  for (const v of values) {
    const m = String(v || '').replace(/\s+/g, '').match(/^(\d{1,2})[/.-](\d{1,2})['/.-]/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return dmy > mdy ? 'DMY' : 'MDY';
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

module.exports = {
  pad, todayISO, mkDate, isISODate, addDays, addMonths, monthOf, monthStart, monthEnd, shiftMonth, isMonth,
  parseMoney, parseDate, detectDateOrder, HttpError, bad,
};
