'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {createPreviewServer} = require('./server.cjs');

test('preview fixtures provide valid HAR entries and preserve source integer tokens', () => {
  const context = vm.createContext({window: {}, TextEncoder});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'env.js'), 'utf8'), context);
  let entries;
  context.window.chrome.devtools.network.getHAR(har => {entries = har.entries;});
  assert.equal(entries.length, 3);
  let raw;
  entries[0].getContent(text => {raw = text;});
  assert(raw.includes('9007199254740993'));
  for (const entry of entries) entry.getContent(text => assert.doesNotThrow(() => JSON.parse(text)));
  new vm.Script(fs.readFileSync(path.join(__dirname, 'boot.js'), 'utf8'));
});

test('preview server serves panel/runtime assets and rejects unrelated files', async () => {
  const server = createPreviewServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(origin + '/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes('/preview/env.js')); assert(html.includes('id="responseEditor"'));
    for (const route of ['/preview/env.js', '/preview/boot.js', '/worker.js', '/appearance.js', '/response-editor.js', '/style.css']) assert.equal((await fetch(origin + route)).status, 200);
    assert.equal((await fetch(origin + '/package.json')).status, 404);
    assert.equal((await fetch(origin + '/', {method: 'POST'})).status, 405);
  } finally {await new Promise(resolve => server.close(resolve));}
});

test('generated full and inline previews contain compilable scripts and complete markup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-preview-'));
  try {
    const output = path.join(directory, 'preview.html'), inline = path.join(directory, 'inline.html');
    execFileSync('python3', [path.join(__dirname, 'build-preview.py'), output, '--inline', inline]);
    for (const file of [output, inline]) {
      const html = fs.readFileSync(file, 'utf8');
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
      assert(scripts.length > 0); new vm.Script(scripts.join('\n;\n'), {filename: path.basename(file)});
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      assert.equal(ids.length, new Set(ids).size);
      assert(html.includes('id="responseEditorInput"'));
      assert(!/EDITOR_MARKUP|EDITOR_SCRIPT|CODEC_SCRIPT|EDITOR_STYLES/.test(html));
    }
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
