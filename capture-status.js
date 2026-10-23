// Load before panel.js so startup failures remain visible even if panel boot stops.
(()=>{
  const state={started:false,received:0,empty:0,accepted:0,error:''};
  function render(){
    const el=document.getElementById('captureStatus');if(!el)return;
    el.textContent='捕获诊断 D2 · '+(state.error?'捕获异常：'+state.error:!state.started?'正在启动接口监听…':`监听中 · 收到 ${state.received} · 正文不可读 ${state.empty} · 已解析 ${state.accepted}`);
    el.title='收到包含历史记录和非 JSON 请求；正文不可读计数按请求统计。若已解析但列表为空，请检查搜索、方法及状态筛选。';
  }
  window.CaptureStatus={update(values){Object.assign(state,values);render();},count(key){state[key]++;render();}};
  window.addEventListener('error',event=>{state.error=event.message||'脚本加载失败：'+(event.target?.src||'未知资源');render();},true);
  window.addEventListener('unhandledrejection',event=>{state.error=event.reason?.message||String(event.reason);render();});
  document.addEventListener('DOMContentLoaded',render,{once:true});
})();
