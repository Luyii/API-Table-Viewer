'use strict';
// Real panel script order and Worker engine; DOM and Chrome are explicit test doubles.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'../..');
function eventTarget(){
 const handlers=new Map();
 return {addEventListener(name,fn,options){const list=handlers.get(name)||[];list.push({fn,once:!!options?.once});handlers.set(name,list);},removeEventListener(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(h=>h.fn!==fn));},emit(name,event={}){for(const h of [...handlers.get(name)||[]]){h.fn(event);if(h.once)this.removeEventListener(name,h.fn);}}};
}
class Element{
 constructor(tag='div',attrs=''){
  Object.assign(this,eventTarget());this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};this.value='';this.textContent='';this.attributes={};
  const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n),toggle:(n,on)=>{const enabled=on===undefined?!classes.has(n):on;enabled?classes.add(n):classes.delete(n);return enabled;}};
  for(const [,key,value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){this.setAttribute(key,value);if(key==='class')value.split(/\s+/).forEach(c=>classes.add(c));if(key==='value')this.value=value;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
 }
 set className(value){this.attributes.class=value;this.classList.add(...value.split(/\s+/));}
 get className(){return this.attributes.class||'';}
 set innerHTML(value){this.html=value;this.children=[];}
 get innerHTML(){return this.html||'';}
 setAttribute(k,v){this.attributes[k]=String(v);}
 getAttribute(k){return this.attributes[k];}
 appendChild(el){this.children.push(el);el.parentElement=this;return el;}
 querySelector(){return new Element();}
 focus(){} select(){} scrollIntoView(){} contains(el){return el===this||this.children.some(c=>c.contains(el));}
 getBoundingClientRect(){return {top:0,left:0,width:1000,height:600};}
}
function createPanel({readyState='loading',har=[],deferHar=false,registrationError=false,harError=false,overrides={}}={}){
 const html=fs.readFileSync(path.join(root,'panel.html'),'utf8'),nodes=[],ids=new Map();
 for(const [,tag,attrs] of html.matchAll(/<(\w+)\b([^>]+)>/g)){const el=new Element(tag,attrs);nodes.push(el);if(el.attributes.id)ids.set(el.attributes.id,el);}
 const query=s=>{if(s==='button')return nodes.filter(n=>n.tagName==='BUTTON');if(s.startsWith('#'))return ids.has(s.slice(1))?[ids.get(s.slice(1))]:[];if(s.startsWith('.'))return nodes.filter(n=>n.classList.contains(s.slice(1)));if(s.startsWith('['))return nodes.filter(n=>Object.hasOwn(n.attributes,s.slice(1,-1)));return [];};
 const document={...eventTarget(),readyState,documentElement:new Element('html'),body:new Element('body'),querySelector:s=>query(s)[0]||null,querySelectorAll:query,getElementById:id=>ids.get(id)||null,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),dispatchEvent(event){this.emit(event.type,event);},execCommand:()=>true};
 for(const node of nodes)node.querySelectorAll=query;
 let clock=0,seq=0,registrationAttempts=0,harCalls=0,harCallback;const tasks=new Map(),listeners=new Set(),navigation=new Set();
 const schedule=(fn,ms=0,interval=0)=>{const id=++seq;tasks.set(id,{fn,time:clock+ms,interval});return id;};
 const clear=id=>tasks.delete(id);
 const runtime={sendMessage:async()=>({ok:true,origin:'http://localhost:5173',rules:[]})};
 const network={onRequestFinished:{addListener(fn){registrationAttempts++;if(registrationError)throw Error('registration blocked');listeners.add(fn);}},onNavigated:{addListener:fn=>navigation.add(fn)},getHAR(fn){harCalls++;harCallback=fn;if(!deferHar)deliverHar();}};
 function deliverHar(entries=har){if(harError)runtime.lastError={message:'HAR unavailable'};try{harCallback({entries});}finally{delete runtime.lastError;}}
 class Worker{
  constructor(file){
   if(file!=='worker.js')throw Error('Unexpected Worker');
   const context=vm.createContext({TextEncoder,self:{postMessage:result=>schedule(()=>this.onmessage?.({data:structuredClone(result)}))},importScripts:name=>vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context)});
   vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);this.context=context;
  }
  postMessage(data){this.context.self.onmessage({data:structuredClone(data)});}
 }
 const storage=new Map();
 const context=vm.createContext({document,Worker,chrome:{runtime,devtools:{network,inspectedWindow:{tabId:1}}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},console,crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,atob,Blob,URL,URLSearchParams,structuredClone,CustomEvent:class{constructor(type){this.type=type;}},setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:clear,setInterval:(fn,ms)=>schedule(fn,ms,ms),clearInterval:clear});context.window=context;Object.assign(context,eventTarget());
 const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>m[1]);
 for(const file of scripts)vm.runInContext(overrides[file]??fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 const run=code=>vm.runInContext(code,context);
 async function advance(ms=0){
  const end=clock+ms;
  for(let n=0;n<10000;n++){
   for(let i=0;i<20;i++)await Promise.resolve();
   const due=[...tasks].filter(([,v])=>v.time<=end).sort((a,b)=>a[1].time-b[1].time)[0];
   if(!due){clock=end;return;}
   const [id,task]=due;clock=task.time;tasks.delete(id);task.fn();if(task.interval)tasks.set(id,{...task,time:clock+task.interval});
  }
  throw Error('Timer loop did not settle');
 }
 return {run,context,ids,scripts,advance,deliverHar,get listeners(){return listeners.size;},get attempts(){return registrationAttempts;},get harCalls(){return harCalls;},async boot(){document.readyState='interactive';document.emit('DOMContentLoaded');await advance();},async request(req){for(const listener of listeners)listener(req);await advance();},dispose(){tasks.clear();},setRegistrationError(value){registrationError=value;}};
}
function request(url='http://localhost:5173/api/test',body='{"ok":true}',extra={}){
 return {startedDateTime:'2026-10-26T00:00:00.000Z',request:{url,method:'GET'},response:{status:200,headers:[{name:'Content-Type',value:'application/json'}]},time:1,getContent:done=>done(body,''),...extra};
}
module.exports={createPanel,request};
