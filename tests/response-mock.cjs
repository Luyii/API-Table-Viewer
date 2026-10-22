'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const engineSource = fs.readFileSync(path.join(root, 'mock-page.js'), 'utf8');
class Progress extends Event {constructor(type, options = {}) {super(type); Object.assign(this, options);}}
function page(t, options = {}) {
  let calls = 0, clock = Date.now();
  const nativeFetch = async (...args) => {calls++; return options.fetch ? options.fetch(...args) : new Response('{"source":"backend"}', {status:200, headers:{'content-type':'application/json'}});};
  class NativeXHR extends EventTarget {
    constructor() {super(); this._state = 0; this._text = ''; this._status = 0; this.responseType = ''; this.timeout = 0; this.withCredentials = false; this.upload = new EventTarget(); this._headers = new Headers();}
    dispatchEvent(event) {const result = super.dispatchEvent(event); this['on' + event.type]?.call(this, event); return result;}
    open(method, url, async = true) {this._method = String(method).toUpperCase(); this._url = new URL(String(url), options.origin || 'https://example.test').href; this._state = 1; this.dispatchEvent(new Event('readystatechange'));}
    send(body) {if (this._state !== 1) throw new DOMException('', 'InvalidStateError'); void nativeFetch(this._url, {method:this._method, body}).then(async response => {this._text = await response.text(); this._status = response.status; this._headers = response.headers; this._state = 4; this.dispatchEvent(new Event('readystatechange')); this.dispatchEvent(new Progress('load')); this.dispatchEvent(new Progress('loadend'));});}
    abort() {this._state = 0; this.dispatchEvent(new Progress('abort'));}
    setRequestHeader() {}
    get readyState() {return this._state;}
    get status() {return this._status;}
    get statusText() {return 'OK';}
    get responseURL() {return this._url;}
    get responseText() {if (this.responseType && this.responseType !== 'text') throw new DOMException('', 'InvalidStateError'); return this._text;}
    get response() {return this.responseType === 'json' ? JSON.parse(this._text) : this._text;}
    get responseXML() {return null;}
    getResponseHeader(name) {return this._headers.get(name);}
    getAllResponseHeaders() {return '';}
  }
  const context = vm.createContext({fetch:nativeFetch, XMLHttpRequest:NativeXHR, location:new URL(options.origin || 'https://example.test/page'), Request, Response, Headers, TextEncoder, Blob, URL, Event, ProgressEvent:Progress, EventTarget, DOMException, AbortController, console, Date:class extends Date {static now() {return clock;}}, setTimeout:(fn, ms) => {const timer = setTimeout(fn, ms); if (ms >= 120000) timer.unref(); return timer;}, clearTimeout});
  vm.runInContext('globalThis.top=globalThis;', context);
  vm.runInContext(engineSource, context);
  const apply = config => {context.config = {owner:'test-owner', ...config}; return vm.runInContext('installPageResponseMocks(config)', context);};
  t.after(() => apply({action:'stop'}));
  return {context, apply, calls:() => calls, advance:ms => {clock += ms;}, nativeFetch, NativeXHR};
}
const rule = (overrides = {}) => ({id:'orders', method:'GET', url:'https://example.test/api/orders?page=1', body:'{"id":9007199254740993,"name":"edited"}', status:200, once:false, ...overrides});
function xhrRequest(context, url, type = '', configure) {
  const xhr = new context.XMLHttpRequest(); xhr.open('GET', url); xhr.responseType = type;
  const done = new Promise((resolve, reject) => {xhr.addEventListener('loadend', () => resolve(xhr), {once:true}); xhr.addEventListener('error', reject, {once:true});});
  configure?.(xhr); xhr.send(); return {xhr, done};
}

test('Fetch returns edited JSON without backend calls, preserving bytes, URL and clone', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]});
  const response = await p.context.fetch('/api/orders?page=1');
  assert.equal(response.status, 200); assert.equal(response.url, rule().url);
  assert.equal(response.headers.get('x-api-table-viewer-mock'), '1');
  const clone = response.clone(); assert.equal(clone.url, response.url);
  assert.equal(await response.text(), rule().body); assert.equal(await clone.text(), rule().body);
  assert.equal(p.calls(), 0); assert.equal(p.apply({action:'status'}).rules[0].hits, 1);
});
test('method and full query must match; unrelated requests use the original fetch', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]});
  for (const [url, init] of [['/api/orders?page=2', {}], ['/api/orders?page=1', {method:'POST'}], ['/other', {}]]) assert.equal((await (await p.context.fetch(url, init)).json()).source, 'backend');
  assert.equal(p.calls(), 3); assert.equal(p.apply({action:'status'}).rules[0].hits, 0);
});
test('a one-shot rule intercepts only one concurrent request', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule({once:true})]});
  const responses = await Promise.all([p.context.fetch(rule().url), p.context.fetch(rule().url)]);
  assert.equal(responses.filter(response => response.headers.has('x-api-table-viewer-mock')).length, 1);
  const status = p.apply({action:'status'}); assert.equal(status.rules[0].hits, 1); assert.equal(status.rules[0].enabled, false); assert.equal(p.calls(), 1);
});
test('Request inputs, status overrides and abort signals keep expected Fetch behavior', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule({status:500})]});
  const response = await p.context.fetch(new Request(rule().url)); assert.equal(response.ok, false); assert.equal(response.status, 500);
  const before = new AbortController(); before.abort();
  await assert.rejects(p.context.fetch(rule().url, {signal:before.signal}), error => error.name === 'AbortError');
  const after = new AbortController(), pending = p.context.fetch(rule().url, {signal:after.signal}); after.abort();
  await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(p.calls(), 0);
});
test('XHR dispatches lifecycle events and returns text, JSON and mock headers', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]}); const states = [], events = [];
  const {xhr, done} = xhrRequest(p.context, rule().url, '', xhr => {xhr.addEventListener('readystatechange', () => states.push(xhr.readyState)); for (const event of ['loadstart','progress','load','loadend']) xhr.addEventListener(event, () => events.push(event));});
  assert(xhr instanceof p.NativeXHR); await done;
  assert.deepEqual(states, [2,3,4]); assert.deepEqual(events, ['loadstart','progress','load','loadend']);
  assert.equal(xhr.responseText, rule().body); assert.equal(xhr.status, 200); assert.equal(xhr.responseURL, rule().url);
  assert.equal(xhr.getResponseHeader('CONTENT-TYPE'), 'application/json; charset=utf-8'); assert.equal(xhr.getResponseHeader('missing'), null);
  const json = await xhrRequest(p.context, rule().url, 'json').done; assert.equal(json.response.name, 'edited'); assert.throws(() => json.responseText, error => error.name === 'InvalidStateError');
  assert.equal(p.calls(), 0); assert.equal(p.apply({action:'status'}).rules[0].lastKind, 'XHR');
});
test('XHR abort cancels mock completion and prevents load', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]}); let loaded = false;
  const {xhr, done} = xhrRequest(p.context, rule().url, '', xhr => {xhr.onload = () => {loaded = true;};});
  xhr.abort(); await done; await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(loaded, false); assert.equal(xhr.status, 0); assert.equal(xhr.readyState, 0); assert.equal(xhr.responseText, ''); assert.equal(p.calls(), 0);
});
test('XHR abort from headers-received stops subsequent mock events', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]}); let loaded = false;
  const {xhr, done} = xhrRequest(p.context, rule().url, '', xhr => {xhr.onreadystatechange = () => {if (xhr.readyState === 2) xhr.abort();}; xhr.onload = () => {loaded = true;};});
  await done; assert.equal(loaded, false); assert.equal(xhr.readyState, 0); assert.equal(p.calls(), 0);
});
test('XHR supports reuse, blob/arraybuffer and unmatched native pass-through', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]});
  const blob = await xhrRequest(p.context, rule().url, 'blob').done; assert.equal(await blob.response.text(), rule().body);
  const buffer = await xhrRequest(p.context, rule().url, 'arraybuffer').done; assert.equal(new TextDecoder().decode(buffer.response), rule().body);
  const xhr = await xhrRequest(p.context, rule().url).done;
  xhr.open('GET', '/unmatched'); const done = new Promise(resolve => xhr.addEventListener('loadend', resolve, {once:true})); xhr.send(); await done;
  assert.equal(JSON.parse(xhr.responseText).source, 'backend'); assert.equal(p.calls(), 1);
});
test('unsupported sync XHR and no-cors Fetch fail before backend access', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]});
  const xhr = new p.context.XMLHttpRequest(); xhr.open('GET', rule().url, false); assert.throws(() => xhr.send(), error => error.name === 'InvalidAccessError');
  await assert.rejects(p.context.fetch(rule().url, {mode:'no-cors'}), /no-cors/); assert.equal(p.calls(), 0);
});
test('invalid rules fail atomically and never replace active valid rules', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]});
  for (const bad of [rule({body:'{bad'}), rule({status:204}), rule({method:'HEAD'}), rule({url:'file:///etc/passwd'}), rule({body:JSON.stringify('x'.repeat(1024*1024))})]) assert.throws(() => p.apply({action:'set', rules:[bad]}));
  assert.throws(() => p.apply({action:'set', rules:[rule(), rule()]}));
  assert.throws(() => p.apply({action:'set', origin:'https://other.test', rules:[rule()]}));
  assert.equal((await p.context.fetch(rule().url)).headers.get('x-api-table-viewer-mock'), '1'); assert.equal(p.calls(), 0);
});
test('updating rule content resets hit evidence without stacking wrappers; unchanged rules retain counters', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]}); const wrapped = p.context.fetch;
  await p.context.fetch(rule().url); p.apply({action:'set', rules:[rule({body:'{"updated":true}'})]}); assert.equal(p.context.fetch, wrapped);
  assert.equal(p.apply({action:'status'}).rules[0].hits, 0);
  assert.equal((await (await p.context.fetch(rule().url)).json()).updated, true); assert.equal(p.apply({action:'status'}).rules[0].hits, 1);
  p.apply({action:'set', rules:[rule({body:'{"updated":true}'})]});
  assert.equal(p.apply({action:'status'}).rules[0].hits, 1);
  p.apply({action:'stop'}); assert.equal(p.context.fetch, p.nativeFetch); assert.equal(p.context.XMLHttpRequest, p.NativeXHR);
});
test('expired panel lease restores originals; stop does not overwrite later page wrappers', async t => {
  const p = page(t); p.apply({action:'set', rules:[rule()]}); p.advance(120001);
  assert.equal(p.apply({action:'status'}).active, false); assert.equal(p.context.fetch, p.nativeFetch);
  p.apply({action:'set', rules:[rule()]}); const custom = async () => new Response('custom'); p.context.fetch = custom;
  p.apply({action:'stop'}); assert.equal(p.context.fetch, custom);
});

function panel(t, p) {
  const nodes=new Map(),navigated=[],lifecycle={};let reloadOptions;
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,{classList:{toggle(){}},textContent:'',disabled:false});return nodes.get(selector);};
  const chrome={runtime:{},devtools:{network:{onNavigated:{addListener:fn=>navigated.push(fn)}},inspectedWindow:{eval(expression,callback){try{callback(vm.runInContext(expression,p.context),undefined);}catch(error){callback(undefined,{isException:true,value:error.message});}},reload(options){reloadOptions=options;for(const fn of navigated)fn(p.context.location.href);}}}};
  const context=vm.createContext({$,chrome,crypto:require('node:crypto').webcrypto,URL,TextEncoder,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},window:{addEventListener:(event,fn)=>{lifecycle[event]=fn;}},toast(){},safe:fn=>(...args)=>Promise.resolve(fn(...args)),ResponseEditor:{validate:text=>JSON.parse(text)}});
  vm.runInContext(engineSource,context);vm.runInContext(fs.readFileSync(path.join(root,'response-mock.js'),'utf8'),context);
  const run=code=>vm.runInContext(code,context);
  t.after(()=>lifecycle.pagehide?.());
  return {run,context,nodes,reload:()=>reloadOptions,navigate:()=>{for(const fn of navigated)fn(p.context.location.href);}};
}
const item={method:'GET',url:rule().url,status:200};
test('panel enables and disables rules through serialized DevTools calls, treating JSON as data',async t=>{
  const p=page(t),ui=panel(t,p);ui.context.item=item;
  ui.context.body=JSON.stringify({text:'");globalThis.PWNED=true;// </script>'});
  await ui.run('ResponseMock.enable(item,body,{once:false,status:200})');
  assert.equal(ui.run('ResponseMock.get(item).rule.enabled'),true);
  assert.equal(await (await p.context.fetch(item.url)).text(),ui.context.body);assert.equal(p.context.PWNED,undefined);
  await ui.run('ResponseMock.refresh()');assert.equal(ui.run('ResponseMock.get(item).rule.hits'),1);
  await ui.run('ResponseMock.disable(item)');assert.equal(ui.run('ResponseMock.get(item).active'),false);assert.equal(p.context.fetch,p.nativeFetch);
});
test('panel syncs consumed one-shot rules before enabling another rule',async t=>{
  const p=page(t),ui=panel(t,p);ui.context.item=item;
  await ui.run('ResponseMock.enable(item,\'{"once":true}\',{once:true,status:200})');await p.context.fetch(item.url);
  ui.context.other={...item,url:'https://example.test/api/other'};
  await ui.run('ResponseMock.enable(other,\'{"other":true}\',{once:false,status:200})');
  const result=await p.context.fetch(item.url);assert.equal((await result.json()).source,'backend');
  assert.equal(ui.run('ResponseMock.get(item).rule.enabled'),false);assert.equal(p.calls(),1);
});
test('panel reload embeds rules before page scripts and navigation disables stale session state',async t=>{
  const p=page(t),ui=panel(t,p);ui.context.item=item;
  await ui.run('ResponseMock.enable(item,\'{"reload":true}\',{once:false,status:200})');
  await ui.run('ResponseMock.reload()');assert(ui.reload().ignoreCache);assert(ui.reload().injectedScript.includes('installPageResponseMocks'));
  await ui.run('ResponseMock.refresh()');assert.equal(ui.run('ResponseMock.get(item).reloading'),true);
  vm.runInContext('globalThis.__API_TABLE_VIEWER_RESPONSE_MOCK_V1__.stop()',p.context);
  vm.runInContext(ui.reload().injectedScript,p.context);await ui.run('ResponseMock.refresh()');
  const received=await (await p.context.fetch(item.url)).json();
  assert.equal(received.reload,true,JSON.stringify({received,state:ui.run('ResponseMock.get(item)'),source:p.context.fetch.toString().slice(0,90)}));
  ui.navigate();assert.equal(ui.run('ResponseMock.get(item).rule.enabled'),false);assert.equal(ui.run('ResponseMock.get(item).active'),false);
});
test('panel does not reload after one-shot consumption and rolls back failed installs',async t=>{
  const p=page(t),ui=panel(t,p);ui.context.item=item;
  await ui.run('ResponseMock.enable(item,\'{"once":true}\',{once:true,status:200})');await p.context.fetch(item.url);
  await assert.rejects(ui.run('ResponseMock.reload()'),/启用/);assert.equal(ui.reload(),undefined);
  ui.context.bad={method:'GET',url:'https://example.test/api/'+ 'x'.repeat(10),status:200};
  const prior=p.context.installPageResponseMocks; p.context.installPageResponseMocks=()=>{throw Error('install failed');};
  // Reject at the DevTools transport, without modifying the previously stored rule.
  ui.context.chrome.devtools.inspectedWindow.eval=(_,callback)=>callback(undefined,{isException:true,value:'install failed'});
  await assert.rejects(ui.run('ResponseMock.enable(bad,\'{"bad":false}\',{once:false,status:200})'),/install failed/);
  assert.equal(ui.run('ResponseMock.get(bad).rule'),null);p.context.installPageResponseMocks=prior;
});

test('real HTTP demo page renders edited Fetch and XHR data without another backend hit', async t => {
  const {createServer} = require('./manual/server.cjs'); const server = createServer(); let backend = 0;
  server.on('request', req => {if (req.url === '/api/mock-orders') backend++;});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const p = page(t, {origin, fetch:(url, init) => fetch(new URL(url, origin), init)});
  class Element {constructor() {this.children=[]; this._text='';} set textContent(text) {this._text=String(text); this.children=[];} get textContent() {return this._text+this.children.map(child=>child.textContent).join('');} appendChild(child) {this.children.push(child);} addEventListener() {}}
  const elements=new Map();p.context.document={querySelector(selector){if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);},createElement:()=>new Element()};
  vm.runInContext(fs.readFileSync(path.join(root, 'tests/manual/mock-debug.js'), 'utf8'), p.context);
  await vm.runInContext('fetchOrders()', p.context); const before = backend;
  assert(elements.get('#orders').textContent.includes('林小满'));
  p.apply({action:'set', rules:[rule({url:origin+'/api/mock-orders', body:'{"code":200,"data":{"records":[{"orderId":"MOCK-01","customerName":"已替换客户","status":"cancelled","amount":-999.99}]}}'})]});
  await vm.runInContext('fetchOrders()', p.context); assert(elements.get('#orders').textContent.includes('已替换客户')); assert(elements.get('#orders').textContent.includes('-999.99'));
  const xhr=vm.runInContext('xhrOrders()',p.context);await new Promise(resolve=>xhr.addEventListener('loadend',resolve,{once:true}));
  assert(elements.get('#source').textContent.includes('XHR · 模拟响应')); assert.equal(backend,before);
});


test('editor compares only consumed mock bodies once, never the pending draft', async () => {
  class Element {
    constructor(){this.value='';this.textContent='';this.children=[];this.classList={add(){},remove(){}};}
    setAttribute(k,v){this[k]=v;} getAttribute(k){return this[k];}
    appendChild(el){this.children.push(el);} focus(){}
  }
  const elements=new Map(), $=key=>{if(!elements.has(key))elements.set(key,new Element());return elements.get(key);};
  let rule=null,listener,comparisons=0;
  const context=vm.createContext({$,TextEncoder,setTimeout,clearTimeout,selected:{valid:true,method:'GET',url:'https://example.test/api',rid:'1',meta:{bytes:10}},
    callWorker:async()=>({text:'{"value":1}'}),closeModal(){},toast(){},copyText(){},pathText:()=>'',
    safe:fn=>fn,document:{addEventListener(){},createElement:()=>new Element()},
    ResponseMock:{get:()=>({active:true,busy:false,rule}),subscribe:fn=>{listener=fn;}}});
  vm.runInContext(fs.readFileSync(path.join(root,'json-codec.js'),'utf8'),context);
  // Count traversal executions rather than mirroring the diff implementation.
  const source=fs.readFileSync(path.join(root,'response-editor.js'),'utf8').replace('function diff(before,after){','function diff(before,after){ countComparison();');
  context.countComparison=()=>{comparisons++;};
  vm.runInContext(source,context);
  await vm.runInContext('ResponseEditor.open()',context);
  $('#responseEditorInput').value='{"value":2}';vm.runInContext('ResponseEditor.update()',context);
  assert.equal(comparisons,0);
  rule={body:'{"value":2}',status:200,once:false,enabled:true,hits:0};listener();assert.equal(comparisons,0);
  rule.hits=1;listener();assert.equal(comparisons,1);assert.equal($('#responseEditorDiffSummary').textContent,'1 项变更');
  rule.hits=2;listener();assert.equal(comparisons,1);
  $('#responseEditorInput').value='{"value":3}';vm.runInContext('ResponseEditor.update()',context);assert.equal(comparisons,1);
  rule={...rule,body:'{"value":3}',hits:0};listener();assert.equal(comparisons,1);
  assert.equal($('#responseEditorDiffSummary').textContent,'网页使用假数据后自动对比');
  rule.hits=1;listener();assert.equal(comparisons,2);
});
