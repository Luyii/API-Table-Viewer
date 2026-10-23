// Large subtrees are fully expanded logically; only visible rows enter the DOM.
const inlineArrayScopes=new Set();
const expansionHost=s=>s.inlineHost||$('#modalContent');
function releaseViewerExpansion(s){
  if(!s?.expansion)return;
  const expansion=s.expansion;s.expansion=null;expansion.released=true;expansion.observer?.disconnect();
  void callWorker('viewerExpandRelease',{rid:s.rid,token:expansion.token}).catch(()=>{});
  if(expansion.scrollTarget)expansion.scrollTarget.removeEventListener?.('scroll',expansion.scrollListener);
  else expansionHost(s).onscroll=null;
  if(s.inlineStatus)s.inlineStatus.classList.add('hidden');else $('#viewerExpansionStatus').classList.add('hidden');
}
async function expandWholeViewer(path,scope=null){
  const s=scope||viewerState;if(!s)return;releaseViewerExpansion(s);
  const version=++s.version;if(!s.inlineHost)setViewerExpandToggle(false);s.path=[...path];s.focusPath=null;s.complete=false;
  if(!s.inlineHost){modalSource={rid:s.rid,path:[...path]};$('#viewerPath').textContent=pathText(path);$('#viewerPathInput').value=pathText(path);}
  const host=expansionHost(s);host.textContent='正在展开全部数据…';host.classList.remove('viewer-complete');if(!s.inlineHost)host.scrollTop=0;
  const result=await callWorker('viewerExpandStart',{rid:s.rid,path});
  if(!(s.inlineCurrent?s.inlineCurrent():viewerState===s) || s.version!==version){void callWorker('viewerExpandRelease',{rid:s.rid,token:result.token}).catch(()=>{});return;}
  const root=document.createElement('div');root.className='viewer-virtual';root.setAttribute('role','tree');host.textContent='';host.appendChild(root);
  const expansion={token:result.token,total:0,done:false,failed:false,released:false,root,version,renderVersion:0,running:false,collapsedCount:0,toggleBusy:false,status:s.inlineStatus};s.expansion=expansion;
  if(s.inlineStatus)s.inlineStatus.classList.remove('hidden');else $('#viewerExpansionStatus').classList.remove('hidden');
  const viewport=s.inlineHost?(host.closest?.('.tree, .modal-content')||host):host;
  if(s.inlineHost){
    expansion.scrollTarget=viewport;expansion.scrollListener=safe(()=>renderExpandedViewport(s,expansion));
    viewport.addEventListener('scroll',expansion.scrollListener,{passive:true});
  }else host.onscroll=safe(()=>renderExpandedViewport(s,expansion));
  if(typeof ResizeObserver==='function'){expansion.observer=new ResizeObserver(safe(()=>renderExpandedViewport(s,expansion)));expansion.observer.observe(viewport);}
  return continueWholeExpansion(s,expansion);
}
function expansionCurrent(s,e){return (s.inlineCurrent?s.inlineCurrent():viewerState===s) && s.expansion===e && s.version===e.version && !e.released;}
function expansionStatus(e){
  (e.status||$('#viewerExpansionText')).textContent=`${e.done?(e.collapsedCount?'已展开（局部收起）':'已全部展开'):e.failed?'展开失败':'正在展开全部数据'} · ${e.total.toLocaleString()} 个节点（滚动查看）`;
}
async function continueWholeExpansion(s,e){
  if(e.running || !expansionCurrent(s,e))return;e.running=true;
  try{
    while(expansionCurrent(s,e) && !e.done){
      const r=await callWorker('viewerExpandStep',{rid:s.rid,token:e.token});if(!expansionCurrent(s,e))return;
      e.total=r.total;e.done=r.done;e.collapsedCount=r.collapsedCount;expansionStatus(e);await renderExpandedViewport(s,e);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }catch(error){if(expansionCurrent(s,e)){e.failed=true;expansionStatus(e);throw error;}}
  finally{e.running=false;}
}
async function renderExpandedViewport(s,e){
  if(!expansionCurrent(s,e))return;
  const offset=s.inlineHost?1:0;
  const host=expansionHost(s),viewport=e.scrollTarget||host,height=32;
  const scroll=s.inlineHost?Math.max(0,(viewport.getBoundingClientRect?.().top||0)+(viewport.clientTop||0)-(host.getBoundingClientRect?.().top||0)):(host.scrollTop||0);
  const start=Math.max(0,Math.floor(scroll/height)-8),limit=Math.min(160,Math.ceil((viewport.clientHeight||600)/height)+16),version=++e.renderVersion;
  const result=await callWorker('viewerExpandRows',{rid:s.rid,token:e.token,start:start+offset,limit,query:s.query});
  if(!expansionCurrent(s,e) || version!==e.renderVersion)return;
  e.total=result.total;e.collapsedCount=result.collapsedCount;expansionStatus(e);
  e.root.textContent='';const top=document.createElement('div');top.style.height=(Math.max(0,result.start-offset)*height)+'px';e.root.appendChild(top);
  for(const meta of result.rows){
    const row=document.createElement('div');row.className='viewer-flat-row';row.style.paddingLeft=(Math.min(24,Math.max(0,meta.path.length-s.home.length-offset))*16)+'px';
    row.dataset.expansionIndex=String(meta.index);row.setAttribute('role','treeitem');
    const expandable=meta.type==='object'||meta.type==='array';
    if(expandable){
      row.classList.add('viewer-expandable');row.tabIndex=0;row.setAttribute('aria-expanded',String(meta.expanded));
      row.onclick=safe(()=>toggleExpandedRow(s,e,meta,document.activeElement===row));
      row.onkeydown=safe(event=>{
        if(event.target!==row)return;
        if(event.key==='Enter' || event.key===' ' || event.key==='ArrowLeft' && meta.expanded || event.key==='ArrowRight' && !meta.expanded){
          event.preventDefault();return toggleExpandedRow(s,e,meta,true);
        }
      });
    }
    const arrow=document.createElement('span');arrow.className='flat-caret';arrow.textContent=expandable?(meta.expanded?'▾':'▸'):'·';row.appendChild(arrow);
    const key=document.createElement('span');key.className='viewer-key';highlightText(key,meta.path.length?String(meta.path.at(-1)):'root',s.query);key.title=pathText(meta.path);row.appendChild(key);
    const value=document.createElement('span');value.className='viewer-value type-'+meta.type;highlightText(value,meta.label,s.query);value.title=meta.label;row.appendChild(value);
    if(!['array','object'].includes(meta.type))bindValueCopy(value,s.rid,meta.path);
  if(typeof FieldMock!=='undefined')FieldMock.bind(value,selected?.rid===s.rid?selected:null,meta.path,meta.type,row);
    if(meta.type==='array'){
      const bulk=arrayBulkButton();setArrayBulkButton(bulk,e.bulkExpanded?.has(meta.index)===true);
      bulk.onclick=safe(event=>{event.stopPropagation();return toggleExpandedRow(s,e,meta,true,true);});row.appendChild(bulk);
    }
    if(expandable)row.appendChild(complexCopyButton(s.rid,meta.path));
    row.appendChild(viewerButton('进入',()=>s.inlineHost?openJsonViewer(s.rid,meta.path,pathText(meta.path)):navigateViewer(meta.path)));
    row.appendChild(viewerButton('路径',()=>copyText(pathText(meta.path))));e.root.appendChild(row);
  }
  const bottom=document.createElement('div');bottom.style.height=Math.max(0,(result.total-result.start-result.rows.length)*height)+'px';e.root.appendChild(bottom);
}

async function toggleExpandedRow(s,e,meta,restoreFocus=false,recursive=false){
  if(!expansionCurrent(s,e) || e.toggleBusy)return;
  e.toggleBusy=true;
  try{
    const collapsed=recursive?e.bulkExpanded?.has(meta.index)===true:meta.expanded;
    let result=await callWorker('viewerExpandToggle',{rid:s.rid,token:e.token,index:meta.index,collapsed,recursive});
    if(recursive && collapsed)result=await callWorker('viewerExpandToggle',{rid:s.rid,token:e.token,index:meta.index,collapsed:false,recursive:false});
    if(recursive){e.bulkExpanded??=new Set();if(collapsed)e.bulkExpanded.delete(meta.index);else e.bulkExpanded.add(meta.index);}
    if(!expansionCurrent(s,e))return;
    e.total=result.total;e.collapsedCount=result.collapsedCount;expansionStatus(e);
    if(!s.inlineHost && meta.path.length===s.path.length && meta.path.every((key,index)=>key===s.path[index]))setViewerExpandToggle(meta.expanded);
    const host=expansionHost(s);
    if(!s.inlineHost)host.scrollTop=Math.min(host.scrollTop||0,Math.max(0,(result.total-(s.inlineHost?1:0))*32-(host.clientHeight||600)));
    await renderExpandedViewport(s,e);
    if(restoreFocus && expansionCurrent(s,e))e.root.querySelector('[data-expansion-index="'+meta.index+'"]'+(recursive?' .array-bulk-toggle':''))?.focus({preventScroll:true});
  }finally{e.toggleBusy=false;}
}

function releaseInlineArrayScopes(owner,host){
  for(const scope of inlineArrayScopes)if((!owner || scope.owner===owner) && (!host || scope.inlineAnchor===host || host.contains?.(scope.inlineAnchor))){scope.cancelled=true;releaseViewerExpansion(scope);inlineArrayScopes.delete(scope);}
}
function bindInlineArrayBulk(button,head,child,options){
  let scope=null,busy=false;
  button.onclick=safe(async event=>{
    event.stopPropagation();if(busy || !options.isCurrent())return;
    busy=true;button.disabled=true;
    try{
      const expanded=!!scope;
      if(scope){scope.cancelled=true;releaseViewerExpansion(scope);inlineArrayScopes.delete(scope);scope=null;}
      releaseInlineArrayScopes(undefined,child);child.textContent='';delete child.dataset.loaded;
      if(expanded){
        const data=await callWorker('children',{rid:options.rid,path:options.path,offset:0});
        if(!options.isCurrent())return;
        child.classList.remove('hidden');options.setOpen(true);
        if(options.owner){for(const meta of data.children)await viewerNode(meta,meta.path,child,false);}
        else renderChildren(data.children,child);
        appendMoreInline(data,child,options);
        child.dataset.loaded='1';setArrayBulkButton(button,false);return;
      }
      child.classList.remove('hidden');child.dataset.loaded='1';options.setOpen(true);setArrayBulkButton(button,true);
      const status=document.createElement('div');status.className='array-inline-status';status.setAttribute('role','status');child.appendChild(status);
      const host=document.createElement('div');host.className='array-inline-viewport';host.tabIndex=0;host.setAttribute('aria-label','数组全部项 '+pathText(options.path));child.appendChild(host);
      scope={rid:options.rid,home:[...options.path],path:[...options.path],query:options.owner?.query||'',version:0,inlineHost:host,inlineStatus:status,inlineAnchor:child,owner:options.owner,cancelled:false};
      const current=scope;scope.inlineCurrent=()=>!current.cancelled && options.isCurrent();inlineArrayScopes.add(scope);
      await expandWholeViewer(options.path,scope);
    }finally{busy=false;button.disabled=false;setArrayBulkButton(button,!!scope);}
  });
}

function appendMoreInline(data,child,options){
  if(!options.owner){appendMore(data,child,options.path,options.rid);return;}
  if(data.offset+data.children.length>=data.totalChildren)return;
  child.appendChild(viewerButton('加载更多',async()=>{
    const next=await callWorker('children',{rid:options.rid,path:options.path,offset:data.offset+data.children.length});
    if(!options.isCurrent())return;
    child.lastChild?.remove();
    for(const meta of next.children)await viewerNode(meta,meta.path,child,false);
    appendMoreInline(next,child,options);
  }));
}
