'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open } = require('../lib/db');
const { Ledger } = require('../lib/ledger');
const { createServer } = require('../server');

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

test('API: origin checks, CSRF header, CRUD and errors', async () => {
  const server = createServer(new Ledger(open(':memory:')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.equal((await request(port, { path: '/api/accounts', headers: { host: `evil.example:${port}` } })).status, 403);
    assert.equal((await request(port, { method: 'POST', path: '/api/accounts', body: { name: 'X', type: 'checking' } })).status, 403);
    const h = { 'x-tally': '1', 'content-type': 'application/json' };
    const created = await request(port, { method: 'POST', path: '/api/accounts', headers: h, body: { name: 'Checking', type: 'checking' } });
    assert.equal(created.status, 200);
    const dup = await request(port, { method: 'POST', path: '/api/accounts', headers: h, body: { name: 'checking', type: 'checking' } });
    assert.equal(dup.status, 400);
    assert.match(JSON.parse(dup.body).error, /already exists/);
    const list = JSON.parse((await request(port, { path: '/api/accounts' })).body);
    assert.equal(list.length, 1);
    const sample = await request(port, { method: 'POST', path: '/api/sample', headers: h });
    assert.equal(sample.status, 400, 'sample refuses non-empty file');
    const index = await request(port, { path: '/account/1' });
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.equal((await request(port, { path: '/../server.js' })).body.includes('createServer'), false);
    const help = await request(port, { path: '/help' });
    assert.match(help.body, /How to use Tally/);
    const csv = await request(port, { path: '/api/export.csv' });
    assert.match(csv.headers['content-disposition'], /attachment/);
  } finally {
    server.close();
  }
});

test('version: label, update messages and /api/version', async () => {
  const version = require('../lib/version');
  assert.equal(version.label({ version: '1.0.0', build: 10, commit: 'abc1234' }), '1.0.0 · build 10 · abc1234');
  assert.equal(version.label({ version: '1.0.0', build: null, commit: null }), '1.0.0', 'no Git: just the package version');
  assert.match(version.describeUpdate({ ok: true, ahead: 0, behind: 0 }), /Up to date/);
  assert.match(version.describeUpdate({ ok: true, ahead: 0, behind: 2, latest_build: 12, latest_commit: 'def5678' }), /build 12 \(def5678\).*2 changes newer.*git pull/);
  assert.match(version.describeUpdate({ ok: true, ahead: 1, behind: 0 }), /1 local commit not pushed/);
  assert.match(version.describeUpdate({ ok: false }), /Couldn't check/);

  const server = createServer(new Ledger(open(':memory:')), { update: { ok: true, ahead: 0, behind: 0 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await request(port, { path: '/api/version' });
    assert.equal(res.status, 200);
    const v = JSON.parse(res.body);
    assert.equal(v.version, require('../package.json').version);
    assert.deepEqual(v.update, { ok: true, ahead: 0, behind: 0 });
    assert.equal((await request(port, { method: 'POST', path: '/api/version/check' })).status, 403, 'check needs the X-Tally header');
  } finally {
    server.close();
  }
});
