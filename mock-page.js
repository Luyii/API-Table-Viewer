// Serialized into the inspected page through the DevTools API. Keep self-contained.
function installPageResponseMocks(config){
  'use strict';
  const key='__API_TABLE_VIEWER_RESPONSE_MOCK_V1__',g=globalThis;
  if(g.top && g.top!==g)return {active:false,reason:'仅支持主页面',origin:g.location.origin};
  if(!/^https?:$/.test(g.location.protocol))throw Error('响应替换仅支持 HTTP / HTTPS 网页');
  let existing=g[key];
  if(existing && existing.version!==1)throw Error('页面中存在不兼容的响应替换器');
  if(config.action==='status')return existing?.owner===config.owner?existing.status(true):{active:false,origin:g.location.origin,rules:[]};
  if(config.action==='stop'){
    if(existing?.owner===config.owner)existing.stop();
    return {active:false,origin:g.location.origin,rules:[]};
  }
  if(config.action!=='set')throw Error('未知的响应替换操作');
  if(config.origin && config.origin!==g.location.origin)throw Error('网页来源已改变，请重新启用替换');
  if(!Array.isArray(config.rules) || config.rules.length>10)throw Error('最多支持 10 条替换规则');
  const encoder=new TextEncoder();let total=0;
  const next=config.rules.map(rule=>{
    const url=new URL(rule.url);
    if(!/^https?:$/.test(url.protocol) || url.username || url.password)throw Error('接口 URL 无效');
    url.hash='';
    if(!/^(GET|POST|PUT|PATCH|DELETE)$/.test(rule.method))throw Error('仅支持 GET / POST / PUT / PATCH / DELETE');
    if(typeof rule.body!=='string' || encoder.encode(rule.body).byteLength>1024*1024)throw Error('单条响应不能超过 1 MiB');
    total+=encoder.encode(rule.body).byteLength;
    if(total>3*1024*1024)throw Error('启用的响应总大小不能超过 3 MiB');
    JSON.parse(rule.body.replace(/^\uFEFF/,''));
    if(!Number.isInteger(rule.status) || rule.status<200 || rule.status>599 || [204,205,304].includes(rule.status))throw Error('状态码须为支持 JSON 正文的 200–599 整数');
    return {id:String(rule.id),method:rule.method,url:url.href,body:rule.body,status:rule.status,once:rule.once===true,enabled:true,hits:0,lastKind:'',lastHit:0};
  });
  if(new Set(next.map(rule=>rule.method+' '+rule.url)).size!==next.length)throw Error('替换规则不能重复');
  if(existing?.owner!==config.owner){existing?.stop();existing=null;}
  if(existing)return existing.replace(next);
  const originalFetch=g.fetch,OriginalXHR=g.XMLHttpRequest;
  if(typeof originalFetch!=='function' || typeof OriginalXHR!=='function')throw Error('页面缺少 Fetch 或 XMLHttpRequest');
  let rules=next,enabled=true,expires=Date.now()+120000,expiryTimer;
  const instance=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const xhrStates=new WeakMap();
  const statusTexts={200:'OK',201:'Created',202:'Accepted',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',422:'Unprocessable Content',500:'Internal Server Error',502:'Bad Gateway',503:'Service Unavailable'};
  function alive(){if(enabled && Date.now()>=expires)stop();return enabled;}
  function take(method,url,kind){
    if(!alive())return null;
    const parsed=new URL(url,g.location.href);parsed.hash='';
    const rule=rules.find(item=>item.enabled && item.method===method && item.url===parsed.href);
    if(!rule)return null;
    rule.hits++;rule.lastKind=kind;rule.lastHit=Date.now();if(rule.once)rule.enabled=false;
    return rule;
  }
  function decorate(response,url){
    Object.defineProperty(response,'url',{value:url,configurable:true});
    const clone=response.clone.bind(response);
    Object.defineProperty(response,'clone',{value:()=>decorate(clone(),url),configurable:true});
    return response;
  }
  async function wrappedFetch(input,init){
    const url=input instanceof Request?input.url:new URL(String(input),g.location.href).href;
    const method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    // A Request validates inputs without consuming a body on the pass-through path.
    if(!alive() || !rules.some(rule=>rule.enabled && rule.method===method && rule.url===url.split('#')[0]))return Reflect.apply(originalFetch,this,arguments);
    const request=new Request(input instanceof Request?input:url,init);
    if(request.mode==='no-cors')throw new TypeError('响应替换不支持 no-cors 请求，请停用该规则后重试');
    if(request.signal.aborted)throw request.signal.reason??new DOMException('The operation was aborted.','AbortError');
    const rule=take(request.method,request.url,'Fetch');
    if(!rule)return Reflect.apply(originalFetch,this,arguments);
    await new Promise((resolve,reject)=>{
      const signal=request.signal;
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason??new DOMException('The operation was aborted.','AbortError'));};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},0);
      signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    });
    return decorate(new Response(rule.body,{status:rule.status,statusText:statusTexts[rule.status]||'',headers:{'content-type':'application/json; charset=utf-8','x-api-table-viewer-mock':'1'}}),request.url);
  }
  class MockXHR extends OriginalXHR{
    constructor(){super();xhrStates.set(this,{method:'',url:'',async:true,sent:false,mock:null,timer:null});}
    open(method,url,async=true,...rest){
      const state=xhrStates.get(this);clearTimeout(state.timer);
      if(state.mock)state.mock.aborted=true;
      state.mock=null;state.sent=false;
      state.method=String(method).toUpperCase();state.url=new URL(String(url),g.location.href).href;state.async=Boolean(async);
      return super.open(method,url,async,...rest);
    }
    send(body){
      const state=xhrStates.get(this);
      if(this.readyState!==1 || state.sent)throw new DOMException('Invalid XHR state.','InvalidStateError');
      const match=alive() && rules.some(rule=>rule.enabled && rule.method===state.method && rule.url===state.url.split('#')[0]);
      if(!match)return super.send(body);
      if(!state.async)throw new DOMException('响应替换仅支持异步 XHR。','InvalidAccessError');
      const rule=take(state.method,state.url,'XHR');
      if(!rule)return super.send(body);
      state.sent=true;
      const mock={rule,readyState:1,aborted:false,json:undefined};state.mock=mock;
      this.dispatchEvent(new ProgressEvent('loadstart'));
      if(mock.aborted || state.mock!==mock)return;
      state.timer=setTimeout(()=>{
        const current=()=>state.mock===mock && !mock.aborted;
        for(const readyState of [2,3]){
          if(!current())return;mock.readyState=readyState;this.dispatchEvent(new Event('readystatechange'));
        }
        if(!current())return;
        const size=encoder.encode(rule.body).byteLength;
        this.dispatchEvent(new ProgressEvent('progress',{lengthComputable:true,loaded:size,total:size}));
        if(!current())return;mock.readyState=4;this.dispatchEvent(new Event('readystatechange'));
        if(!current())return;this.dispatchEvent(new ProgressEvent('load',{lengthComputable:true,loaded:size,total:size}));
        if(current())this.dispatchEvent(new ProgressEvent('loadend',{lengthComputable:true,loaded:size,total:size}));
      },0);
    }
    abort(){
      const state=xhrStates.get(this),mock=state.mock;
      if(!mock)return super.abort();
      clearTimeout(state.timer);
      if(mock.readyState===4){mock.aborted=true;mock.readyState=0;state.sent=false;return;}
      mock.aborted=true;mock.readyState=4;
      this.dispatchEvent(new Event('readystatechange'));this.dispatchEvent(new ProgressEvent('abort'));this.dispatchEvent(new ProgressEvent('loadend'));
      mock.readyState=0;state.sent=false;
    }
    setRequestHeader(name,value){if(xhrStates.get(this).sent)throw new DOMException('Invalid XHR state.','InvalidStateError');return super.setRequestHeader(name,value);}
    get readyState(){return xhrStates.get(this)?.mock?.readyState??super.readyState;}
    get status(){const mock=xhrStates.get(this)?.mock;return mock?(mock.readyState>=2 && !mock.aborted?mock.rule.status:0):super.status;}
    get statusText(){const mock=xhrStates.get(this)?.mock;return mock?(this.status?statusTexts[this.status]||'':''):super.statusText;}
    get responseURL(){const state=xhrStates.get(this);return state?.mock?(this.status?state.url.split('#')[0]:''):super.responseURL;}
    get responseText(){
      const mock=xhrStates.get(this)?.mock;if(!mock)return super.responseText;
      if(this.responseType && this.responseType!=='text')throw new DOMException('responseText is unavailable for this responseType.','InvalidStateError');
      return mock.readyState>=3 && !mock.aborted?mock.rule.body:'';
    }
    get responseXML(){return xhrStates.get(this)?.mock?null:super.responseXML;}
    get response(){
      const mock=xhrStates.get(this)?.mock;if(!mock)return super.response;
      const type=this.responseType;
      if(!type || type==='text')return this.responseText;
      if(mock.readyState!==4 || mock.aborted)return null;
      if(type==='json'){if(mock.json===undefined)mock.json=JSON.parse(mock.rule.body.replace(/^\uFEFF/,''));return mock.json;}
      if(type==='blob')return mock.blob??(mock.blob=new Blob([mock.rule.body],{type:'application/json'}));
      if(type==='arraybuffer')return mock.buffer??(mock.buffer=encoder.encode(mock.rule.body).buffer);
      return null;
    }
    getResponseHeader(name){
      if(!xhrStates.get(this)?.mock)return super.getResponseHeader(name);
      if(!this.status)return null;
      return {'content-type':'application/json; charset=utf-8','x-api-table-viewer-mock':'1'}[String(name).toLowerCase()]??null;
    }
    getAllResponseHeaders(){return xhrStates.get(this)?.mock?(this.status?'content-type: application/json; charset=utf-8\r\nx-api-table-viewer-mock: 1\r\n':''):super.getAllResponseHeaders();}
  }
  function stop(){
    enabled=false;clearTimeout(expiryTimer);
    if(g.fetch===wrappedFetch)g.fetch=originalFetch;
    if(g.XMLHttpRequest===MockXHR)g.XMLHttpRequest=OriginalXHR;
    if(g[key]===api)delete g[key];
  }
  function status(renew=false){
    alive();
    if(renew && enabled){expires=Date.now()+120000;clearTimeout(expiryTimer);expiryTimer=setTimeout(stop,120000);}
    return {active:enabled,origin:g.location.origin,instance,rules:rules.map(({id,enabled,hits,lastKind,lastHit})=>({id,enabled,hits,lastKind,lastHit}))};
  }
  const api={version:1,owner:config.owner,stop,status,replace(nextRules){
    for(const rule of nextRules){const old=rules.find(item=>item.id===rule.id);if(old && old.body===rule.body && old.status===rule.status && old.once===rule.once){rule.hits=old.hits;rule.lastKind=old.lastKind;rule.lastHit=old.lastHit;}}
    rules=nextRules;return status(true);
  }};
  try{g[key]=api;g.fetch=wrappedFetch;g.XMLHttpRequest=MockXHR;}
  catch(error){stop();throw Error('页面的请求 API 不允许替换：'+error.message);}
  return status(true);
}
