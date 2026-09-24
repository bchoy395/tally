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
    const csv = await request(port, { path: '/api/export.csv' });
    assert.match(csv.headers['content-disposition'], /attachment/);
  } finally {
    server.close();
  }
});
