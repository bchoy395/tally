'use strict';

const { tx, seedCategories } = require('./db');
const U = require('./util');
const { bad, HttpError } = U;
const IMP = require('./importers');

const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit', 'loan', 'asset', 'investment'];
const LIABILITY_TYPES = new Set(['credit', 'loan']);
const FREQUENCIES = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const STATUSES = ['', 'c', 'R'];

const notFound = (what) => new HttpError(404, `${what} not found.`);
const str = (v, max = 500) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const idOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
function cents(v, name) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isInteger(n) || Math.abs(n) > 1e13) throw bad(`${name} must be a whole number of cents.`);
  return n;
}
function isoDate(v, name, optional = false) {
  if (optional && (v === null || v === undefined || v === '')) return null;
  if (!U.isISODate(v)) throw bad(`${name} must be a valid date (YYYY-MM-DD).`);
  return v;
}

// Every income/expense "line": a whole transaction, or one split line. Transfers are excluded.
const LINES = `
  SELECT t.id AS txn_id, t.account_id, t.date, t.payee,
    CASE WHEN s.id IS NULL THEN t.category_id ELSE s.category_id END AS category_id,
    CASE WHEN s.id IS NULL THEN t.amount ELSE s.amount END AS amount
  FROM transactions t LEFT JOIN splits s ON s.txn_id = t.id
  WHERE t.transfer_id IS NULL AND s.transfer_id IS NULL`;

const TXN_SELECT = `
  SELECT t.*, a.name AS account_name, a.opening_balance,
    l.account_id AS transfer_account_id, la.name AS transfer_account_name,
    CASE WHEN t.transfer_id IS NOT NULL AND (l.transfer_id IS NULL OR l.transfer_id != t.id) THEN l.id END AS split_parent_id,
    (SELECT COUNT(*) FROM splits s WHERE s.txn_id = t.id) AS split_count
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN transactions l ON l.id = t.transfer_id
  LEFT JOIN accounts la ON la.id = l.account_id`;

class Ledger {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
  }

  q(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all(sql, ...p) { return this.q(sql).all(...p); }
  get(sql, ...p) { return this.q(sql).get(...p); }
  run(sql, ...p) { return this.q(sql).run(...p); }
  tx(fn) { return tx(this.db, fn); }

  /* ---------------------------------------------------------------- settings */

  getSettings() {
    const rows = this.all('SELECT key, value FROM meta');
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { currency: m.currency || 'USD' };
  }
  saveSettings(input) {
    if (input.currency !== undefined) {
      const c = str(input.currency, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(c)) throw bad('Currency must be a 3-letter code like USD.');
      this.run("INSERT INTO meta (key, value) VALUES ('currency', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", c);
    }
    return this.getSettings();
  }

  /* ---------------------------------------------------------------- accounts */

  listAccounts() {
    const today = U.todayISO();
    return this.all(`
      SELECT a.*,
        a.opening_balance + COALESCE(SUM(t.amount), 0) AS ending_balance,
        a.opening_balance + COALESCE(SUM(CASE WHEN t.date <= ? THEN t.amount END), 0) AS balance,
        a.opening_balance + COALESCE(SUM(CASE WHEN t.status != '' THEN t.amount END), 0) AS cleared_balance,
        COUNT(t.id) AS txn_count
      FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
      GROUP BY a.id ORDER BY a.closed, a.sort, a.name COLLATE NOCASE`, today)
      .map((a) => ({ ...a, liability: LIABILITY_TYPES.has(a.type) }));
  }

  getAccount(id) {
    const a = this.listAccounts().find((x) => x.id === Number(id));
    if (!a) throw notFound('Account');
    return a;
  }

  saveAccount(input, id = null) {
    const existing = id ? this.get('SELECT * FROM accounts WHERE id = ?', id) : null;
    if (id && !existing) throw notFound('Account');
    const v = { ...(existing || { opening_balance: 0, institution: '', notes: '', closed: 0, sort: 0 }), ...input };
    const name = str(v.name, 100);
    if (!name) throw bad('Account name is required.');
    if (!ACCOUNT_TYPES.includes(v.type)) throw bad(`Account type must be one of: ${ACCOUNT_TYPES.join(', ')}.`);
    const row = [name, v.type, cents(v.opening_balance || 0, 'Opening balance'), isoDate(v.opening_date, 'Opening date', true),
      str(v.institution, 100), str(v.notes, 2000), v.closed ? 1 : 0, Number(v.sort) || 0];
    const dup = this.get('SELECT id FROM accounts WHERE name = ? COLLATE NOCASE AND id IS NOT ?', name, id);
    if (dup) throw bad(`An account named "${name}" already exists.`);
    if (existing) {
      this.run('UPDATE accounts SET name=?, type=?, opening_balance=?, opening_date=?, institution=?, notes=?, closed=?, sort=? WHERE id=?', ...row, id);
      return this.getAccount(id);
    }
    const { lastInsertRowid } = this.run('INSERT INTO accounts (name, type, opening_balance, opening_date, institution, notes, closed, sort) VALUES (?,?,?,?,?,?,?,?)', ...row);
    return this.getAccount(Number(lastInsertRowid));
  }

  deleteAccount(id) {
    if (!this.get('SELECT id FROM accounts WHERE id = ?', id)) throw notFound('Account');
    this.tx(() => {
      // Split lines that transferred into this account lose their link and become uncategorized.
      this.run('DELETE FROM accounts WHERE id = ?', id);
    });
    return { ok: true };
  }

  balanceAsOf(accountId, date) {
    return this.get(`SELECT a.opening_balance + COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id AND date <= ?), 0) AS b
      FROM accounts a WHERE a.id = ?`, date, accountId).b;
  }

  // For accounts whose value changes without transactions (investments, a house): records the difference.
  adjustBalance(id, { date, balance }) {
    this.getAccount(id);
    isoDate(date, 'Date');
    const target = cents(balance, 'Balance');
    const diff = target - this.balanceAsOf(id, date);
    if (diff === 0) return null;
    const cat = this.ensureCategoryPath('Balance Adjustment', 'other');
    return this.saveTxn({ account_id: id, date, payee: 'Balance Adjustment', amount: diff, category_id: cat, status: 'R', memo: `Balance updated to ${(target / 100).toFixed(2)}` });
  }

  reconcile(id, { statement_date, statement_balance, txn_ids = [], adjust = false }) {
    const acct = this.getAccount(id);
    isoDate(statement_date, 'Statement date');
    const target = cents(statement_balance, 'Statement balance');
    const ids = txn_ids.map(Number);
    return this.tx(() => {
      if (ids.length) {
        const n = this.db.prepare(`UPDATE transactions SET status = 'R' WHERE account_id = ? AND id IN (${ids.map(() => '?').join(',')})`).run(id, ...ids).changes;
        if (Number(n) !== ids.length) throw bad('Some selected transactions do not belong to this account.');
      }
      const reconciled = acct.opening_balance + (this.get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id = ? AND status = 'R'", id).s);
      const diff = target - reconciled;
      if (diff !== 0) {
        if (!adjust) throw bad(`Reconciled balance is off by ${(diff / 100).toFixed(2)}.`);
        const cat = this.ensureCategoryPath('Balance Adjustment', 'other');
        this.saveTxn({ account_id: id, date: statement_date, payee: 'Reconciliation Adjustment', amount: diff, category_id: cat, status: 'R' });
      }
      this.run('UPDATE accounts SET last_reconciled_date = ?, last_reconciled_balance = ? WHERE id = ?', statement_date, target, id);
      return { ok: true, adjustment: diff };
    });
  }

  /* ---------------------------------------------------------------- categories */

  categoryMap() {
    const rows = this.all('SELECT * FROM categories');
    const byId = new Map(rows.map((r) => [r.id, { ...r }]));
    const resolve = (c, seen = new Set()) => {
      if (c.path) return c;
      const p = c.parent_id ? byId.get(c.parent_id) : null;
      if (p && !seen.has(p.id)) {
        seen.add(c.id);
        resolve(p, seen);
        c.path = `${p.path}:${c.name}`; c.depth = p.depth + 1; c.top_id = p.top_id;
        c.sortKey = `${p.sortKey}\u0000${c.name.toLowerCase()}`;
      } else {
        c.path = c.name; c.depth = 0; c.top_id = c.id; c.sortKey = c.name.toLowerCase();
      }
      return c;
    };
    for (const c of byId.values()) resolve(c);
    return byId;
  }

  listCategories() {
    const counts = new Map(this.all(`SELECT category_id, COUNT(*) n FROM (SELECT category_id FROM transactions UNION ALL SELECT category_id FROM splits)
      WHERE category_id IS NOT NULL GROUP BY category_id`).map((r) => [r.category_id, r.n]));
    const order = { income: 0, expense: 1, other: 2 };
    return [...this.categoryMap().values()]
      .sort((a, b) => order[a.kind] - order[b.kind] || (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
      .map(({ sortKey, ...c }) => ({ ...c, txn_count: counts.get(c.id) || 0 }));
  }

  descendants(id) {
    return this.all(`WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN d ON c.parent_id = d.id) SELECT id FROM d`, id).map((r) => r.id);
  }

  ensureCategoryPath(path, kind = 'expense') {
    const parts = String(path).split(':').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    let parent = null;
    for (const name of parts) {
      const row = this.get('SELECT id, kind FROM categories WHERE parent_id IS ? AND name = ? COLLATE NOCASE', parent, name);
      if (row) { parent = row.id; continue; }
      const k = parent ? this.get('SELECT kind FROM categories WHERE id = ?', parent).kind : kind;
      parent = Number(this.run('INSERT INTO categories (name, parent_id, kind) VALUES (?, ?, ?)', name, parent, k).lastInsertRowid);
    }
    return parent;
  }

  saveCategory(input, id = null) {
    const existing = id ? this.get('SELECT * FROM categories WHERE id = ?', id) : null;
    if (id && !existing) throw notFound('Category');
    const v = { ...(existing || { kind: 'expense', hidden: 0, parent_id: null }), ...input };
    const name = str(v.name, 100);
    if (!name) throw bad('Category name is required.');
    if (name.includes(':')) throw bad('Category names can\'t contain ":" (it separates parent and subcategory).');
    const parent = idOrNull(v.parent_id);
    let kind = v.kind;
    if (parent !== null) {
      const p = this.get('SELECT * FROM categories WHERE id = ?', parent);
      if (!p) throw bad('Parent category not found.');
      if (id && this.descendants(id).includes(parent)) throw bad("A category can't be moved inside itself.");
      if (!existing || input.kind === undefined || existing.parent_id !== parent) kind = p.kind;
    }
    if (!['income', 'expense', 'other'].includes(kind)) throw bad('Kind must be income, expense or other.');
    const dup = this.get('SELECT id FROM categories WHERE parent_id IS ? AND name = ? COLLATE NOCASE AND id IS NOT ?', parent, name, id);
    if (dup) throw bad(`"${name}" already exists there.`);
    return this.tx(() => {
      if (existing) {
        this.run('UPDATE categories SET name=?, parent_id=?, kind=?, hidden=? WHERE id=?', name, parent, kind, v.hidden ? 1 : 0, id);
        if (kind !== existing.kind) {
          const ids = this.descendants(id);
          this.db.prepare(`UPDATE categories SET kind = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(kind, ...ids);
        }
      } else {
        id = Number(this.run('INSERT INTO categories (name, parent_id, kind, hidden) VALUES (?,?,?,?)', name, parent, kind, v.hidden ? 1 : 0).lastInsertRowid);
      }
      return this.listCategories().find((c) => c.id === id);
    });
  }

  deleteCategory(id, reassignTo = null) {
    const c = this.get('SELECT * FROM categories WHERE id = ?', id);
    if (!c) throw notFound('Category');
    const target = idOrNull(reassignTo);
    if (target !== null) {
      if (!this.get('SELECT id FROM categories WHERE id = ?', target)) throw bad('Replacement category not found.');
      if (this.descendants(id).includes(target)) throw bad("Pick a replacement that isn't this category or one of its subcategories.");
    }
    this.tx(() => {
      this.run('UPDATE categories SET parent_id = ? WHERE parent_id = ?', c.parent_id, id);
      this.run('UPDATE transactions SET category_id = ? WHERE category_id = ?', target, id);
      this.run('UPDATE splits SET category_id = ? WHERE category_id = ?', target, id);
      this.run('UPDATE rules SET category_id = ? WHERE category_id = ?', target, id);
      this.run('UPDATE scheduled SET category_id = ? WHERE category_id = ?', target, id);
      if (target !== null) {
        this.run(`INSERT INTO budgets (category_id, month, amount) SELECT ?, month, amount FROM budgets WHERE category_id = ?
          ON CONFLICT(category_id, month) DO UPDATE SET amount = budgets.amount + excluded.amount`, target, id);
      }
      this.run('DELETE FROM categories WHERE id = ?', id);
    });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- transactions */

  txnRow(id) { return this.get(`${TXN_SELECT} WHERE t.id = ?`, id); }

  getTxn(id) {
    const t = this.txnRow(id);
    if (!t) throw notFound('Transaction');
    t.splits = this.all(`SELECT s.id, s.category_id, s.amount, s.memo, s.transfer_id, c.account_id AS transfer_account_id
      FROM splits s LEFT JOIN transactions c ON c.id = s.transfer_id WHERE s.txn_id = ? ORDER BY s.id`, id);
    return t;
  }

  // filters: account_id, q, payee, from, to, category_id, include_sub, uncategorized, status, limit, offset
  listTxns(f = {}) {
    const where = [], p = [];
    if (f.account_id) { where.push('x.account_id = ?'); p.push(Number(f.account_id)); }
    if (f.from) { where.push('x.date >= ?'); p.push(isoDate(f.from, 'From')); }
    if (f.to) { where.push('x.date <= ?'); p.push(isoDate(f.to, 'To')); }
    if (f.payee) { where.push('x.payee = ? COLLATE NOCASE'); p.push(String(f.payee)); }
    if (f.q) {
      const like = `%${String(f.q).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const amt = U.parseMoney(f.q);
      where.push(`(x.payee LIKE ? ESCAPE '\\' OR x.memo LIKE ? ESCAPE '\\' OR x.num LIKE ? ESCAPE '\\'${amt !== null && amt !== 0 ? ' OR ABS(x.amount) = ?' : ''})`);
      p.push(like, like, like);
      if (amt !== null && amt !== 0) p.push(Math.abs(amt));
    }
    if (f.category_id) {
      const ids = f.include_sub === '0' || f.include_sub === false ? [Number(f.category_id)] : this.descendants(Number(f.category_id));
      const ph = ids.map(() => '?').join(',');
      where.push(`(x.category_id IN (${ph}) OR EXISTS (SELECT 1 FROM splits s WHERE s.txn_id = x.id AND s.category_id IN (${ph})))`);
      p.push(...ids, ...ids);
    }
    if (f.uncategorized && f.uncategorized !== '0') {
      where.push(`((x.transfer_id IS NULL AND x.category_id IS NULL AND x.split_count = 0)
        OR EXISTS (SELECT 1 FROM splits s WHERE s.txn_id = x.id AND s.category_id IS NULL AND s.transfer_id IS NULL))`);
    }
    if (f.status) {
      const m = { uncleared: "x.status = ''", cleared: "x.status = 'c'", reconciled: "x.status = 'R'", unreconciled: "x.status != 'R'" }[f.status];
      if (m) where.push(m);
    }
    const base = `SELECT * FROM (
      SELECT q.*, q.opening_balance + SUM(q.amount) OVER (PARTITION BY q.account_id ORDER BY q.date, q.id ROWS UNBOUNDED PRECEDING) AS running_balance
      FROM (${TXN_SELECT}) q) x ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const limit = Math.min(Number(f.limit) || 5000, 50000), offset = Number(f.offset) || 0;
    const rows = this.db.prepare(`${base} ORDER BY x.date DESC, x.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset);
    const agg = this.db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) s FROM (${base})`).get(...p);
    return { rows, total: agg.n, sum: agg.s };
  }

  normalizeTxn(input, existing) {
    const v = { ...(existing || { payee: '', memo: '', num: '', status: '' }), ...input };
    const account_id = Number(v.account_id);
    if (!this.get('SELECT id FROM accounts WHERE id = ?', account_id)) throw bad('Choose an account.');
    const t = {
      account_id,
      date: isoDate(v.date, 'Date'),
      amount: cents(v.amount, 'Amount'),
      payee: str(v.payee, 200),
      memo: str(v.memo, 1000),
      num: str(v.num, 20),
      status: STATUSES.includes(v.status) ? v.status : '',
      category_id: idOrNull(v.category_id),
      transfer_account_id: idOrNull(v.transfer_account_id),
      import_id: v.import_id ? str(v.import_id, 255) : null,
      splits: input.splits,
    };
    if (t.category_id !== null && !this.get('SELECT id FROM categories WHERE id = ?', t.category_id)) throw bad('Category not found.');
    if (t.transfer_account_id !== null) {
      if (t.transfer_account_id === account_id) throw bad("A transfer can't go to the same account.");
      if (!this.get('SELECT id FROM accounts WHERE id = ?', t.transfer_account_id)) throw bad('Transfer account not found.');
      t.category_id = null;
    }
    if (Array.isArray(t.splits)) {
      t.splits = t.splits.map((s, i) => {
        const sp = { category_id: idOrNull(s.category_id), transfer_account_id: idOrNull(s.transfer_account_id), amount: cents(s.amount, `Split ${i + 1} amount`), memo: str(s.memo, 500) };
        if (sp.transfer_account_id !== null) {
          if (sp.transfer_account_id === account_id) throw bad(`Split ${i + 1} can't transfer to the same account.`);
          if (!this.get('SELECT id FROM accounts WHERE id = ?', sp.transfer_account_id)) throw bad(`Split ${i + 1}: transfer account not found.`);
          sp.category_id = null;
        } else if (sp.category_id !== null && !this.get('SELECT id FROM categories WHERE id = ?', sp.category_id)) throw bad(`Split ${i + 1}: category not found.`);
        return sp;
      });
      if (t.splits.length) {
        const sum = t.splits.reduce((a, s) => a + s.amount, 0);
        if (sum !== t.amount) throw bad(`Splits add up to ${(sum / 100).toFixed(2)} but the transaction is ${(t.amount / 100).toFixed(2)}.`);
        t.category_id = null; t.transfer_account_id = null;
      }
    }
    return t;
  }

  insertRaw(t) {
    return Number(this.run(`INSERT INTO transactions (account_id, date, payee, memo, num, amount, category_id, transfer_id, status, import_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, t.account_id, t.date, t.payee || '', t.memo || '', t.num || '', t.amount,
      t.category_id ?? null, t.transfer_id ?? null, t.status || '', t.import_id ?? null).lastInsertRowid);
  }

  splitCounterparts(txnId) {
    return this.all('SELECT c.* FROM splits s JOIN transactions c ON c.id = s.transfer_id WHERE s.txn_id = ?', txnId);
  }

  replaceSplits(txnId, t, splits) {
    const old = this.splitCounterparts(txnId);
    const statusPool = new Map(old.map((c) => [`${c.account_id}|${c.amount}`, c.status]));
    for (const c of old) this.run('DELETE FROM transactions WHERE id = ?', c.id);
    this.run('DELETE FROM splits WHERE txn_id = ?', txnId);
    for (const s of splits) {
      let transferId = null;
      if (s.transfer_account_id) {
        const status = statusPool.get(`${s.transfer_account_id}|${-s.amount}`) || '';
        transferId = this.insertRaw({ account_id: s.transfer_account_id, date: t.date, payee: t.payee, memo: s.memo || t.memo, amount: -s.amount, transfer_id: txnId, status });
      }
      this.run('INSERT INTO splits (txn_id, category_id, transfer_id, amount, memo) VALUES (?,?,?,?,?)', txnId, s.transfer_account_id ? null : s.category_id, transferId, s.amount, s.memo || '');
    }
  }

  saveTxn(input, id = null) {
    return this.tx(() => {
      const existing = id ? this.txnRow(id) : null;
      if (id && !existing) throw notFound('Transaction');
      if (existing && existing.split_parent_id) throw bad('This transaction is part of a split in another account. Edit the original split transaction instead.');
      const t = this.normalizeTxn(input, existing && { ...existing, transfer_account_id: existing.transfer_account_id });
      const hadSplits = existing && existing.split_count > 0;
      const willSplit = Array.isArray(t.splits) ? t.splits.length > 0 : hadSplits && t.category_id === null && t.transfer_account_id === null && input.category_id === undefined && input.transfer_account_id === undefined;
      if (willSplit) { t.category_id = null; t.transfer_account_id = null; }
      if (willSplit && !Array.isArray(t.splits) && t.amount !== existing.amount) throw bad('Change the split amounts so they add up to the new total.');

      let txnId = id;
      if (existing) {
        this.run('UPDATE transactions SET account_id=?, date=?, payee=?, memo=?, num=?, amount=?, category_id=?, status=?, import_id=? WHERE id=?',
          t.account_id, t.date, t.payee, t.memo, t.num, t.amount, t.category_id, t.status, t.import_id, id);
      } else {
        txnId = this.insertRaw(t);
      }

      // Transfer half
      const oldLinked = existing && existing.transfer_id ? this.get('SELECT * FROM transactions WHERE id = ?', existing.transfer_id) : null;
      if (t.transfer_account_id) {
        if (oldLinked && oldLinked.account_id === t.transfer_account_id) {
          this.run('UPDATE transactions SET date=?, payee=?, memo=?, amount=? WHERE id=?', t.date, t.payee, t.memo, -t.amount, oldLinked.id);
        } else {
          if (oldLinked) { this.run('UPDATE transactions SET transfer_id = NULL WHERE id = ?', txnId); this.run('DELETE FROM transactions WHERE id = ?', oldLinked.id); }
          const lid = this.insertRaw({ account_id: t.transfer_account_id, date: t.date, payee: t.payee, memo: t.memo, amount: -t.amount, transfer_id: txnId });
          this.run('UPDATE transactions SET transfer_id = ? WHERE id = ?', lid, txnId);
        }
      } else if (oldLinked) {
        this.run('UPDATE transactions SET transfer_id = NULL WHERE id = ?', txnId);
        this.run('DELETE FROM transactions WHERE id = ?', oldLinked.id);
      }

      // Splits
      if (Array.isArray(t.splits)) this.replaceSplits(txnId, t, t.splits);
      else if (hadSplits && !willSplit) this.replaceSplits(txnId, t, []);
      else if (hadSplits) {
        this.run('UPDATE transactions SET date = ?, payee = ? WHERE id IN (SELECT transfer_id FROM splits WHERE txn_id = ?)', t.date, t.payee, txnId);
      }
      return this.getTxn(txnId);
    });
  }

  deleteTxn(id) {
    const t = this.txnRow(id);
    if (!t) throw notFound('Transaction');
    if (t.split_parent_id) throw bad('This transaction is part of a split in another account. Delete or edit the original instead.');
    this.tx(() => {
      for (const c of this.splitCounterparts(id)) this.run('DELETE FROM transactions WHERE id = ?', c.id);
      if (t.transfer_id) this.run('DELETE FROM transactions WHERE id = ?', t.transfer_id);
      this.run('DELETE FROM transactions WHERE id = ?', id);
    });
    return { ok: true };
  }

  bulk({ ids = [], action, value }) {
    const list = ids.map(Number).filter(Boolean);
    let changed = 0, skipped = 0;
    this.tx(() => {
      for (const id of list) {
        const t = this.txnRow(id);
        if (!t) { skipped++; continue; }
        if (action === 'delete') {
          if (t.split_parent_id) { skipped++; continue; }
          this.deleteTxn(id); changed++;
        } else if (action === 'status') {
          if (!STATUSES.includes(value)) throw bad('Unknown status.');
          this.run('UPDATE transactions SET status = ? WHERE id = ?', value, id); changed++;
        } else if (action === 'category') {
          if (t.transfer_id || t.split_count) { skipped++; continue; }
          const cat = idOrNull(value);
          if (cat !== null && !this.get('SELECT id FROM categories WHERE id = ?', cat)) throw bad('Category not found.');
          this.run('UPDATE transactions SET category_id = ? WHERE id = ?', cat, id); changed++;
        } else throw bad('Unknown bulk action.');
      }
    });
    return { changed, skipped };
  }

  // Latest use of each payee — powers QuickFill in the editor and memorized categories on import.
  payees() {
    return this.all(`
      SELECT t.id, t.payee, t.category_id, t.amount, l.account_id AS transfer_account_id,
        (SELECT COUNT(*) FROM splits s WHERE s.txn_id = t.id) AS split_count, m.n AS uses
      FROM (SELECT MAX(id) AS id, COUNT(*) AS n FROM transactions
            WHERE payee != '' AND id NOT IN (SELECT transfer_id FROM splits WHERE transfer_id IS NOT NULL)
            GROUP BY payee COLLATE NOCASE) m
      JOIN transactions t ON t.id = m.id
      LEFT JOIN transactions l ON l.id = t.transfer_id
      ORDER BY m.n DESC, t.payee COLLATE NOCASE`);
  }

  /* ---------------------------------------------------------------- rules */

  listRules() { return this.all('SELECT * FROM rules ORDER BY sort, id'); }

  saveRule(input, id = null) {
    if (id && !this.get('SELECT id FROM rules WHERE id = ?', id)) throw notFound('Rule');
    const match = str(input.match, 200);
    if (!match) throw bad('Enter the text to match.');
    const payee = str(input.payee, 200);
    const cat = idOrNull(input.category_id);
    if (cat !== null && !this.get('SELECT id FROM categories WHERE id = ?', cat)) throw bad('Category not found.');
    if (!payee && cat === null) throw bad('A rule needs a new payee name, a category, or both.');
    if (id) this.run('UPDATE rules SET match=?, payee=?, category_id=? WHERE id=?', match, payee, cat, id);
    else id = Number(this.run('INSERT INTO rules (match, payee, category_id, sort) VALUES (?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM rules))', match, payee, cat).lastInsertRowid);
    return this.get('SELECT * FROM rules WHERE id = ?', id);
  }

  deleteRule(id) { this.run('DELETE FROM rules WHERE id = ?', id); return { ok: true }; }

  categorizer() {
    const rules = this.listRules().map((r) => ({ ...r, m: r.match.toLowerCase() }));
    const memory = new Map(this.payees().filter((p) => p.category_id && !p.split_count).map((p) => [p.payee.toLowerCase(), p.category_id]));
    return (payee) => {
      const lower = (payee || '').toLowerCase();
      const rule = rules.find((r) => lower.includes(r.m));
      const out = { payee, category_id: null, rule_id: null, source: null };
      if (rule) {
        out.rule_id = rule.id;
        if (rule.payee) out.payee = rule.payee;
        if (rule.category_id) { out.category_id = rule.category_id; out.source = 'rule'; }
      }
      if (!out.category_id && memory.has(out.payee.toLowerCase())) { out.category_id = memory.get(out.payee.toLowerCase()); out.source = 'memory'; }
      return out;
    };
  }

  applyRules() {
    const cat = this.categorizer();
    const rows = this.all(`SELECT t.id, t.payee FROM transactions t WHERE t.category_id IS NULL AND t.transfer_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM splits s WHERE s.txn_id = t.id)`);
    let changed = 0;
    this.tx(() => {
      for (const r of rows) {
        const c = cat(r.payee);
        if (c.category_id || c.payee !== r.payee) {
          this.run('UPDATE transactions SET payee = ?, category_id = ? WHERE id = ?', c.payee, c.category_id, r.id);
          changed++;
        }
      }
    });
    return { changed };
  }

  /* ---------------------------------------------------------------- import */

  previewImport({ text, filename = '', format, account_id, options = {} }) {
    if (!text || typeof text !== 'string') throw bad('The file is empty.');
    const fmt = format || IMP.detectFormat(text, filename);
    if (fmt === 'qif') {
      const parsed = IMP.parseQIF(text, options);
      const catMap = this.categoryMap();
      const existingPaths = new Set([...catMap.values()].map((c) => c.path.toLowerCase()));
      return {
        format: 'qif',
        dateOrder: parsed.dateOrder,
        warnings: parsed.warnings,
        accounts: parsed.accounts.map((a) => {
          const ex = a.name === IMP.TARGET ? null : this.get('SELECT id FROM accounts WHERE name = ? COLLATE NOCASE', a.name);
          const dates = a.txns.map((t) => t.date).sort();
          return {
            name: a.name, target: a.name === IMP.TARGET, type: a.type, count: a.txns.length, opening: a.opening || null,
            existing_account_id: ex ? ex.id : null, from: dates[0] || null, to: dates[dates.length - 1] || null,
            sample: a.txns.slice(0, 5),
          };
        }),
        new_categories: parsed.categories.filter((c) => !existingPaths.has(c.path.toLowerCase())).map((c) => c.path),
      };
    }
    const acctId = Number(account_id);
    if (!this.get('SELECT id FROM accounts WHERE id = ?', acctId)) throw bad('Choose the account to import into.');
    const parsed = fmt === 'ofx' ? IMP.parseOFX(text) : IMP.parseCSV(text, options);
    const categorize = this.categorizer();
    const paths = new Map([...this.categoryMap().values()].map((c) => [c.path.toLowerCase(), c.id]));
    const leaf = new Map([...this.categoryMap().values()].map((c) => [c.name.toLowerCase(), c.id]));
    const byImportId = this.q('SELECT id FROM transactions WHERE account_id = ? AND import_id = ?');
    const near = this.q('SELECT id FROM transactions WHERE account_id = ? AND amount = ? AND date BETWEEN ? AND ? ORDER BY ABS(julianday(date) - julianday(?))');
    const claimed = new Set();
    const rows = parsed.rows.map((r, i) => {
      const c = categorize(r.payee);
      // Your rules and your own history for this payee beat the bank's category column.
      let category_id = c.category_id, category_name = '';
      if (r.category && !c.category_id) {
        const k = r.category.toLowerCase();
        category_id = paths.get(k) || leaf.get(k) || category_id;
        if (!paths.get(k) && !leaf.get(k)) category_name = r.category;
      }
      let duplicate = null;
      if (r.import_id) {
        const ex = byImportId.get(acctId, r.import_id);
        if (ex) { duplicate = 'exact'; claimed.add(ex.id); }
      }
      if (!duplicate) {
        const cands = near.all(acctId, r.amount, U.addDays(r.date, -3), U.addDays(r.date, 3), r.date);
        const hit = cands.find((x) => !claimed.has(x.id));
        if (hit) { duplicate = 'likely'; claimed.add(hit.id); }
      }
      return { i, ...r, original_payee: r.payee, payee: c.payee, category_id, category_name, duplicate, include: !duplicate };
    });
    return { format: fmt, rows, errors: parsed.errors, headers: parsed.headers, mapping: parsed.mapping, dateOrder: parsed.dateOrder, statement: parsed.statement || null };
  }

  commitImport({ account_id, rows = [] }) {
    const acctId = Number(account_id);
    if (!this.get('SELECT id FROM accounts WHERE id = ?', acctId)) throw bad('Choose the account to import into.');
    return this.tx(() => {
      let imported = 0;
      for (const r of rows) {
        let cat = idOrNull(r.category_id);
        if (!cat && r.category_name) cat = this.ensureCategoryPath(r.category_name, r.amount > 0 ? 'income' : 'expense');
        this.insertRaw({
          account_id: acctId, date: isoDate(r.date, 'Date'), amount: cents(r.amount, 'Amount'), payee: str(r.payee, 200),
          memo: str(r.memo, 1000), num: str(r.num, 20), category_id: cat, import_id: r.import_id ? str(r.import_id, 255) : null,
        });
        imported++;
      }
      return { imported };
    });
  }

  // Full-file Quicken migration: creates accounts & categories, links both halves of transfers.
  importQIF({ text, options = {}, target_account_id = null, account_map = {} }) {
    const parsed = IMP.parseQIF(text, options);
    return this.tx(() => {
      const maxBefore = this.get('SELECT COALESCE(MAX(id), 0) m FROM transactions').m;
      const catIds = new Map();
      const cat = (path, kind) => {
        if (!path) return null;
        const k = path.toLowerCase();
        if (!catIds.has(k)) catIds.set(k, this.ensureCategoryPath(path, kind));
        return catIds.get(k);
      };
      for (const c of parsed.categories) cat(c.path, c.kind);

      const types = new Map(parsed.accounts.map((a) => [a.name.toLowerCase(), a.type]));
      const acctIds = new Map();
      const created = [];
      const resolve = (name) => {
        const key = name.toLowerCase();
        if (acctIds.has(key)) return acctIds.get(key);
        let id;
        if (name === IMP.TARGET) {
          id = Number(target_account_id);
          if (!this.get('SELECT id FROM accounts WHERE id = ?', id)) throw bad('Choose the account to import into.');
        } else if (account_map[name]) {
          id = Number(account_map[name]);
          if (!this.get('SELECT id FROM accounts WHERE id = ?', id)) throw bad(`Account for "${name}" not found.`);
        } else {
          const ex = this.get('SELECT id FROM accounts WHERE name = ? COLLATE NOCASE', name);
          if (ex) id = ex.id;
          else {
            id = Number(this.run('INSERT INTO accounts (name, type) VALUES (?, ?)', name.slice(0, 100), types.get(key) || 'checking').lastInsertRowid);
            created.push(name);
          }
        }
        acctIds.set(key, id);
        return id;
      };
      for (const a of parsed.accounts) resolve(a.name);

      const warnings = [...parsed.warnings];
      for (const a of parsed.accounts) {
        if (!a.opening) continue;
        const id = resolve(a.name);
        const hadTxns = this.get('SELECT COUNT(*) n FROM transactions WHERE account_id = ? AND id <= ?', id, maxBefore).n;
        if (hadTxns) warnings.push(`Kept the existing opening balance for "${a.name}" because it already had transactions.`);
        else this.run('UPDATE accounts SET opening_balance = ?, opening_date = ? WHERE id = ?', a.opening.amount, a.opening.date, id);
      }

      // Both halves of a Quicken transfer appear in the export. The first half creates the pair; the second claims it.
      const pool = new Map();
      const key = (acct, other, date, amount) => `${acct}|${other}|${date}|${amount}`;
      const put = (k, v) => { if (!pool.has(k)) pool.set(k, []); pool.get(k).push(v); };
      const take = (k, pred = () => true) => {
        const arr = pool.get(k);
        if (!arr) return null;
        const i = arr.findIndex(pred);
        return i < 0 ? null : arr.splice(i, 1)[0];
      };
      const dupStmt = this.q('SELECT id FROM transactions WHERE account_id = ? AND date = ? AND amount = ? AND payee = ? AND id <= ? LIMIT 1');
      let imported = 0, duplicates = 0, linked = 0;

      for (const a of parsed.accounts) {
        const acctId = resolve(a.name);
        for (const t of a.txns) {
          if (dupStmt.get(acctId, t.date, t.amount, t.payee, maxBefore)) { duplicates++; continue; }
          const base = { account_id: acctId, date: t.date, payee: t.payee, memo: t.memo, num: t.num, amount: t.amount, status: t.status };
          if (t.transfer !== undefined) {
            const other = resolve(t.transfer);
            if (other === acctId) { this.insertRaw(base); imported++; continue; }
            const hit = take(key(acctId, other, t.date, t.amount));
            if (hit) {
              this.run('UPDATE transactions SET status = ?, num = CASE WHEN num = \'\' THEN ? ELSE num END, memo = CASE WHEN memo = \'\' THEN ? ELSE memo END WHERE id = ?', t.status, t.num, t.memo, hit.id);
              linked++; continue;
            }
            const id = this.insertRaw(base);
            const cid = this.insertRaw({ account_id: other, date: t.date, payee: t.payee, memo: t.memo, amount: -t.amount, transfer_id: id });
            this.run('UPDATE transactions SET transfer_id = ? WHERE id = ?', cid, id);
            put(key(other, acctId, t.date, -t.amount), { id: cid, partner: id, split: false });
            imported++;
          } else if (t.splits) {
            const id = this.insertRaw(base);
            for (const s of t.splits) {
              let transferId = null;
              if (s.transfer !== undefined) {
                const other = resolve(s.transfer);
                if (other !== acctId) {
                  const hit = take(key(acctId, other, t.date, s.amount), (h) => !h.split);
                  if (hit) {
                    // The other account already created a plain transfer pair; re-point its half at this split.
                    this.run('UPDATE transactions SET transfer_id = NULL WHERE id = ?', hit.partner);
                    this.run('DELETE FROM transactions WHERE id = ?', hit.id);
                    this.run('UPDATE transactions SET transfer_id = ? WHERE id = ?', id, hit.partner);
                    transferId = hit.partner; linked++;
                  } else {
                    transferId = this.insertRaw({ account_id: other, date: t.date, payee: t.payee, memo: s.memo || t.memo, amount: -s.amount, transfer_id: id });
                    put(key(other, acctId, t.date, -s.amount), { id: transferId, partner: id, split: true });
                  }
                }
              }
              this.run('INSERT INTO splits (txn_id, category_id, transfer_id, amount, memo) VALUES (?,?,?,?,?)',
                id, transferId ? null : cat(s.category, s.amount > 0 ? 'income' : 'expense'), transferId, s.amount, s.memo || '');
            }
            imported++;
          } else {
            this.insertRaw({ ...base, category_id: cat(t.category, t.amount > 0 ? 'income' : 'expense') });
            imported++;
          }
        }
      }
      return { imported, duplicates, linked_transfers: linked, accounts_created: created, warnings };
    });
  }

  /* ---------------------------------------------------------------- scheduled */

  listScheduled() {
    const cats = this.categoryMap();
    return this.all(`SELECT s.*, a.name AS account_name, ta.name AS transfer_account_name FROM scheduled s
      JOIN accounts a ON a.id = s.account_id LEFT JOIN accounts ta ON ta.id = s.transfer_account_id
      ORDER BY s.next_date, s.payee COLLATE NOCASE`)
      .map((s) => ({ ...s, category_path: s.category_id && cats.get(s.category_id) ? cats.get(s.category_id).path : null }));
  }

  saveScheduled(input, id = null) {
    const existing = id ? this.get('SELECT * FROM scheduled WHERE id = ?', id) : null;
    if (id && !existing) throw notFound('Scheduled transaction');
    const v = { ...(existing || { memo: '', auto_enter: 0 }), ...input };
    const acct = Number(v.account_id);
    if (!this.get('SELECT id FROM accounts WHERE id = ?', acct)) throw bad('Choose an account.');
    const payee = str(v.payee, 200);
    if (!payee) throw bad('Payee is required.');
    if (!FREQUENCIES.includes(v.frequency)) throw bad('Choose how often it repeats.');
    const next = isoDate(v.next_date, 'Next date');
    const transfer = idOrNull(v.transfer_account_id);
    if (transfer === acct) throw bad("A transfer can't go to the same account.");
    const row = [acct, payee, cents(v.amount, 'Amount'), transfer ? null : idOrNull(v.category_id), transfer, str(v.memo, 500), v.frequency, next,
      Number(next.slice(8)), isoDate(v.end_date, 'End date', true), v.auto_enter ? 1 : 0];
    if (existing) this.run('UPDATE scheduled SET account_id=?, payee=?, amount=?, category_id=?, transfer_account_id=?, memo=?, frequency=?, next_date=?, anchor_day=?, end_date=?, auto_enter=? WHERE id=?', ...row, id);
    else id = Number(this.run('INSERT INTO scheduled (account_id, payee, amount, category_id, transfer_account_id, memo, frequency, next_date, anchor_day, end_date, auto_enter) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...row).lastInsertRowid);
    return this.listScheduled().find((s) => s.id === id);
  }

  deleteScheduled(id) { this.run('DELETE FROM scheduled WHERE id = ?', id); return { ok: true }; }

  nextOccurrence(s, from = s.next_date) {
    switch (s.frequency) {
      case 'weekly': return U.addDays(from, 7);
      case 'biweekly': return U.addDays(from, 14);
      case 'monthly': return U.addMonths(from, 1, s.anchor_day);
      case 'quarterly': return U.addMonths(from, 3, s.anchor_day);
      case 'yearly': return U.addMonths(from, 12, s.anchor_day);
      default: return null;
    }
  }

  advanceScheduled(s) {
    const next = this.nextOccurrence(s);
    if (!next || (s.end_date && next > s.end_date)) this.run('DELETE FROM scheduled WHERE id = ?', s.id);
    else this.run('UPDATE scheduled SET next_date = ? WHERE id = ?', next, s.id);
  }

  enterScheduled(id, overrides = {}) {
    const s = this.get('SELECT * FROM scheduled WHERE id = ?', id);
    if (!s) throw notFound('Scheduled transaction');
    return this.tx(() => {
      const t = this.saveTxn({
        account_id: s.account_id, date: overrides.date || s.next_date, payee: s.payee, memo: s.memo,
        amount: overrides.amount !== undefined ? overrides.amount : s.amount,
        category_id: s.category_id, transfer_account_id: s.transfer_account_id,
      });
      this.advanceScheduled(s);
      return t;
    });
  }

  skipScheduled(id) {
    const s = this.get('SELECT * FROM scheduled WHERE id = ?', id);
    if (!s) throw notFound('Scheduled transaction');
    this.advanceScheduled(s);
    return { ok: true };
  }

  autoEnterDue(today = U.todayISO()) {
    let entered = 0;
    for (let guard = 0; guard < 500; guard++) {
      const s = this.get('SELECT * FROM scheduled WHERE auto_enter = 1 AND next_date <= ? ORDER BY next_date LIMIT 1', today);
      if (!s) break;
      this.enterScheduled(s.id);
      entered++;
    }
    return entered;
  }

  upcoming(days = 30, today = U.todayISO()) {
    const end = U.addDays(today, days);
    const out = [];
    for (const s of this.listScheduled()) {
      let d = s.next_date;
      for (let i = 0; d && d <= end && i < 12; i++) {
        if (s.end_date && d > s.end_date) break;
        out.push({ ...s, date: d, overdue: d < today, is_next: i === 0 });
        d = this.nextOccurrence(s, d);
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /* ---------------------------------------------------------------- budgets & reports */

  // Sums lines per category between dates; uncategorized lines split by sign so income and spending stay separate.
  categoryTotals(from, to) {
    return this.all(`SELECT category_id, amount < 0 AS neg, SUM(amount) AS total, COUNT(*) AS n
      FROM (${LINES} AND t.date BETWEEN ? AND ?) GROUP BY category_id, neg`, from, to);
  }

  getBudget(month) {
    if (!U.isMonth(month)) throw bad('Month must look like 2026-09.');
    const cats = this.listCategories().filter((c) => c.kind !== 'other');
    const actual = new Map(), avg = new Map();
    const uncategorized = { spending: 0, income: 0 };
    for (const r of this.categoryTotals(U.monthStart(month), U.monthEnd(month))) {
      if (r.category_id === null) { if (r.neg) uncategorized.spending -= r.total; else uncategorized.income += r.total; continue; }
      actual.set(r.category_id, (actual.get(r.category_id) || 0) + r.total);
    }
    for (const r of this.categoryTotals(U.monthStart(U.shiftMonth(month, -3)), U.monthEnd(U.shiftMonth(month, -1)))) {
      if (r.category_id !== null) avg.set(r.category_id, (avg.get(r.category_id) || 0) + r.total);
    }
    const budgets = new Map(this.all('SELECT category_id, amount FROM budgets WHERE month = ?', month).map((b) => [b.category_id, b.amount]));
    const sign = (c) => (c.kind === 'income' ? 1 : -1);
    const rows = cats.map((c) => ({
      id: c.id, name: c.name, path: c.path, parent_id: c.parent_id, top_id: c.top_id, depth: c.depth, kind: c.kind, hidden: c.hidden,
      budget: budgets.get(c.id) || 0,
      actual: sign(c) * (actual.get(c.id) || 0),
      avg3: Math.round((sign(c) * (avg.get(c.id) || 0)) / 3),
    })).filter((r) => !r.hidden || r.budget || r.actual);
    return { month, rows, uncategorized };
  }

  setBudget(month, categoryId, amount) {
    if (!U.isMonth(month)) throw bad('Month must look like 2026-09.');
    const a = cents(amount, 'Budget');
    if (a < 0) throw bad("Budgets can't be negative.");
    if (!this.get('SELECT id FROM categories WHERE id = ?', categoryId)) throw notFound('Category');
    if (a === 0) this.run('DELETE FROM budgets WHERE category_id = ? AND month = ?', categoryId, month);
    else this.run('INSERT INTO budgets (category_id, month, amount) VALUES (?,?,?) ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount', categoryId, month, a);
    return { ok: true };
  }

  copyBudget(from, to) {
    if (!U.isMonth(from) || !U.isMonth(to)) throw bad('Months must look like 2026-09.');
    const n = this.run('INSERT OR IGNORE INTO budgets (category_id, month, amount) SELECT category_id, ?, amount FROM budgets WHERE month = ?', to, from).changes;
    return { copied: Number(n) };
  }

  fillBudgetFromAverage(month) {
    const b = this.getBudget(month);
    let filled = 0;
    this.tx(() => {
      for (const r of b.rows) {
        if (r.budget || r.avg3 <= 0) continue;
        this.setBudget(month, r.id, Math.ceil(r.avg3 / 1000) * 1000); // round up to $10
        filled++;
      }
    });
    return { filled };
  }

  // kind: expense | income; group: category | top | payee
  spendingReport({ from, to, kind = 'expense', group = 'category' }) {
    isoDate(from, 'From'); isoDate(to, 'To');
    const cats = this.categoryMap();
    const sign = kind === 'income' ? 1 : -1;
    const keep = (catId, amount) => (catId === null ? (kind === 'income' ? amount > 0 : amount < 0) : cats.get(catId) && cats.get(catId).kind === kind);
    const items = new Map();
    const add = (k, label, amount, extra) => {
      if (!items.has(k)) items.set(k, { key: k, label, amount: 0, count: 0, ...extra });
      const it = items.get(k); it.amount += sign * amount; it.count++;
    };
    const rows = this.all(`${LINES} AND t.date BETWEEN ? AND ?`, from, to);
    for (const r of rows) {
      if (!keep(r.category_id, r.amount)) continue;
      if (group === 'payee') { add(`p:${(r.payee || '(no payee)').toLowerCase()}`, r.payee || '(no payee)', r.amount, { payee: r.payee }); continue; }
      if (r.category_id === null) { add('uncat', 'Uncategorized', r.amount, { category_id: null, uncategorized: true }); continue; }
      const c = cats.get(r.category_id);
      const target = group === 'top' ? cats.get(c.top_id) : c;
      add(`c:${target.id}`, target.path, r.amount, { category_id: target.id });
    }
    const list = [...items.values()].filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount);
    return { from, to, kind, group, items: list, total: list.reduce((s, i) => s + i.amount, 0) };
  }

  cashflowReport({ months = 12, end = U.monthOf(U.todayISO()) }) {
    const n = Math.min(Math.max(Number(months) || 12, 1), 120);
    if (!U.isMonth(end)) throw bad('End month must look like 2026-09.');
    const start = U.shiftMonth(end, -(n - 1));
    const cats = this.categoryMap();
    const byMonth = new Map();
    for (let i = 0; i < n; i++) byMonth.set(U.shiftMonth(start, i), { month: U.shiftMonth(start, i), income: 0, expense: 0 });
    const rows = this.all(`SELECT substr(date, 1, 7) AS month, category_id, amount < 0 AS neg, SUM(amount) AS total
      FROM (${LINES} AND t.date BETWEEN ? AND ?) GROUP BY month, category_id, neg`, U.monthStart(start), U.monthEnd(end));
    for (const r of rows) {
      const m = byMonth.get(r.month);
      const kind = r.category_id === null ? (r.neg ? 'expense' : 'income') : (cats.get(r.category_id) || {}).kind;
      if (kind === 'income') m.income += r.total;
      else if (kind === 'expense') m.expense -= r.total;
    }
    return { months: [...byMonth.values()].map((m) => ({ ...m, net: m.income - m.expense })) };
  }

  netWorthReport({ months = 24, end = U.monthOf(U.todayISO()) }) {
    const n = Math.min(Math.max(Number(months) || 24, 1), 240);
    const accts = this.all('SELECT id, type, opening_balance, opening_date FROM accounts');
    const sums = this.all("SELECT account_id, substr(date, 1, 7) AS month, SUM(amount) AS total FROM transactions GROUP BY account_id, month ORDER BY month");
    const first = sums.length ? sums[0].month : end;
    const start = [U.shiftMonth(end, -(n - 1)), first].sort()[1];
    const out = [];
    const bal = new Map(accts.map((a) => [a.id, 0]));
    let si = 0;
    for (let m = start; m <= end; m = U.shiftMonth(m, 1)) {
      while (si < sums.length && sums[si].month <= m) { bal.set(sums[si].account_id, bal.get(sums[si].account_id) + sums[si].total); si++; }
      let assets = 0, liabilities = 0;
      for (const a of accts) {
        const opening = !a.opening_date || a.opening_date.slice(0, 7) <= m ? a.opening_balance : 0;
        const b = bal.get(a.id) + opening;
        if (LIABILITY_TYPES.has(a.type)) liabilities -= b; else assets += b;
      }
      out.push({ month: m, assets, liabilities, net: assets - liabilities });
    }
    return { months: out };
  }

  dashboard() {
    const today = U.todayISO();
    const month = U.monthOf(today);
    const accounts = this.listAccounts();
    const open = accounts.filter((a) => !a.closed);
    const flow = this.cashflowReport({ months: 2, end: month }).months;
    const budget = this.getBudget(month);
    const expenseRows = budget.rows.filter((r) => r.kind === 'expense');
    const top = this.spendingReport({ from: U.monthStart(month), to: U.monthEnd(month), kind: 'expense', group: 'top' });
    const budgetsByTop = new Map();
    for (const r of expenseRows) budgetsByTop.set(r.top_id, (budgetsByTop.get(r.top_id) || 0) + r.budget);
    return {
      today, month,
      net_worth: open.reduce((s, a) => s + a.balance, 0),
      assets: open.filter((a) => !a.liability).reduce((s, a) => s + a.balance, 0),
      liabilities: -open.filter((a) => a.liability).reduce((s, a) => s + a.balance, 0),
      this_month: flow[1], last_month: flow[0],
      budget: { budgeted: expenseRows.reduce((s, r) => s + r.budget, 0), spent: expenseRows.reduce((s, r) => s + r.actual, 0) + budget.uncategorized.spending },
      top_spending: top.items.slice(0, 8).map((i) => ({ ...i, budget: i.category_id ? budgetsByTop.get(i.category_id) || 0 : 0 })),
      upcoming: this.upcoming(14, today).slice(0, 10),
      recent: this.listTxns({ limit: 8 }).rows,
      uncategorized: this.listTxns({ uncategorized: 1, limit: 1 }).total,
      trend: this.netWorthReport({ months: 12, end: month }).months,
      has_accounts: accounts.length > 0,
    };
  }

  /* ---------------------------------------------------------------- backup, export */

  static TABLES = ['meta', 'accounts', 'categories', 'transactions', 'splits', 'budgets', 'rules', 'scheduled'];

  backup() {
    const tables = {};
    for (const t of Ledger.TABLES) tables[t] = this.all(`SELECT * FROM ${t}`);
    return { app: 'tally', format: 1, exported_at: new Date().toISOString(), tables };
  }

  restore(data) {
    if (!data || data.app !== 'tally' || !data.tables) throw bad("That doesn't look like a Tally backup file.");
    this.tx(() => {
      this.db.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of [...Ledger.TABLES].reverse()) this.db.exec(`DELETE FROM ${t}`);
      for (const t of Ledger.TABLES) {
        const cols = this.all(`PRAGMA table_info(${t})`).map((c) => c.name);
        for (const row of data.tables[t] || []) {
          const keys = Object.keys(row).filter((k) => cols.includes(k));
          if (!keys.length) continue;
          this.db.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
        }
      }
    });
    return { ok: true };
  }

  eraseAll() {
    this.tx(() => {
      for (const t of [...Ledger.TABLES].reverse()) if (t !== 'meta') this.db.exec(`DELETE FROM ${t}`);
      seedCategories(this.db);
    });
    return { ok: true };
  }

  exportCSV(accountId = null) {
    const cats = this.categoryMap();
    const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Date', 'Account', 'Num', 'Payee', 'Category', 'Memo', 'Amount', 'Status'].join(',')];
    const where = accountId ? 'WHERE t.account_id = ?' : '';
    const rows = this.all(`${TXN_SELECT} ${where} ORDER BY t.date, t.id`, ...(accountId ? [Number(accountId)] : []));
    const splits = this.q(`SELECT s.*, ca.name AS transfer_account_name FROM splits s LEFT JOIN transactions c ON c.id = s.transfer_id
      LEFT JOIN accounts ca ON ca.id = c.account_id WHERE s.txn_id = ?`);
    const status = { '': '', c: 'Cleared', R: 'Reconciled' };
    for (const t of rows) {
      const common = [t.date, t.account_name, t.num, t.payee];
      if (t.split_count) {
        for (const s of splits.all(t.id)) {
          const c = s.transfer_account_name ? `[${s.transfer_account_name}]` : s.category_id ? cats.get(s.category_id).path : '';
          lines.push([...common, c, s.memo || t.memo, (s.amount / 100).toFixed(2), status[t.status]].map(q).join(','));
        }
      } else {
        const c = t.transfer_account_name ? `[${t.transfer_account_name}]` : t.category_id && cats.get(t.category_id) ? cats.get(t.category_id).path : '';
        lines.push([...common, c, t.memo, (t.amount / 100).toFixed(2), status[t.status]].map(q).join(','));
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

module.exports = { Ledger, ACCOUNT_TYPES, FREQUENCIES };
