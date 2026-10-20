'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {createServer} = require('./server.cjs');
const {cases} = require('./fixtures.cjs');
const root = path.join(__dirname, '../..');
let reply;
const ctx = vm.createContext({TextEncoder, self: {postMessage: r => {reply = structuredClone(r);}}, importScripts: file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx)});
vm.runInContext(fs.readFileSync(path.join(root, 'worker.js'), 'utf8'), ctx);
function call(cmd, data = {}) {
  ctx.self.onmessage({data: {id: 1, cmd, ...data}});
  assert.equal(reply.ok, true, reply.error); return reply.result;
}
test('HTTP fixtures exercise the actual Worker paths (no Chrome claim)', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const item of cases) await t.test(item.id, async () => {
      const res = await fetch(base + '/api/' + item.id);
      assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /application\/json/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const raw = await res.text(); assert(Buffer.byteLength(raw) < 20 * 1024 * 1024);
      const {rid} = call('parse', {raw});
      const table = opts => call('table', {rid, path: [], ...opts});
      if (item.id === 'ordinary') {
        assert.equal(table().total, 260);
        const hit = table({query: 'TABLE-HIT', preview: true, navigate: true, focusIndex: 3, pageSize: 1});
        const crossPage = table({query: '中文用户-', preview: true, navigate: true, focusIndex: 25, pageSize: 25});
        assert.equal(crossPage.page, 2); assert.deepEqual(crossPage.rows[0].name.path, [25, 'name']);
        assert.equal(hit.hitTotal, 4); assert.equal(hit.page, 3); assert.deepEqual(hit.rows[0].note.path, [259, 'note']);
        const sorted = table({sortKey: 'amount', all: true}); assert.equal(sorted.rows[0].amount, -12.5); assert.equal(sorted.rows.at(-1).amount, 10);
        assert.equal(table({query: 'TABLE-HIT', all: true}).rows.length, 3);
      }
      if (item.id === 'nested') {
        const paths = call('arrays', {rid, path: []}).items.map(x => x.path);
        assert(paths.some(p => JSON.stringify(p) === '["groups",0,"items"]'));
        assert.equal(table({path: ['empty']}).total, 0);
        assert.equal(table({path: ['mixed']}).columns[1], 'value');
      }
      if (item.id === 'nodes' || item.id === 'records') {
        const field = item.id === 'nodes' ? 'payload' : 'records', target = [0, field];
        assert.deepEqual(table({preview: true}).rows[0][field].path, target);
        const doc = call('viewerDocument', {rid, path: target}); assert.equal(doc.complete, false); assert.match(doc.reason, /5,000/);
        const {token} = call('viewerExpandStart', {rid, path: target}); let state;
        do {state = call('viewerExpandStep', {rid, token});} while (!state.done);
        const expected = item.id === 'nodes' ? 6001 : 200001; assert.equal(state.total, expected);
        const tail = call('viewerExpandWindow', {rid, token, start: expected - 1, limit: 80});
        assert.match(tail.rows[0].label, item.id === 'nodes' ? /NODE-END-5999/ : /RECORD-END-50000/);
        if (item.id === 'records') {
          assert.equal(table({path: target}).total, 50000);
          assert.equal(table({path: target, page: 500}).rows.at(-1).id, 50000);
          assert.equal(table({path: target, query: 'RECORD-END-50000'}).total, 1);
        }
        call('viewerExpandRelease', {rid, token});
      }
      if (item.id === 'integers') {
        assert(raw.includes('"id":9007199254740993')); assert.equal(table().rows[0].id, 9007199254740993n);
        assert.equal(table({sortKey: 'id'}).rows[0].id, -9223372036854775808n);
        assert(call('value', {rid, path: []}).text.includes('"id": 9007199254740993'));
      }
      if (item.id === 'long-text') {
        assert.equal(call('viewerDocument', {rid, path: [0, 'text']}).complete, true);
        assert.equal(call('viewerDocument', {rid, path: [1, 'text']}).complete, false);
        assert.match(call('valuePage', {rid, path: [0, 'text'], page: 1}).text, /PAGE-2-MARK/);
        assert.match(call('valuePage', {rid, path: [0, 'text'], page: 2}).text, /PAGE-3-MARK/);
      }
      if (item.id === 'missing') {
        assert.equal(table({preview: true}).rows[1].optional.path, null);
        assert.deepEqual(table({sortKey: ''}).rows.map(r => r.id), [3, 1, 2]);
      }
      call('release', {rid});
    });
    await t.test('page, assets, POST exact echo and error routes', async () => {
      for (const route of ['/', '/app.js', '/api/cases']) assert.equal((await fetch(base + route)).status, 200);
      const body = '{"id":9007199254740993,"amount":-12.5}';
      assert.equal(await (await fetch(base + '/api/echo', {method: 'POST', body})).text(), body);
      assert.equal((await fetch(base + '/api/echo', {method: 'POST', body: '{bad'})).status, 400);
      assert.equal((await fetch(base + '/api/echo', {method: 'POST', body: 'x'.repeat(1024 * 1024 + 1)})).status, 413);
      assert.equal((await fetch(base + '/api/status')).status, 422);
      assert.match((await fetch(base + '/api/plain')).headers.get('content-type'), /text\/plain/);
      assert.equal((await fetch(base + '/../manifest.json')).status, 404);
      assert.equal((await fetch(base + '/api/ordinary', {method: 'DELETE'})).status, 405);
    });
  } finally {await new Promise(resolve => server.close(resolve));}
});
