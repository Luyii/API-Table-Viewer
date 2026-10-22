// Large subtrees are fully expanded logically; only visible rows enter the DOM.
function releaseViewerExpansion(s){
  if(!s?.expansion)return;
  const expansion=s.expansion;s.expansion=null;expansion.released=true;expansion.observer?.disconnect();
  void callWorker('viewerExpandRelease',{rid:s.rid,token:expansion.token}).catch(()=>{});
  $('#modalContent').onscroll=null;$('#viewerExpansionStatus').classList.add('hidden');
}
async function expandWholeViewer(path){
  const s=viewerState;if(!s)return;releaseViewerExpansion(s);
  const version=++s.version;setViewerExpandToggle(false);s.path=[...path];s.focusPath=null;s.complete=false;
  modalSource={rid:s.rid,path:[...path]};
  $('#viewerPath').textContent=pathText(path);$('#viewerPathInput').value=pathText(path);
  const host=$('#modalContent');host.textContent='正在展开全部数据…';host.classList.remove('viewer-complete');host.scrollTop=0;
  const result=await callWorker('viewerExpandStart',{rid:s.rid,path});
  if(viewerState!==s || s.version!==version){void callWorker('viewerExpandRelease',{rid:s.rid,token:result.token}).catch(()=>{});return;}
  const root=document.createElement('div');root.className='viewer-virtual';host.textContent='';host.appendChild(root);
  const expansion={token:result.token,total:0,done:false,failed:false,released:false,root,version,renderVersion:0,running:false};s.expansion=expansion;
  $('#viewerExpansionStatus').classList.remove('hidden');
  host.onscroll=safe(()=>renderExpandedViewport(s,expansion));
  if(typeof ResizeObserver==='function'){expansion.observer=new ResizeObserver(safe(()=>renderExpandedViewport(s,expansion)));expansion.observer.observe(host);}
  return continueWholeExpansion(s,expansion);
}
function expansionCurrent(s,e){return viewerState===s && s.expansion===e && s.version===e.version && !e.released;}
function expansionStatus(e){
  $('#viewerExpansionText').textContent=`${e.done?'已全部展开':e.failed?'展开失败':'正在展开全部数据'} · ${e.total.toLocaleString()} 个节点（滚动查看）`;
}
async function continueWholeExpansion(s,e){
  if(e.running || !expansionCurrent(s,e))return;e.running=true;
  try{
    while(expansionCurrent(s,e) && !e.done){
      const r=await callWorker('viewerExpandStep',{rid:s.rid,token:e.token});if(!expansionCurrent(s,e))return;
      e.total=r.total;e.done=r.done;expansionStatus(e);await renderExpandedViewport(s,e);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }catch(error){if(expansionCurrent(s,e)){e.failed=true;expansionStatus(e);throw error;}}
  finally{e.running=false;}
}
async function renderExpandedViewport(s,e){
  if(!expansionCurrent(s,e))return;
  const host=$('#modalContent'),height=32,start=Math.max(0,Math.floor((host.scrollTop||0)/height)-8),limit=Math.min(160,Math.ceil((host.clientHeight||600)/height)+16),version=++e.renderVersion;
  const result=await callWorker('viewerExpandRows',{rid:s.rid,token:e.token,start,limit,query:s.query});
  if(!expansionCurrent(s,e) || version!==e.renderVersion)return;
  e.root.textContent='';const top=document.createElement('div');top.style.height=(result.start*height)+'px';e.root.appendChild(top);
  for(const meta of result.rows){
    const row=document.createElement('div');row.className='viewer-flat-row';row.style.paddingLeft=(Math.min(24,Math.max(0,meta.path.length-s.home.length))*16)+'px';
    const arrow=document.createElement('span');arrow.className='flat-caret';arrow.textContent=meta.type==='object'||meta.type==='array'?'▾':'·';row.appendChild(arrow);
    const key=document.createElement('span');key.className='viewer-key';highlightText(key,meta.path.length?String(meta.path.at(-1)):'root',s.query);key.title=pathText(meta.path);row.appendChild(key);
    const value=document.createElement('span');value.className='viewer-value type-'+meta.type;highlightText(value,meta.label,s.query);value.title=meta.label;row.appendChild(value);
    if(typeof FieldMock!=='undefined')FieldMock.bind(value,selected?.rid===s.rid?selected:null,meta.path,meta.type,row);
    row.appendChild(viewerButton('进入',()=>navigateViewer(meta.path)));
    row.appendChild(viewerButton('路径',()=>copyText(pathText(meta.path))));
    row.appendChild(viewerButton('复制',async()=>{const r=await callWorker('value',{rid:s.rid,path:meta.path});return copyText(r.text);}));e.root.appendChild(row);
  }
  const bottom=document.createElement('div');bottom.style.height=Math.max(0,(result.total-result.start-result.rows.length)*height)+'px';e.root.appendChild(bottom);
}
