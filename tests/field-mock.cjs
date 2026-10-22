'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=name=>fs.readFileSync(path.join(root,name),'utf8');
const coreContext=vm.createContext({});vm.runInContext(source('field-patch-core.js'),coreContext);const core=vm.runInContext('FieldPatchCore',coreContext);
const patch=(obj,path,value)=>({...core.target(obj,path),value});
test('scalar patches preserve untouched fields, unsafe integers, scalar types and prototype-named keys',()=>{
  const original=core.parse('{"id":9007199254740993,"amount":12,"name":"old","ok":true,"__proto__":{"x":1}}');
  const changes=[patch(original,['amount'],'99'),patch(original,['name'],'"new"'),patch(original,['ok'],'false'),patch(original,['__proto__','x'],'2')];
  const result=core.apply(original,changes);assert.equal(result.applied,4);assert.equal(result.value.id,9007199254740993n);assert.equal(result.value.__proto__.x,2);assert.equal({}.x,undefined);
  assert.throws(()=>core.validate({...changes[0],value:'"wrong type"'}),/类型/);
});
test('stable row identifiers follow sorting, while missing/duplicate IDs and changed types skip safely',()=>{
  const original=core.parse('{"rows":[{"orderId":1,"amount":12},{"orderId":2,"amount":24}]}');
  const change=patch(original,['rows',0,'amount'],'99');
  const next=core.parse('{"rows":[{"orderId":2,"amount":25},{"orderId":1,"amount":13}]}');
  const result=core.apply(next,[change]);assert.equal(result.value.rows[0].amount,25);assert.equal(result.value.rows[1].amount,99);
  for(const raw of ['{"rows":[]}','{"rows":[{"orderId":1,"amount":12},{"orderId":1,"amount":13}]}','{"rows":[{"orderId":1,"amount":"13"}]}'])assert.equal(core.apply(core.parse(raw),[change]).applied,0);
  assert.throws(()=>core.target(original,['rows',0,'orderId']),/标识字段/);
  assert.throws(()=>core.target({rows:[{value:1}]},['rows',0,'value']),/唯一/);
});
test('a response over 1 MiB can produce a tiny field patch without a full response draft',()=>{
  const data={padding:'x'.repeat(2*1024*1024),amount:1};const change=patch(data,['amount'],'2');
  assert(JSON.stringify(change).length<200);const result=core.apply(data,[change]);assert.equal(result.value.amount,2);assert.equal(result.value.padding.length,2*1024*1024);
});
function page(initialRules=[],options={}){
  let rules=initialRules,reads=0,backend=options.backend||'{"data":{"name":"real","amount":12},"id":9007199254740993}';
  const listeners={},timers=new Map();let timer=0;
  class XHR extends EventTarget{
    constructor(){super();this._ready=0;this._type='';this._text='';this._headers={};this.status=200;}
    open(method,url,async=true){this.method=method;this.url=url;this._ready=1;this._type='';}
    send(){reads++;this._text=backend;this._ready=4;for(const event of ['readystatechange','load','loadend'])this.dispatchEvent(new Event(event));}
    abort(){this._ready=0;}
    setRequestHeader(k,v){this._headers[k]=v;}
    get readyState(){return this._ready;}
    get responseText(){return this._text;}
    get response(){return this._type==='json'?JSON.parse(this._text):this._text;}
    get responseType(){return this._type;}set responseType(v){this._type=v;}
    getResponseHeader(){return 'application/json';}
    getAllResponseHeaders(){return 'content-type: application/json\r\ncontent-length: '+this._text.length+'\r\n';}
  }
  const context=vm.createContext({URL,Request,Response,Headers,TextEncoder,DOMException,Event,console,location:{origin:'https://example.test',href:'https://example.test/app'},XMLHttpRequest:XHR,
    fetch:async()=>{reads++;return new Response(backend,{headers:{'content-type':'application/json','content-length':String(backend.length)},status:201});},
    setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),
    addEventListener:(event,fn)=>{listeners[event]=fn;},postMessage(){}});
  context.window=context;
  vm.runInContext(source('field-patch-core.js'),context);vm.runInContext(source('field-mock-page.js'),context);
  function configure(next){rules=next;vm.runInContext('0',context);context.configMessage={source:context,origin:'https://example.test',data:{channel:'atv-fields-page-v1',kind:'config',origin:'https://example.test',rules}};
    // Use the context's global proxy for the event source, as a browser would.
    context.deliver=listeners.message;vm.runInContext('configMessage.source=window;deliver(configMessage)',context);
  }
  if(!options.defer)configure(rules);
  return {context,configure,reads:()=>reads,run:code=>vm.runInContext(code,context),setBackend:text=>{backend=text;}};
}
const sample=()=>[{method:'GET',url:'https://example.test/api',patches:[patch({data:{name:'real',amount:12}},['data','name'],'"mock"')]}];
test('Fetch makes a real backend request, patches the body, preserves status and integers, and exit restores real responses',async()=>{
  const p=page(sample());const response=await p.context.fetch('https://example.test/api');assert.equal(response.status,201);assert.equal(response.headers.get('content-length'),null);
  assert((await response.clone().text()).includes('9007199254740993'));assert.equal((await response.json()).data.name,'mock');assert.equal(p.reads(),1);
  p.setBackend('{"data":{"name":"latest real","amount":77}}');
  const latest=await (await p.context.fetch('https://example.test/api')).json();assert.equal(latest.data.name,'mock');assert.equal(latest.data.amount,77);
  p.configure([]);assert.equal((await (await p.context.fetch('https://example.test/api')).json()).data.name,'latest real');assert.equal(p.reads(),3);
});
test('fresh page holds startup Fetch until stored rules arrive; a reload uses identical rules',async()=>{
  const p=page([],{defer:true});let done=false;const pending=p.context.fetch('https://example.test/api').then(r=>{done=true;return r;});await Promise.resolve();assert.equal(p.reads(),0);assert.equal(done,false);
  p.configure(sample());assert.equal((await (await pending).json()).data.name,'mock');
  const reload=page(sample());assert.equal((await (await reload.context.fetch('https://example.test/api')).json()).data.name,'mock');
});
test('XHR text and JSON responses apply patches, including startup requests; synchronous and unmatched requests pass through',async()=>{
  const p=page([],{defer:true});p.run('globalThis.xhr=new XMLHttpRequest();xhr.open("GET","/api");xhr.responseType="json";xhr.send()');assert.equal(p.reads(),0);
  p.configure(sample());await Promise.resolve();assert.equal(p.run('xhr.response.data.name'),'mock');assert.equal(p.run('xhr.responseType'),'json');assert.throws(()=>p.run('xhr.responseText'),/JSON/);
  p.run('xhr=new XMLHttpRequest();xhr.open("GET","/api");xhr.send()');assert.equal(JSON.parse(p.run('xhr.responseText')).data.name,'mock');assert(p.run('xhr.responseText').includes('9007199254740993'));assert.equal(p.run('xhr.getResponseHeader("x-api-table-viewer-mock")'),'fields');assert(!p.run('xhr.getAllResponseHeaders()').includes('content-length'));
  p.run('xhr=new XMLHttpRequest();xhr.open("GET","/api",false);xhr.send()');assert.equal(JSON.parse(p.run('xhr.responseText')).data.name,'real');
  p.run('xhr=new XMLHttpRequest();xhr.open("GET","/other");xhr.send()');assert.equal(JSON.parse(p.run('xhr.responseText')).data.name,'real');
});
test('exit while Fetch is in flight prevents obsolete patches',async()=>{
  const p=page(sample());const pending=p.context.fetch('https://example.test/api');p.configure([]);assert.equal((await (await pending).json()).data.name,'real');
});
function background(store={}){
  let handler,removed;const deliveries=[];
  const context=vm.createContext({URL,console,chrome:{runtime:{onMessage:{addListener:fn=>{handler=fn;}}},tabs:{get:async id=>({url:background.urls[id]||'https://example.test/app'}),sendMessage:async(...args)=>{deliveries.push(args);},onRemoved:{addListener:fn=>{removed=fn;}}},storage:{session:{get:async key=>({[key]:structuredClone(store[key])}),set:async record=>Object.assign(store,structuredClone(record)),remove:async key=>{delete store[key];}}}},importScripts:file=>vm.runInContext(source(file),context)});
  vm.runInContext(source('field-mock-background.js'),context);
  return {store,deliveries,removed,send:(message,sender={})=>new Promise(resolve=>handler({channel:'atv-fields',tabId:1,...message},sender,resolve))};
}
background.urls={1:'https://example.test/app',2:'https://other.test/app'};
test('background session survives worker restart, isolates origins and tabs, and explicit exit clears rules',async()=>{
  const first=background(),rules=sample();assert.equal((await first.send({action:'set',origin:'https://example.test',rules})).ok,true);
  const restarted=background(first.store);
  assert.equal((await restarted.send({action:'get'},{tab:{id:1},frameId:0,url:'https://example.test/reloaded'})).rules.length,1);
  assert.equal((await restarted.send({action:'get'},{tab:{id:1},frameId:0,url:'https://other.test/'})).rules.length,0);
  assert.equal((await restarted.send({action:'get',tabId:2})).rules.length,0);
  assert.equal((await restarted.send({action:'set',rules:[],origin:'https://wrong.test'})).ok,false);
  assert.equal((await restarted.send({action:'set',rules,origin:'https://example.test'},{tab:{id:1},frameId:0,url:'https://example.test/'})).ok,false);
  assert.equal((await restarted.send({action:'set',rules:[],origin:'https://example.test'})).rules.length,0);
});
test('background validates patches and serializes concurrent writes to the same tab',async()=>{
  const bg=background();const bad=sample();bad[0].patches[0].value='{"nested":true}';assert.equal((await bg.send({action:'set',origin:'https://example.test',rules:bad})).ok,false);
  const results=await Promise.all([bg.send({action:'set',origin:'https://example.test',rules:sample()}),bg.send({action:'set',origin:'https://example.test',rules:[]})]);assert(results.every(r=>r.ok));assert.equal((await bg.send({action:'get'})).rules.length,0);
});
test('abort during startup XHR initialization does not dispatch a backend request',async()=>{
  const p=page([],{defer:true});p.run('globalThis.xhr=new XMLHttpRequest();xhr.open("GET","/api");xhr.send();xhr.abort()');p.configure(sample());await Promise.resolve();assert.equal(p.reads(),0);
});
test('Worker returns scalar targets and relocated paths without exporting a large response',()=>{
  let result;const context=vm.createContext({TextEncoder,self:{postMessage:r=>{result=r;}},importScripts:file=>vm.runInContext(source(file),context)});vm.runInContext(source('worker.js'),context);
  const send=data=>{context.self.onmessage({data:{id:1,...data}});assert(result.ok,result.error);return result.result;};
  const record=send({cmd:'parse',raw:JSON.stringify({padding:'x'.repeat(2*1024*1024),amount:1})});
  const target=send({cmd:'patchTarget',rid:record.rid,path:['amount']});assert.equal(target.old,'1');assert(JSON.stringify(target).length<200);
  assert.equal(send({cmd:'patchLocations',rid:record.rid,patches:[{...target,value:'2'}]}).paths.length,1);
});

test('shared field codec retains the same exact-integer implementation as the original Worker codec',()=>{assert(source('field-patch-core.js').includes(source('json-codec.js')));});


test('duplicate startup configuration does not invalidate an in-flight patched Fetch',async()=>{
  const p=page(sample());const pending=p.context.fetch('https://example.test/api');p.configure(sample());assert.equal((await (await pending).json()).data.name,'mock');
});
