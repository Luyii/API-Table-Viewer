// MAIN-world document_start hook; real requests continue normally, then scalar patches apply.
(()=>{
  const channel='atv-fields-page-v1',nativeFetch=window.fetch,NativeXHR=window.XMLHttpRequest;
  let rules=[],serializedRules='[]',initialized=false,release;
  const ready=new Promise(resolve=>{release=resolve;});
  const timeout=setTimeout(()=>{initialized=true;release();console.warn('[API Table Viewer] 规则加载超时，启动请求回退到真实响应');},3000);
  const normalize=url=>{const u=new URL(url,location.href);u.hash='';return u.href;};
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.channel!==channel || event.data.kind!=='config' || event.data.origin!==location.origin)return;
    try{
      const next=event.data.rules;if(!Array.isArray(next) || next.length>30 || JSON.stringify(next).length>1024*1024)return;
      for(const rule of next){if(!Array.isArray(rule.patches) || rule.patches.length>200)return;for(const patch of rule.patches)FieldPatchCore.validate(patch);}
      const serialized=JSON.stringify(next);
      if(serialized!==serializedRules){rules=next;serializedRules=serialized;}
      initialized=true;clearTimeout(timeout);release();
    }catch{}
  });
  window.postMessage({channel,kind:'ready'},location.origin);
  const match=(method,url)=>rules.find(r=>r.method===method && r.url===normalize(url));
  function patchText(text,rule){
    if(text.length>20*1024*1024){console.warn('[API Table Viewer] 响应超过 20 MiB，未应用字段修改');return null;}
    try{
      const result=FieldPatchCore.apply(FieldPatchCore.parse(text),rule.patches);
      if(result.warnings.length)console.warn('[API Table Viewer] 部分修改已跳过：',result.warnings);
      return result.applied?FieldPatchCore.stringify(result.value):null;
    }catch(error){console.warn('[API Table Viewer] 无法修改响应：',error.message);return null;}
  }
  function decorate(response,original){
    for(const name of ['url','redirected','type'])Object.defineProperty(response,name,{value:original[name]});
    const clone=response.clone.bind(response);Object.defineProperty(response,'clone',{value:()=>decorate(clone(),original)});return response;
  }
  window.fetch=async function(input,init){
    if(!initialized)await ready;
    const method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    const url=input instanceof Request?input.url:String(input),rule=match(method,url);
    const response=await Reflect.apply(nativeFetch,this,arguments);
    if(!rule || response.type==='opaque' || !response.body || !/json/i.test(response.headers.get('content-type')||''))return response;
    let text;
    try{text=await response.clone().text();}catch{return response;}
    // Exit/edit while a request is in flight must not apply an obsolete rule.
    if(match(method,url)!==rule)return response;
    const patched=patchText(text,rule);if(patched===null)return response;
    const headers=new Headers(response.headers);for(const name of ['content-length','content-encoding','etag','content-md5'])headers.delete(name);
    headers.set('x-api-table-viewer-mock','fields');
    void response.body.cancel().catch(()=>{});
    return decorate(new Response(patched,{status:response.status,statusText:response.statusText,headers}),response);
  };
  const states=new WeakMap();
  class FieldXHR extends NativeXHR{
    constructor(){super();states.set(this,{generation:0,pending:false,sent:false,rule:null,body:undefined,json:undefined,type:null});}
    open(method,url,async=true,...rest){
      const state=states.get(this);state.generation++;state.pending=false;state.sent=false;state.rule=null;state.body=undefined;state.json=undefined;state.type=null;
      state.method=String(method).toUpperCase();state.url=normalize(String(url));state.async=Boolean(async);
      return super.open(method,url,async,...rest);
    }
    send(body){
      const state=states.get(this);if(state.sent || this.readyState!==1)throw new DOMException('Invalid XHR state','InvalidStateError');state.sent=true;
      const generation=state.generation;
      const send=()=>{
        if(generation!==state.generation)return;
        state.pending=false;const rule=match(state.method,state.url),type=super.responseType;
        if(rule && state.async && (!type || type==='text' || type==='json')){
          state.rule=rule;state.type=type;if(type==='json')super.responseType='text';
        }
        return super.send(body);
      };
      if(!state.async || initialized)return send();
      state.pending=true;void ready.then(send).catch(error=>{console.warn('[API Table Viewer] XHR 启动失败',error);this.dispatchEvent(new Event('error'));this.dispatchEvent(new Event('loadend'));});
    }
    abort(){const state=states.get(this),pending=state.pending;state.generation++;state.pending=false;state.rule=null;state.sent=false;const result=super.abort();if(pending){this.dispatchEvent(new Event('abort'));this.dispatchEvent(new Event('loadend'));}return result;}
    setRequestHeader(name,value){if(states.get(this).pending)throw new DOMException('Request already sent','InvalidStateError');return super.setRequestHeader(name,value);}
    get responseType(){return states.get(this)?.type??super.responseType;}
    set responseType(value){const state=states.get(this);if(state?.pending)throw new DOMException('Request already sent','InvalidStateError');super.responseType=value;if(state)state.type=null;}
    patched(){
      const state=states.get(this);
      if(!state.rule || this.readyState!==4 || !/json/i.test(super.getResponseHeader('content-type')||''))return undefined;
      if(state.body===undefined){if(match(state.method,state.url)!==state.rule)return undefined;state.body=patchText(super.responseText,state.rule)??null;}
      return state.body??undefined;
    }
    getResponseHeader(name){
      const changed=this.patched()!==undefined,key=String(name).toLowerCase();
      if(changed && key==='x-api-table-viewer-mock')return 'fields';
      if(changed && ['content-length','content-encoding','etag','content-md5'].includes(key))return null;
      return super.getResponseHeader(name);
    }
    getAllResponseHeaders(){
      const headers=super.getAllResponseHeaders();
      return this.patched()===undefined?headers:headers.split(/\r?\n/).filter(line=>line && !/^(content-length|content-encoding|etag|content-md5):/i.test(line)).join('\r\n')+'\r\nx-api-table-viewer-mock: fields\r\n';
    }
    get responseText(){
      const state=states.get(this);
      if(state?.type==='json')throw new DOMException('responseText unavailable for JSON','InvalidStateError');
      if(state?.rule && this.readyState===3)return '';
      return this.patched()??super.responseText;
    }
    get response(){
      const state=states.get(this);
      if(state?.type==='json'){
        if(this.readyState!==4)return null;
        if(state.json===undefined){try{state.json=JSON.parse(this.patched()??super.responseText);}catch{state.json=null;}}
        return state.json;
      }
      if(!super.responseType || super.responseType==='text')return this.patched()??super.response;
      return super.response;
    }
  }
  window.XMLHttpRequest=FieldXHR;
})();
