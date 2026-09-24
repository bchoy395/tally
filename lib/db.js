'use strict';

const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL,                       -- checking savings cash credit loan asset investment
  opening_balance INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT,
  institution TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  closed INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  last_reconciled_date TEXT,
  last_reconciled_balance INTEGER
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'expense',     -- income | expense | other (excluded from reports)
  hidden INTEGER NOT NULL DEFAULT 0
);

-- amount is signed integer cents: negative = money out of the account.
-- transfer_id links the two halves of a transfer (or a split line's counterpart back to its parent).
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  num TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  transfer_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT '',          -- '' uncleared, 'c' cleared, 'R' reconciled
  import_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS txn_account_date ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS txn_date ON transactions(date);
CREATE INDEX IF NOT EXISTS txn_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS txn_transfer ON transactions(transfer_id);
CREATE INDEX IF NOT EXISTS txn_import ON transactions(account_id, import_id);

CREATE TABLE IF NOT EXISTS splits (
  id INTEGER PRIMARY KEY,
  txn_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  transfer_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  memo TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS split_txn ON splits(txn_id);
CREATE INDEX IF NOT EXISTS split_category ON splits(category_id);

CREATE TABLE IF NOT EXISTS budgets (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY (category_id, month)
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  match TEXT NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scheduled (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payee TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  transfer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  memo TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL,                  -- once weekly biweekly monthly quarterly yearly
  next_date TEXT NOT NULL,
  anchor_day INTEGER,
  end_date TEXT,
  auto_enter INTEGER NOT NULL DEFAULT 0
);
`;

const DEFAULT_CATEGORIES = {
  income: {
    Salary: [], Bonus: [], Interest: [], Dividends: [], 'Gifts Received': [], Refunds: [], 'Other Income': [],
  },
  expense: {
    'Auto & Transport': ['Fuel', 'Parking & Tolls', 'Service & Parts', 'Auto Insurance', 'Car Payment', 'Public Transit', 'Rideshare'],
    'Bills & Utilities': ['Electricity', 'Gas & Heating', 'Water & Sewer', 'Internet', 'Mobile Phone', 'Trash'],
    Food: ['Groceries', 'Restaurants', 'Coffee'],
    Home: ['Rent', 'Mortgage Interest', 'Maintenance', 'Furnishings', 'Home Insurance', 'Property Tax'],
    Health: ['Doctor', 'Pharmacy', 'Dental', 'Health Insurance', 'Fitness'],
    Shopping: ['Clothing', 'Electronics', 'Household', 'Books'],
    Entertainment: ['Streaming', 'Movies & Events', 'Hobbies', 'Games'],
    Travel: ['Airfare', 'Lodging', 'Rental Car'],
    'Personal Care': [],
    Education: ['Tuition', 'Student Loan Interest'],
    'Gifts & Donations': ['Gifts', 'Charity'],
    Taxes: ['Federal Tax', 'State Tax'],
    'Fees & Charges': ['Bank Fees', 'Interest Paid', 'Service Fees'],
    Kids: ['Childcare', 'Activities'],
    Pets: [],
    Subscriptions: [],
    Miscellaneous: [],
  },
  other: { 'Balance Adjustment': [] },
};

function seedCategories(db) {
  const ins = db.prepare('INSERT INTO categories (name, parent_id, kind) VALUES (?, ?, ?)');
  for (const [kind, groups] of Object.entries(DEFAULT_CATEGORIES)) {
    for (const [name, children] of Object.entries(groups)) {
      const { lastInsertRowid: pid } = ins.run(name, null, kind);
      for (const c of children) ins.run(c, pid, kind);
    }
  }
}

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!v) {
    db.exec('BEGIN');
    seedCategories(db);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('currency', 'USD')").run();
    db.exec('COMMIT');
  }
  return db;
}

// Runs fn inside a transaction; nested calls join the outer one.
function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { open, tx, SCHEMA, seedCategories };
