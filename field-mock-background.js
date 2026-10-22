// Session storage survives navigation and service-worker suspension, scoped by tab + page origin.
importScripts('field-patch-core.js');
const fieldWrites=new Map();
const originOf=url=>{const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw Error('仅支持 HTTP / HTTPS 页面');return u.origin;};
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!message || message.channel!=='atv-fields')return;
  const run=async()=>{
    const tabId=sender.tab?.id??message.tabId;
    if(!Number.isInteger(tabId))throw Error('标签页不可用');
    if(sender.tab && sender.frameId!==0)throw Error('仅支持主页面');
    const origin=originOf(sender.tab?sender.url:(await chrome.tabs.get(tabId)).url);
    if(!sender.tab && message.origin && message.origin!==origin)throw Error('网页已切换，请重新编辑');
    const storageKey='field-mock:'+tabId;
    const sessions=(await chrome.storage.session.get(storageKey))[storageKey]||{};
    if(message.action==='set'){
      if(sender.tab)throw Error('网页不能写入编辑规则');
      const rules=message.rules;
      if(!Array.isArray(rules) || rules.length>30 || JSON.stringify(rules).length>1024*1024)throw Error('修改规则过多（最多 30 个接口 / 1 MiB 配置）');
      const seen=new Set();
      for(const rule of rules){
        const url=new URL(rule.url);url.hash='';
        if(!/^https?:$/.test(url.protocol) || url.username || url.password || url.href!==rule.url || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(rule.method) || !Array.isArray(rule.patches) || rule.patches.length>200)throw Error('接口规则无效');
        const key=rule.method+' '+rule.url;if(seen.has(key))throw Error('接口规则重复');seen.add(key);
        for(const patch of rule.patches)FieldPatchCore.validate(patch);
      }
      if(rules.length)sessions[origin]=rules;else delete sessions[origin];
      if(JSON.stringify(sessions).length>3*1024*1024)throw Error('当前标签页保存的修改过多');
      await chrome.storage.session.set({[storageKey]:sessions});
      // A page may have navigated between storage and delivery; the bridge checks origin again.
      await chrome.tabs.sendMessage(tabId,{channel:'atv-fields-config',origin,rules},{frameId:0}).catch(()=>{});
    }
    return {origin,rules:sessions[origin]||[]};
  };
  const tabId=sender.tab?.id??message.tabId;
  const previous=fieldWrites.get(tabId)||Promise.resolve();
  const pending=previous.catch(()=>{}).then(run);
  fieldWrites.set(tabId,pending);
  pending.then(result=>reply({ok:true,...result}),error=>reply({ok:false,error:error.message})).finally(()=>{if(fieldWrites.get(tabId)===pending)fieldWrites.delete(tabId);});
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{void chrome.storage.session.remove('field-mock:'+tabId);});
