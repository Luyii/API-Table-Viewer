// Panel-side rule manager. The inspected page receives fixed code plus JSON data only.
const ResponseMock=(()=>{
  const owner=crypto.randomUUID(),rules=new Map(),listeners=new Set();
  let active=false,origin='',busy=false,error='',queue=Promise.resolve(),reloading=false,reloadDeadline=0,reloadInstance='',navigation=0;
  const idFor=item=>String(item.method).toUpperCase()+' '+normalize(item.url);
  function normalize(url){const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol))throw Error('仅支持 HTTP / HTTPS 接口');parsed.hash='';return parsed.href;}
  function emit(){for(const fn of listeners)fn();renderBar();}
  function evaluate(config){
    return new Promise((resolve,reject)=>{
      const epoch=navigation;
      const inspected=chrome.devtools.inspectedWindow;
      if(!inspected?.eval){reject(Error('此环境不支持网页响应替换，请在 Chrome DevTools 中使用'));return;}
      const timer=setTimeout(()=>reject(Error('网页连接超时，请重新打开面板后重试')),8000);
      // JSON.stringify protects user text from being treated as executable code.
      const expression='('+installPageResponseMocks.toString()+')('+JSON.stringify({...config,owner})+')';
      try{inspected.eval(expression,(result,exception)=>{
        clearTimeout(timer);
        if(epoch!==navigation){reject(Error('网页已导航，请重新启用替换'));return;}
        if(chrome.runtime.lastError){reject(Error(chrome.runtime.lastError.message));return;}
        if(exception?.isException || exception?.isError){reject(Error(String(exception.value||exception.description||'无法连接网页')));return;}
        if(!result || typeof result.active!=='boolean' || typeof result.origin!=='string'){reject(Error('网页返回了无效的替换状态'));return;}
        resolve(result);
      });}catch(cause){clearTimeout(timer);reject(cause);}
    });
  }
  function sync(result){
    active=result.active;origin=result.origin;
    for(const entry of result.rules||[]){
      const rule=rules.get(entry.id);if(!rule)continue;
      rule.enabled=entry.enabled===true;
      if(Number.isSafeInteger(entry.hits) && entry.hits>=0)rule.hits=entry.hits;
      rule.lastKind=entry.lastKind==='XHR'?'XHR':entry.lastKind==='Fetch'?'Fetch':'';
    }
    if(!active)for(const rule of rules.values())rule.enabled=false;
  }
  function serialize(){return [...rules.values()].filter(rule=>rule.enabled).map(({id,method,url,body,status,once})=>({id,method,url,body,status,once}));}
  function transact(operation){
    const result=queue.then(async()=>{busy=true;error='';emit();try{return await operation();}catch(cause){error=cause.message||'响应替换失败';throw cause;}finally{busy=false;emit();}});
    queue=result.catch(()=>{});return result;
  }
  async function enable(item,body,options={}){
    // Validate before touching the currently active page rules.
    ResponseEditor.validate(body);
    const id=idFor(item),method=String(item.method).toUpperCase();
    if(!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method))throw Error('当前方法暂不支持响应替换');
    const status=Number(options.status??item.status??200);
    if(!Number.isInteger(status) || status<200 || status>599 || [204,205,304].includes(status))throw Error('状态码须为支持 JSON 正文的 200–599 整数（不含 204、205、304）');
    return transact(async()=>{
      if(active)sync(await evaluate({action:'status'}));
      const old=rules.get(id);
      rules.set(id,{id,method,url:normalize(item.url),body,status,once:options.once!==false,enabled:true,hits:old?.hits||0,lastKind:old?.lastKind||''});
      try{sync(await evaluate({action:'set',origin:active?origin:undefined,rules:serialize()}));}
      catch(cause){old?rules.set(id,old):rules.delete(id);throw cause;}
      while(rules.size>20){const stale=[...rules.values()].find(rule=>!rule.enabled && rule.id!==id);if(!stale)break;rules.delete(stale.id);}
      toast('替换已启用，请在网页重新触发请求');return get(item);
    });
  }
  function disable(item){return transact(async()=>{
    if(active)sync(await evaluate({action:'status'}));
    const rule=rules.get(idFor(item));if(!rule)return;
    const wasEnabled=rule.enabled;rule.enabled=false;
    try{sync(await evaluate(serialize().length?{action:'set',origin,rules:serialize()}:{action:'stop'}));}
    catch(cause){rule.enabled=wasEnabled;throw cause;}
    toast('该接口替换已停用');
  });}
  function stopAll(){return transact(async()=>{
    sync(await evaluate({action:'stop'}));reloading=false;toast('所有响应替换已停用');
  });}
  function reload(){return transact(async()=>{
    // Check the page origin before sending a pre-load injection to a reload.
    const status=await evaluate({action:'status'});
    if(status.origin!==origin)throw Error('网页来源已改变，请重新启用替换');
    sync(status);const current=serialize();if(!current.length)throw Error('请先启用至少一条替换规则');
    const script='('+installPageResponseMocks.toString()+')('+JSON.stringify({action:'set',owner,origin,rules:current})+')';
    reloading=true;reloadDeadline=Date.now()+15000;reloadInstance=status.instance;
    try{chrome.devtools.inspectedWindow.reload({ignoreCache:true,injectedScript:script});}
    catch(cause){reloading=false;throw cause;}
    active=false;toast('正在刷新网页并应用替换');
  });}
  async function refresh(){
    if(busy || (!active && !reloading))return;
    return transact(async()=>{
      const result=await evaluate({action:'status'});
      if(reloading && (!result.active || result.instance===reloadInstance) && Date.now()<reloadDeadline)return;
      if(reloading && result.instance===reloadInstance)error='未检测到刷新后的页面，请重试';
      sync(result);reloading=false;
    });
  }
  function get(item){
    let rule;try{if(item)rule=rules.get(idFor(item));}catch{}
    return {active,busy,error,reloading,rule:rule?{...rule}:null};
  }
  function renderBar(){
    const enabled=[...rules.values()].filter(rule=>rule.enabled).length;
    const hits=[...rules.values()].reduce((sum,rule)=>sum+rule.hits,0);
    $('#responseMockBar').classList.toggle('hidden',!enabled && !hits && !error && !reloading);
    $('#responseMockSummary').textContent=error?'替换异常：'+error:reloading?'正在刷新网页并应用替换…':`${active && enabled?'响应替换已启用':'响应替换未启用'} · ${enabled} 条规则 · 命中 ${hits} 次`;
    $('#responseMockStopAll').disabled=busy || !enabled;
    $('#responseMockRefresh').disabled=busy;
  }
  $('#responseMockStopAll').onclick=safe(stopAll);$('#responseMockRefresh').onclick=safe(refresh);
  chrome.devtools.network.onNavigated.addListener(()=>{
    if(reloading)return;
    navigation++;
    active=false;origin='';for(const rule of rules.values())rule.enabled=false;
    error='';emit();void evaluate({action:'stop'}).catch(()=>{});
  });
  const heartbeat=setInterval(()=>{void refresh().catch(()=>{});},5000);
  window.addEventListener('pagehide',()=>{clearInterval(heartbeat);void evaluate({action:'stop'}).catch(()=>{});},{once:true});
  return {enable,disable,stopAll,reload,refresh,get,subscribe(fn){listeners.add(fn);}};
})();
