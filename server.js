#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { open } = require('./lib/db');
const { Ledger } = require('./lib/ledger');
const { loadSample } = require('./lib/sample');
const { HttpError, todayISO } = require('./lib/util');
const version = require('./lib/version');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
const MAX_BODY = 80 * 1024 * 1024;

function defaultDataDir(args = []) {
  const flag = args.find((a) => a.startsWith('--data='));
  if (flag) return path.resolve(flag.slice(7));
  if (process.env.TALLY_DATA) return process.env.TALLY_DATA;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Tally');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'Tally');
  return path.join(os.homedir(), '.local', 'share', 'tally');
}

// Point-in-time copies of the database. Daily on startup, and before anything destructive.
function makeBackups(db, dataDir) {
  const dir = path.join(dataDir, 'backups');
  const list = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort() : []);
  const snapshot = (label) => {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `tally-${stamp}${label ? `-${label}` : ''}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const all = list();
    for (const f of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(dir, f));
    return file;
  };
  const daily = () => {
    if (!list().some((f) => f.startsWith(`tally-${todayISO()}`))) snapshot('daily');
  };
  return { dir, list, snapshot, daily };
}

function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { method, re, keys, handler };
}

function buildRoutes(L, ctx) {
  const guardSample = () => {
    if (L.listAccounts().length) throw new HttpError(400, 'Sample data can only be loaded into an empty file.');
  };
  return [
    route('GET', '/api/dashboard', () => { L.autoEnterDue(); return L.dashboard(); }),
    route('GET', '/api/info', () => ({ data_file: ctx.dbFile, backups_dir: ctx.backups ? ctx.backups.dir : null, backups: ctx.backups ? ctx.backups.list().reverse() : [] })),
    route('GET', '/api/version', async () => ({ ...(await version.current()), update: ctx.update || null })),
    route('POST', '/api/version/check', async () => (ctx.update = await version.checkForUpdates())),
    route('GET', '/api/settings', () => L.getSettings()),
    route('PUT', '/api/settings', (p, b) => L.saveSettings(b)),

    route('GET', '/api/accounts', () => L.listAccounts()),
    route('POST', '/api/accounts', (p, b) => L.saveAccount(b)),
    route('GET', '/api/accounts/:id', (p) => L.getAccount(p.id)),
    route('PUT', '/api/accounts/:id', (p, b) => L.saveAccount(b, Number(p.id))),
    route('DELETE', '/api/accounts/:id', (p) => { ctx.backups && ctx.backups.snapshot('before-delete-account'); return L.deleteAccount(Number(p.id)); }),
    route('POST', '/api/accounts/:id/adjust', (p, b) => L.adjustBalance(Number(p.id), b)),
    route('POST', '/api/accounts/:id/reconcile', (p, b) => L.reconcile(Number(p.id), b)),

    route('GET', '/api/categories', () => L.listCategories()),
    route('POST', '/api/categories', (p, b) => L.saveCategory(b)),
    route('POST', '/api/categories/ensure', (p, b) => ({ id: L.ensureCategoryPath(b.path, b.kind) })),
    route('PUT', '/api/categories/:id', (p, b) => L.saveCategory(b, Number(p.id))),
    route('DELETE', '/api/categories/:id', (p, b, q) => L.deleteCategory(Number(p.id), q.get('reassign_to'))),

    route('GET', '/api/transactions', (p, b, q) => L.listTxns(Object.fromEntries(q))),
    route('POST', '/api/transactions', (p, b) => L.saveTxn(b)),
    route('POST', '/api/transactions/bulk', (p, b) => L.bulk(b)),
    route('GET', '/api/transactions/:id', (p) => L.getTxn(Number(p.id))),
    route('PUT', '/api/transactions/:id', (p, b) => L.saveTxn(b, Number(p.id))),
    route('DELETE', '/api/transactions/:id', (p) => L.deleteTxn(Number(p.id))),
    route('GET', '/api/payees', () => L.payees()),

    route('GET', '/api/rules', () => L.listRules()),
    route('POST', '/api/rules', (p, b) => L.saveRule(b)),
    route('POST', '/api/rules/apply', () => L.applyRules()),
    route('PUT', '/api/rules/:id', (p, b) => L.saveRule(b, Number(p.id))),
    route('DELETE', '/api/rules/:id', (p) => L.deleteRule(Number(p.id))),

    route('POST', '/api/import/preview', (p, b) => L.previewImport(b)),
    route('POST', '/api/import/commit', (p, b) => L.commitImport(b)),
    route('POST', '/api/import/qif', (p, b) => { ctx.backups && ctx.backups.snapshot('before-qif-import'); return L.importQIF(b); }),

    route('GET', '/api/scheduled', () => L.listScheduled()),
    route('GET', '/api/scheduled/upcoming', (p, b, q) => L.upcoming(Number(q.get('days')) || 30)),
    route('POST', '/api/scheduled', (p, b) => L.saveScheduled(b)),
    route('PUT', '/api/scheduled/:id', (p, b) => L.saveScheduled(b, Number(p.id))),
    route('DELETE', '/api/scheduled/:id', (p) => L.deleteScheduled(Number(p.id))),
    route('POST', '/api/scheduled/:id/enter', (p, b) => L.enterScheduled(Number(p.id), b)),
    route('POST', '/api/scheduled/:id/skip', (p) => L.skipScheduled(Number(p.id))),

    route('GET', '/api/budget/:month', (p) => L.getBudget(p.month)),
    route('PUT', '/api/budget/:month/:category', (p, b) => L.setBudget(p.month, Number(p.category), b.amount)),
    route('POST', '/api/budget/:month/copy', (p, b) => L.copyBudget(b.from, p.month)),
    route('POST', '/api/budget/:month/fill', (p) => L.fillBudgetFromAverage(p.month)),

    route('GET', '/api/reports/spending', (p, b, q) => L.spendingReport(Object.fromEntries(q))),
    route('GET', '/api/reports/cashflow', (p, b, q) => L.cashflowReport({ months: q.get('months'), end: q.get('end') || undefined })),
    route('GET', '/api/reports/networth', (p, b, q) => L.netWorthReport({ months: q.get('months'), end: q.get('end') || undefined })),

    route('GET', '/api/backup', () => ({ __download: `tally-backup-${todayISO()}.json`, type: 'application/json', body: JSON.stringify(L.backup(), null, 1) })),
    route('GET', '/api/export.csv', (p, b, q) => ({ __download: `tally-transactions-${todayISO()}.csv`, type: 'text/csv; charset=utf-8', body: L.exportCSV(q.get('account_id')) })),
    route('POST', '/api/restore', (p, b) => { ctx.backups && ctx.backups.snapshot('before-restore'); return L.restore(b); }),
    route('POST', '/api/erase', (p, b) => {
      if (b.confirm !== 'ERASE') throw new HttpError(400, 'Type ERASE to confirm.');
      ctx.backups && ctx.backups.snapshot('before-erase');
      return L.eraseAll();
    }),
    route('POST', '/api/sample', () => { guardSample(); loadSample(L); return { ok: true }; }),
  ];
}

function createServer(L, ctx = {}) {
  const routes = buildRoutes(L, ctx);
  return http.createServer((req, res) => {
    const port = req.socket.localPort;
    const host = (req.headers.host || '').toLowerCase();
    // Only answer to our own origin — blocks DNS-rebinding and drive-by requests from other sites.
    if (![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/help') {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      fs.createReadStream(path.join(__dirname, 'HOW-TO-USE.html')).pipe(res);
      return;
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'GET' && req.headers['x-tally'] !== '1') return send(403, { error: 'Missing X-Tally header.' });
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(404, { error: 'Not found.' });
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(url.pathname.match(r.re)[i + 1])]));

    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(413, { error: 'That file is too large.' }); req.destroy(); } else chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : {};
        const out = await r.handler(params, body, url.searchParams);
        if (out && out.__download) {
          res.writeHead(200, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.__download}"`, 'Cache-Control': 'no-store' });
          res.end(out.body);
        } else send(200, out === undefined ? { ok: true } : out);
      } catch (e) {
        if (e instanceof HttpError) send(e.status, { error: e.message });
        else if (e instanceof SyntaxError) send(400, { error: 'Request body is not valid JSON.' });
        else { console.error(e); send(500, { error: `Something went wrong: ${e.message}` }); }
      }
    });
  });
}

function serveStatic(pathname, res) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--version')) {
    version.current().then((v) => { console.log(`Tally ${version.label(v)}`); process.exit(0); });
    return;
  }
  const port = Number(process.env.TALLY_PORT || (args.find((a) => a.startsWith('--port=')) || '').slice(7) || 4280);
  const dataDir = defaultDataDir(args);
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'tally.db');
  const db = open(dbFile);
  const L = new Ledger(db);
  const backups = makeBackups(db, dataDir);
  try { backups.daily(); } catch (e) { console.warn('Backup failed:', e.message); }
  L.autoEnterDue();
  const ctx = { dbFile, backups, update: null };
  const server = createServer(L, ctx);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Tally is already running at http://localhost:${port}`);
      if (!args.includes('--no-open')) openBrowser(`http://localhost:${port}`);
      process.exit(0);
    }
    throw e;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    version.current().then((v) => {
      const local = v.changed_files ? ` (+ ${v.changed_files} changed file${v.changed_files === 1 ? '' : 's'} not committed)` : '';
      console.log(`Tally ${version.label(v)}${local}${v.date ? `, committed ${v.date.slice(0, 10)}` : ''}`);
      console.log(`Running at ${url}\nData file: ${dbFile}\nPress Ctrl+C to stop.`);
      version.checkForUpdates().then((u) => { ctx.update = u; console.log(version.describeUpdate(u)); });
    });
    if (!args.includes('--no-open')) openBrowser(url);
  });
  const shutdown = () => { server.close(); try { db.close(); } catch {} process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function openBrowser(url) {
  // WSL has no xdg-open; explorer.exe opens the URL in the Windows browser, which reaches WSL's localhost.
  const wsl = process.platform === 'linux' && /microsoft/i.test(os.release());
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : wsl ? 'explorer.exe' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

module.exports = { createServer, makeBackups };
