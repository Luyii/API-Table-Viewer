(()=>{
  const channel='atv-fields-page-v1';let config=null;
  const publish=()=>{if(config)window.postMessage({channel,kind:'config',origin:location.origin,rules:config},location.origin);};
  window.addEventListener('message',event=>{if(event.source===window && event.origin===location.origin && event.data?.channel===channel && event.data.kind==='ready')publish();});
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.channel==='atv-fields-config' && message.origin===location.origin){config=message.rules;publish();}
  });
  chrome.runtime.sendMessage({channel:'atv-fields',action:'get'}).then(result=>{
    // An incoming update can beat the initial read; never overwrite it with the old snapshot.
    if(config===null)config=result?.ok?result.rules:[];publish();
  }).catch(()=>{if(config===null)config=[];publish();});
})();
