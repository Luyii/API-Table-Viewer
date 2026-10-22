let viewerState=null, viewerEpoch=0;
function disposeViewer(){
  if(typeof releaseViewerExpansion==='function')releaseViewerExpansion(viewerState);
  viewerEpoch++;
  if(viewerState)void callWorker('viewerSearchRelease',{rid:viewerState.rid}).catch(()=>{});
  viewerState=null;
}
function viewerButton(label,fn){const b=document.createElement('button');b.className='mini-btn';b.textContent=label;b.onclick=safe(e=>{e.stopPropagation();return fn();});return b;}
async function openJsonViewer(rid,path,title){
  showModal(title,'正在加载 JSON…');
  const state={rid,home:[...path],path:[...path],query:'',rendered:0,epoch:++viewerEpoch,version:0,searchVersion:0};viewerState=state;
  modalSource={rid,path:[...path]};
  $('#viewerToolbar').classList.remove('hidden');$('#viewerQuery').value='';$('#viewerResults').textContent='';$('#viewerResults').classList.add('hidden');$('#viewerMatchPosition').textContent='0 / 0';$('#viewerPrevMatch').disabled=true;$('#viewerNextMatch').disabled=true;
  await navigateViewer(path);
}
function appendViewerContentActions(host,s,path){
  const bar=document.createElement('div');bar.className='viewer-content-actions';
  const rid=s.rid,currentPath=[...path];
  const copy=viewerButton('复制内容',async()=>{
    const result=await callWorker('valueText',{rid,path:currentPath});
    return copyText(result.text);
  });
  copy.title='复制当前节点的完整内容；文本不含 JSON 引号，分段内容也会完整复制';
  bar.appendChild(copy);
  const hint=document.createElement('span');hint.className='hint';hint.textContent='当前节点完整内容';bar.appendChild(hint);
  host.appendChild(bar);
}
async function navigateViewer(path,{targetPath=null,forceLazy=false,collapsed=false,expandAll=false}={}){
  const s=viewerState;if(!s)return;if(typeof releaseViewerExpansion==='function')releaseViewerExpansion(s);const version=++s.version;s.path=[...path];s.focusPath=targetPath?[...targetPath]:null;s.focusRow=null;s.rendered=0;
  setViewerExpandToggle(collapsed);
  const displayPath=s.focusPath||path;
  modalSource={rid:s.rid,path:[...displayPath]};
  $('#viewerPathInput').value=pathText(displayPath);
  $('#viewerPath').textContent=(targetPath?'已定位：':'')+pathText(displayPath);$('#viewerPath').title=pathText(displayPath);
  $('#viewerUp').disabled=displayPath.length===0;
  $('#modalContent').textContent='正在加载…';
  const doc=forceLazy?{complete:false}:await callWorker('viewerDocument',{rid:s.rid,path});
  if(viewerState!==s || s.version!==version)return;
  const host=$('#modalContent');host.textContent='';host.classList.toggle('viewer-complete',!!doc.complete);
  s.complete=!!doc.complete;
  if(!doc.complete && expandAll)return expandWholeViewer(path);
  if(!doc.complete && !forceLazy && !targetPath){
    setViewerExpandToggle(true);
    const note=document.createElement('div');note.className='viewer-large-notice';note.textContent=`当前数据较大（${doc.reason}），暂未展开。可选择按需浏览，避免一次展示导致卡顿。`;host.appendChild(note);
    host.appendChild(viewerButton('按需浏览此数据（展开全部）',()=>expandWholeViewer(path)));
    return;
  }
  const meta=doc.complete?doc.meta:await callWorker('children',{rid:s.rid,path});
  if(viewerState!==s || s.version!==version)return;
  if(meta.type==='array' || meta.type==='object'){
    const root=document.createElement('div');root.className='viewer-tree';root.setAttribute('role','tree');$('#modalContent').appendChild(root);
    await viewerNode(meta,path,root,!collapsed,targetPath);
    if(viewerState===s && s.version===version && s.focusRow)s.focusRow.scrollIntoView({block:"center",inline:"nearest",behavior:"auto"});
  } else if(doc.complete){
    appendViewerContentActions(host,s,path);
    const text=document.createElement('pre');text.className='viewer-scalar';highlightText(text,doc.text,s.query);host.appendChild(text);
    if(typeof FieldMock!=='undefined')FieldMock.bind(text,selected?.rid===s.rid?selected:null,path,doc.meta.type);
    const mark=text.querySelector('mark');if(mark)mark.scrollIntoView({block:'nearest',inline:'nearest'});
  } else await viewerScalar(path,-1,s,version);
}
async function viewerScalar(path,page,s,version){
  const request=s.scalarRequest=(s.scalarRequest||0)+1;
  const data=await callWorker('valuePage',{rid:s.rid,path,page,query:s.query});if(viewerState!==s || s.version!==version || request!==s.scalarRequest)return;
  const host=$('#modalContent');host.textContent='';
  appendViewerContentActions(host,s,path);
  const text=document.createElement('pre');text.className='viewer-scalar';highlightText(text,data.text,s.query);host.appendChild(text);
  const tools=document.createElement('div');tools.className='viewer-page';
  const prev=viewerButton('上一段',()=>viewerScalar(path,data.page-1,s,version));prev.disabled=data.page===0;
  const next=viewerButton('下一段',()=>viewerScalar(path,data.page+1,s,version));next.disabled=data.page>=data.pages-1;
  tools.appendChild(prev);const info=document.createElement('span');info.textContent=`第 ${data.page+1} / ${data.pages} 段 · 共 ${data.length.toLocaleString()} 字符`;tools.appendChild(info);tools.appendChild(next);host.appendChild(tools);
  const mark=text.querySelector('mark');if(mark)mark.scrollIntoView({block:'nearest',inline:'nearest'});
}
async function viewerNode(meta,path,parent,auto=false,targetPath=null){
  const s=viewerState;if(!s)return;const nodeVersion=s.version;
  const onRoute=!!targetPath && path.length<=targetPath.length && path.every((key,i)=>key===targetPath[i]);
  if(s.rendered>=(s.complete?5000:2000) && !onRoute){parent.appendChild(viewerButton(pathText(path)+' · 进入此处单独浏览',()=>navigateViewer(path)));return;}
  s.rendered++;
  if(s.complete && s.rendered%100===0){await new Promise(resolve=>setTimeout(resolve,0));if(viewerState!==s || s.version!==nodeVersion)return;}
  const version=s.version,wrap=document.createElement('div');wrap.className='viewer-node';
  const row=document.createElement('div');row.className='viewer-row';
  if(onRoute && path.length===targetPath.length){row.classList.add('viewer-search-target');row.setAttribute('tabindex','-1');s.focusRow=row;}
  const expandable=meta.type==='object'||meta.type==='array';
  if(expandable){
    row.classList.add('viewer-expandable');row.tabIndex=0;row.setAttribute('role','treeitem');row.setAttribute('aria-expanded','false');
    row.onclick=safe(()=>load(0));
    row.onkeydown=safe(e=>{
      if(e.target!==row)return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();return load(0);}
      if(e.key==='ArrowRight'&&!open){e.preventDefault();return load(0);}
      if(e.key==='ArrowLeft'&&open){e.preventDefault();return load(0);}
    });
  }
  const toggle=viewerButton(expandable?'▶':'·',()=>load(0));toggle.disabled=!expandable;row.appendChild(toggle);
  const key=document.createElement('span');key.className='viewer-key';highlightText(key,path.length?String(path.at(-1)):'root',s.query);row.appendChild(key);
  const value=document.createElement('span');value.className='viewer-value type-'+meta.type;highlightText(value,meta.label,s.query);row.appendChild(value);
  if(typeof FieldMock!=='undefined')FieldMock.bind(value,selected?.rid===s.rid?selected:null,path,meta.type);
  row.appendChild(viewerButton('进入',()=>navigateViewer(path)));
  row.appendChild(viewerButton('路径',()=>copyText(pathText(path))));
  row.appendChild(viewerButton('复制',async()=>{const r=await callWorker('value',{rid:s.rid,path});await copyText(r.text);}));
  wrap.appendChild(row);const child=document.createElement('div');child.className='viewer-children hidden';child.setAttribute('role','group');wrap.appendChild(child);parent.appendChild(wrap);
  let open=false,busy=false;
  async function load(offset=0,force=false){
    if(busy || viewerState!==s || s.version!==version)return;
    if(open && !force){child.classList.add('hidden');toggle.textContent='▶';row.setAttribute('aria-expanded','false');open=false;if(path.length===s.path.length&&path.every((k,i)=>k===s.path[i]))setViewerExpandToggle(true);return;}
    if(child.dataset.loaded && !force){child.classList.remove('hidden');toggle.textContent='▼';row.setAttribute('aria-expanded','true');open=true;setViewerExpandToggle(false);return;}
    busy=true;toggle.disabled=true;
    try{
      const focusKey=!force && onRoute && path.length<targetPath.length?targetPath[path.length]:undefined;
      const data=meta.fullChildren?{children:meta.fullChildren,totalChildren:meta.fullChildren.length,offset:0}:await callWorker('children',{rid:s.rid,path,offset,focusKey,query:s.query});
      if(viewerState!==s || s.version!==version)return;
      child.textContent='';child.classList.remove('hidden');toggle.textContent='▼';row.setAttribute('aria-expanded','true');open=true;setViewerExpandToggle(false);
      for(const c of data.children){
        if(viewerState!==s || s.version!==version)return;
        const expand=!!meta.fullChildren || !!targetPath && c.path.length<targetPath.length && c.path.every((key,i)=>key===targetPath[i]);
        await viewerNode(c,c.path,child,expand,targetPath);
      }
      if(!meta.fullChildren){
      const paging=document.createElement('div');paging.className='viewer-page';
      if(data.offset>0)paging.appendChild(viewerButton('上一批',()=>load(Math.max(0,data.offset-200),true)));
      const info=document.createElement('span');info.textContent=`${data.totalChildren?data.offset+1:0}–${data.offset+data.children.length} / ${data.totalChildren}`;paging.appendChild(info);
      if(data.offset+data.children.length<data.totalChildren)paging.appendChild(viewerButton('下一批',()=>load(data.offset+data.children.length,true)));
      child.appendChild(paging);
      }
      child.dataset.loaded='1';
    }finally{busy=false;toggle.disabled=false;}
  }
  if(auto && expandable)await load();
}
function renderViewerMatches(s){
  const host=$('#viewerResults');host.classList.remove('hidden');host.textContent='';
  const matches=s.searchMatches||[],index=s.matchIndex??-1,start=Math.max(0,Math.floor(Math.max(0,index)/50)*50);
  const status=document.createElement('span');status.className='hint';status.textContent=`${index>=0?index+1:0} / ${matches.length} 个已发现匹配 · 已扫描 ${(s.searchScanned||0).toLocaleString()} 个节点${s.searchDone?' · 搜索完成':' · 可继续搜索'}`;host.appendChild(status);
  for(let i=start;i<Math.min(start+50,matches.length);i++){
    const item=matches[i],b=viewerButton('',()=>selectViewerMatch(i));b.classList.toggle('viewer-result-current',i===index);highlightText(b,pathText(item.path)+'  '+item.label,s.query);host.appendChild(b);
  }
  if(!s.searchDone)host.appendChild(viewerButton('继续搜索下一批',()=>searchViewer(false)));
  $('#viewerMatchPosition').textContent=`${index>=0?index+1:0} / ${matches.length}${s.searchDone?'':'+'}`;
  $('#viewerPrevMatch').disabled=index<=0;
  $('#viewerNextMatch').disabled=s.searchDone && index>=matches.length-1;
}
async function selectViewerMatch(index){
  const s=viewerState;if(!s || !s.searchMatches?.[index])return;
  s.matchIndex=index;renderViewerMatches(s);return locateViewerResult(s.searchMatches[index].path);
}
async function searchViewer(restart=true){
  const s=viewerState;if(!s)return;
  const query=$('#viewerQuery').value.trim();
  if(!query){s.searchVersion++;s.searchBusy=false;s.query='';s.searchMatches=[];s.matchIndex=-1;s.searchDone=true;$('#viewerResults').classList.add('hidden');$('#viewerMatchPosition').textContent='0 / 0';$('#viewerPrevMatch').disabled=true;$('#viewerNextMatch').disabled=true;return navigateViewer(s.path);}
  if(s.searchBusy && s.query===query)return;
  if(s.query!==query)restart=true;
  s.searchBusy=true;s.query=query;const searchVersion=++s.searchVersion;
  try{
    const result=await callWorker('viewerSearch',{rid:s.rid,path:s.home,query,restart});
    if(viewerState!==s || s.searchVersion!==searchVersion || $('#viewerQuery').value.trim()!==query)return;
    const previous=restart?0:(s.searchMatches||[]).length;
    s.searchMatches=restart?result.items:[...(s.searchMatches||[]),...result.items];s.searchDone=result.done;s.searchScanned=result.scanned;
    s.matchIndex=result.items.length?previous:Math.min(s.matchIndex??-1,s.searchMatches.length-1);
    renderViewerMatches(s);
    if(result.items.length)await locateViewerResult(result.items[0].path);
  }finally{if(s.searchVersion===searchVersion)s.searchBusy=false;}
}
async function stepViewerMatch(delta){
  const s=viewerState;if(!s)return;
  const query=$('#viewerQuery').value.trim();
  if(!query){$('#viewerQuery').focus();return;}
  if(query!==s.query || !s.searchMatches)return searchViewer(true);
  if(s.searchBusy)return;
  const next=(s.matchIndex??-1)+delta;
  if(next>=s.searchMatches.length && !s.searchDone)return searchViewer(false);
  if(next>=0 && next<s.searchMatches.length)return selectViewerMatch(next);
}
function viewerCurrentPath(){return viewerState?.focusPath||viewerState?.path||[];}
async function locateViewerResult(path){
  const s=viewerState;if(!s)return;
  return navigateViewer(s.home,{targetPath:path});
}
$('#viewerHome').onclick=safe(()=>viewerState&&navigateViewer(viewerState.home));
$('#viewerUp').onclick=safe(()=>viewerState&&navigateViewer(viewerCurrentPath().slice(0,-1)));
function setViewerExpandToggle(collapsed){
  if(viewerState)viewerState.allCollapsed=collapsed;
  $('#viewerCollapse').textContent=collapsed?'展开全部':'收起全部';
  $('#viewerCollapse').setAttribute('aria-expanded',String(!collapsed));
}
async function toggleViewerExpansion(){
  const s=viewerState;if(!s)return;
  return s.allCollapsed?navigateViewer(s.path,{expandAll:true}):navigateViewer(s.path,{forceLazy:true,collapsed:true});
}
$('#viewerCollapse').onclick=safe(toggleViewerExpansion);
$('#viewerCopyPath').onclick=safe(()=>viewerState&&copyText(pathText(viewerCurrentPath())));
$('#viewerSearchBtn').onclick=safe(()=>searchViewer());
$('#viewerQuery').onkeydown=safe(e=>{if(e.key==='Enter'){e.preventDefault();return stepViewerMatch(e.shiftKey?-1:1);}});
$('#viewerPrevMatch').onclick=safe(()=>stepViewerMatch(-1));
$('#viewerNextMatch').onclick=safe(()=>stepViewerMatch(1));
$('#viewerFull').onclick=()=>{const card=$('.modal-card');card.classList.toggle('viewer-maximized',!card.classList.contains('viewer-maximized'));};
