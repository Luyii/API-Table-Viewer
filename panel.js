const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const worker = new Worker("worker.js");

let requests = [];
let selected = null;
let pending = new Map();
let reqSeq = 0;
let tableState = {path:null,page:1,pageSize:100,query:"",sortKey:null,dir:1,columns:[],rows:[],total:0};
let modalCopyText="", modalSource=null, modalVersion=0;
let selectionVersion=0, tableVersion=0, captureGeneration=0;
const safe = fn => (...args) => {try{return Promise.resolve(fn(...args)).catch(e=>toast(e.message||"操作失败"));}catch(e){toast(e.message||"操作失败");return Promise.resolve();}};
worker.onerror = () => { for(const p of pending.values()) p.reject(Error("Worker 异常，请重新打开 DevTools")); pending.clear(); toast("Worker 异常，请重新打开 DevTools"); };
worker.onmessageerror = worker.onerror;

function callWorker(cmd, data={}) {
  return new Promise((resolve,reject)=>{
    const id=++reqSeq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error("处理超时，请缩小数据后重试"));},60000);
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
    try { worker.postMessage({cmd,id,...data}); } catch(e) { pending.get(id).reject(e);pending.delete(id); }
  });
}
worker.onmessage = e => {
  const p=pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
};

function toast(msg) {
  const el=$("#toast"); el.textContent=msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),1800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("已复制"); }
  catch { const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); let ok;try{ok=document.execCommand("copy");}finally{ta.remove();} if(!ok)throw Error("复制失败，请手动复制");toast("已复制"); }
}
function esc(v) {
  return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function highlightText(el,text,query){
  el.textContent='';text=String(text??'');const q=String(query??'').trim().toLowerCase();
  if(!q){el.appendChild(document.createTextNode(text));return;}
  const lower=text.toLowerCase();let from=0,hit,count=0;
  while((hit=lower.indexOf(q,from))!==-1 && count++<100){
    el.appendChild(document.createTextNode(text.slice(from,hit)));
    const mark=document.createElement('mark');mark.textContent=text.slice(hit,hit+q.length);el.appendChild(mark);from=hit+q.length;
  }
  el.appendChild(document.createTextNode(text.slice(from)));
}
function pathText(path) {
  return "root"+path.map(p=>Number.isInteger(p)?`[${p}]`:/^[A-Za-z_$][\w$]*$/.test(p)?`.${p}`:`[${stringifyJson(p)}]`).join("");
}
function typeClass(type){ return "type-"+type; }

async function addRequest(req, jsonRaw, generation=captureGeneration) {
  if(jsonRaw.length>20*1024*1024) return;
  let meta;
  try {meta=await callWorker("parse",{raw:jsonRaw});} catch(e) {if(!/JSON|Unexpected|position|token/i.test(e.message))toast(e.message);return;}
  if(generation!==captureGeneration){await callWorker("release",{rid:meta.rid});return;}
  const gone=new Set(meta.evicted);
  requests=requests.filter(x=>!gone.has(x.rid));
  if(selected && gone.has(selected.rid)){resetDetail();toast("当前数据已达到缓存期限，已释放");}
  const item={id:crypto.randomUUID(),url:req.request.url,method:req.request.method||"GET",status:req.response.status||0,time:Math.round(req.time||0),rid:meta.rid,valid:true,meta,details:snapshotRequest(req)};
  requests.unshift(item);renderList();
}
function resetDetail(){
  if(typeof ResponseEditor!=="undefined")ResponseEditor.reset();
  selected=null;selectionVersion++;tableVersion++;clearTimeout(window.st);
  tableState={path:null,page:1,pageSize:100,query:"",sortKey:null,dir:1,columns:[],rows:[],total:0};
  $("#detail").classList.add("hidden");$("#emptyState").classList.remove("hidden");
  $("#dataTable thead").textContent="";$("#dataTable tbody").textContent="";
  for(const id of ["pagination","tableMeta","tableBadge","rawPreview","rawMeta","tree"])$("#"+id).textContent="";
  $("#matchPosition").textContent="0 / 0";$("#prevMatch").disabled=true;$("#nextMatch").disabled=true;
  $("#requestDetails").textContent="";
  $('#treeSearch').value='';
  $("#tablePath").textContent="未选择数组";$("#tableSearch").value="";closeModal();
}
function renderList() {
  const q=$("#searchInput").value.trim().toLowerCase();
  const list=$("#requestList");
  const arr=requests.filter(x=>matchesRequestFilters(x,q));
  $("#requestCount").textContent=arr.length===requests.length?String(arr.length):`${arr.length} / ${requests.length}`;
  list.innerHTML="";
  if(!arr.length){list.innerHTML='<div class="empty">暂无 JSON 接口</div>';return;}
  for(const item of arr){
    const el=document.createElement("button");
    el.className="request-item"+(selected?.id===item.id?" active":"");
    el.dataset.id=item.id;
    el.innerHTML=`<div class="req-line"><span class="method small ${esc(item.method.toLowerCase())}">${esc(item.method)}</span><span class="status-dot ${item.status>=400?"bad":"ok"}"></span><span class="req-status">${item.status}</span><span class="req-time">${item.time}ms</span></div><div class="req-url" title="${esc(item.url)}">${esc(item.url)}</div>`;
    highlightText(el.querySelector(".req-url"),item.url,q);
    el.onclick=safe(()=>selectRequest(item));
    list.appendChild(el);
  }
}
async function selectRequest(item) {
  resetDetail(); selected=item; const version=selectionVersion; renderList();
  $("#emptyState").classList.add("hidden"); $("#detail").classList.remove("hidden");
  $("#methodBadge").textContent=item.method;
  $("#methodBadge").className="method "+item.method.toLowerCase();
  $("#statusBadge").textContent=item.status;
  $("#statusBadge").className="status "+(item.status>=400?"bad":"ok");
  $("#urlText").textContent=item.url; $("#urlText").title=item.url;
  tableState={path:null,page:1,pageSize:100,query:"",sortKey:null,dir:1,columns:[],rows:[],total:0};
  $("#tableSearch").value="";resetTablePreferences();renderRequestDetails(item);
  if(!item.valid){$("#tree").innerHTML='<div class="loading">正在解析 JSON…</div>'; return;}
  await renderTreeRoot(item,version);
  if(version!==selectionVersion)return;
  await renderRawPreview(item,version);
  if(version!==selectionVersion)return;
  activateTab("tree");
}
async function renderTreeRoot(item=selected,version=selectionVersion){
  const tree=$("#tree"); tree.innerHTML="";
  const meta=await callWorker("children",{rid:item.rid,path:[]});
  if(version!==selectionVersion)return;
  renderNode(meta,tree,true,[]);
}
function renderNode(meta,parent,root=false,path=[]) {
  const wrap=document.createElement("div"); wrap.className="node";
  const head=document.createElement("div"); head.className="node-head";
  const expandable=["object","array"].includes(meta.type);
  head.innerHTML=`<span class="caret ${expandable?"":"leaf"}">${expandable?"▶":""}</span><span class="node-key">${root?"root":esc(path[path.length-1])}</span><span class="node-type ${typeClass(meta.type)}">${esc(expandable?meta.label:meta.type)}</span>${!expandable?`<span class="node-preview">${esc(meta.label)}</span>`:""}`;
  if(meta.type==="array") {const b=document.createElement("button");b.className="mini-btn";b.textContent="▦ 表格";b.onclick=safe(e=>{e.stopPropagation();return openTable(path);});head.appendChild(b);}
  if(root){const b=document.createElement("button");b.className="mini-btn";b.textContent="查看";b.onclick=safe(e=>{e.stopPropagation();return showValue(path,"root");});head.appendChild(b);}
  if(!expandable && typeof FieldMock!=='undefined')FieldMock.bind(head.querySelector('.node-preview'),selected,path,meta.type);
  wrap.appendChild(head); parent.appendChild(wrap);
  const children=document.createElement("div"); children.className="node-children hidden"; wrap.appendChild(children);
  if(expandable){
    head.onclick=async()=>{
      const rid=selected?.rid; if(!rid)return;
      const caret=head.querySelector(".caret");
      if(!children.classList.contains("hidden")){children.classList.add("hidden");caret.textContent="▶";return;}
      children.classList.remove("hidden"); caret.textContent="▼";
      if(children.dataset.loaded)return;
      children.innerHTML='<div class="loading inline">正在加载…</div>';
      try {
        const data=await callWorker("children",{rid,path});
        children.innerHTML="";
        renderChildren(data.children,children);
        appendMore(data,children,path,rid);
        children.dataset.loaded="1";
      } catch(e){children.innerHTML=`<div class="error">加载失败：${esc(e.message)}</div>`;}
    };
  }
}
function renderChildren(list,parent){
  for(const c of list){
    const wrap=document.createElement("div"); wrap.className="node";
    const head=document.createElement("div"); head.className="node-head";
    const expandable=["object","array"].includes(c.type);
    const key=typeof c.key==="number"?`[${c.key}]`:c.key;
    const basePath=c.path;
    head.innerHTML=`<span class="caret ${expandable?"":"leaf"}">${expandable?"▶":""}</span><span class="node-key">${esc(key)}</span><span class="node-type ${typeClass(c.type)}">${esc(expandable?c.label:c.type)}</span>${!expandable?`<span class="node-preview">${esc(c.preview)}</span>`:""}`;
    if(expandable) {
      const actions=document.createElement("span"); actions.className="node-actions";
      if(c.type==="array") {
        const b=document.createElement("button"); b.className="mini-btn"; b.textContent="▦ 表格"; b.onclick=safe(e=>{e.stopPropagation();return openTable(basePath);}); actions.appendChild(b);
      }
      const v=document.createElement("button"); v.className="mini-btn"; v.textContent="查看"; v.onclick=safe(e=>{e.stopPropagation();return showValue(basePath,key);}); actions.appendChild(v);
      head.appendChild(actions);
    } else {
      const b=document.createElement("button"); b.className="copy-mini"; b.textContent="复制值"; b.onclick=safe(e=>{e.stopPropagation();return callWorker("value",{rid:selected.rid,path:basePath}).then(r=>copyText(c.type==="string"?JSON.parse(r.text):r.text));}); head.appendChild(b);
    }
    if(!expandable && typeof FieldMock!=='undefined')FieldMock.bind(head.querySelector('.node-preview'),selected,basePath,c.type);
    wrap.appendChild(head);
    const child=document.createElement("div"); child.className="node-children hidden"; wrap.appendChild(child);
    parent.appendChild(wrap);
    if(expandable){
      head.onclick=async()=>{
      const rid=selected?.rid; if(!rid)return;
        const caret=head.querySelector(".caret");
        if(!child.classList.contains("hidden")){child.classList.add("hidden");caret.textContent="▶";return;}
        child.classList.remove("hidden");caret.textContent="▼";
        if(child.dataset.loaded)return;
        child.innerHTML='<div class="loading inline">正在加载…</div>';
        try{
          const data=await callWorker("children",{rid,path:basePath});
          child.innerHTML="";
          renderChildren(data.children,child);
          appendMore(data,child,basePath,rid);
          child.dataset.loaded="1";
        }catch(e){child.innerHTML=`<div class="error">加载失败：${esc(e.message)}</div>`;}
      };
    }
  }
}
function appendMore(data,parent,path,rid){
  const offset=(data.offset||0)+data.children.length;
  if(offset>=data.totalChildren)return;
  const b=document.createElement("button");b.className="btn";b.textContent=`加载更多（${offset} / ${data.totalChildren}）`;
  b.onclick=safe(async()=>{b.disabled=true;try{const next=await callWorker("children",{rid,path,offset});b.remove();renderChildren(next.children,parent);appendMore(next,parent,path,rid);}catch(e){b.disabled=false;throw e;}});parent.appendChild(b);
}
async function openTable(path){
  resetTablePreferences();
  tableState.path=path; tableState.page=1; tableState.query=""; tableState.sortKey=null;tableState.dir=1;
  $("#tableSearch").value=""; $("#tablePath").textContent=pathText(path);
  activateTab("table"); await renderTable();
}
async function renderTable(navigate=false){
  if(!selected?.valid || !tableState.path)return;
  const version=++tableVersion, selection=selectionVersion;
  $("#dataTable tbody").innerHTML='<tr><td colspan="99" class="loading-cell">正在生成表格…</td></tr>';
  try{
    const r=await callWorker("table",{rid:selected.rid,path:tableState.path,page:tableState.page,pageSize:tableState.pageSize,query:tableState.query,sortKey:tableState.sortKey,dir:tableState.dir,preview:true,focusIndex:tableState.hitIndex||0,navigate});
    if(version!==tableVersion || selection!==selectionVersion)return;
    if(!r.ok) throw new Error(r.error);
    tableState={...tableState,...r};
    const thead=$("#dataTable thead"),tbody=$("#dataTable tbody");
    thead.innerHTML="";tbody.innerHTML="";
    if(r.focus && hiddenTableColumns.has(r.focus.column))hiddenTableColumns.delete(r.focus.column);
    const visibleColumns=r.columns.filter(c=>!hiddenTableColumns.has(c));
    const widths=resolvedTableWidths(visibleColumns,r.rows),colgroup=$("#tableColumns");colgroup.textContent="";
    for(const col of visibleColumns){const element=document.createElement("col");element.style.width=widths.get(col)+"px";colgroup.appendChild(element);}
    $("#dataTable").style.width=Math.max(88,[...widths.values()].reduce((sum,width)=>sum+width,0))+"px";
    updateColumnMenu();
    const tr=document.createElement("tr");
    for(const col of visibleColumns)tr.appendChild(createTableHeader(col,r.rows,widths.get(col)));
    thead.appendChild(tr);
    if(!r.rows.length)tbody.innerHTML='<tr><td colspan="999" class="loading-cell">暂无匹配数据</td></tr>';
    if(!r.columns.length){tbody.innerHTML='<tr><td class="loading-cell">数组中没有对象字段</td></tr>';}
    let focusedCell=null;
    for(const [rowOffset,row] of r.rows.entries()){
      const tr=document.createElement("tr");
      for(const col of visibleColumns){
        const td=document.createElement("td"),cell=row[col];
        td.classList.add("cell-type-"+cell.type);if(cell.type==="boolean")td.classList.add(cell.text==="true"?"bool-true":"bool-false");
        if(r.focus && r.focus.rowIndex===(r.page-1)*r.pageSize+rowOffset && r.focus.column===col){td.classList.add("search-current");focusedCell=td;}
        const text=cell.text,complex=cell.type==='object'||cell.type==='array';
        const content=document.createElement("div");content.className="cell-content";
        const span=document.createElement("span");span.className="cell-text"+(complex?" cell-complex":"");span.title=cell.type==="undefined"?"此行没有该字段":cell.type==="string"&&text===""?"空字符串":text;
        highlightText(span,cell.type==="undefined"?"—":cell.type==="string"&&text===""?'""':text,tableState.query);content.appendChild(span);td.appendChild(content);
        if(cell.path){
          span.classList.add("cell-viewable");span.title=span.title+"\n点击查看此字段";
          span.tabIndex=0;span.setAttribute("role","button");
          span.onclick=safe(e=>{e.stopPropagation();return showValue(cell.path,col);});
          span.onkeydown=safe(e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();return showValue(cell.path,col);}});
        }
        if(cell.matched){const badge=document.createElement("span");badge.className="match-badge";badge.textContent="内部匹配";content.appendChild(badge);}
        if(cell.expand && cell.path){
          const b=document.createElement("button");b.className="expand-cell";b.textContent="查看";
          b.onclick=safe(()=>showValue(cell.path,col));content.appendChild(b);
        }else td.ondblclick=safe(()=>copyText(text));
        if(typeof FieldMock!=='undefined' && cell.path && !complex && cell.type!=='undefined'){
          td.ondblclick=null;FieldMock.bind(span,selected,cell.path,cell.type,td);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    $("#tableMeta").textContent=`共 ${r.total} 条${r.total!==r.allTotal?`（过滤前 ${r.allTotal} 条）`:""} · 每页 ${r.pageSize} 条`;
    $("#tableBadge").textContent=String(r.allTotal);
    renderPagination(r.total);$("#pageSizeSelect").value=String(r.pageSize);
    tableState.hitIndex=r.focus?.index??0;
    $("#matchPosition").textContent=`${r.focus?r.focus.index+1:0} / ${r.hitTotal||0}`;
    $("#prevMatch").disabled=!r.hitTotal || tableState.hitIndex<=0;
    $("#nextMatch").disabled=!r.hitTotal || tableState.hitIndex>=r.hitTotal-1;
    if(focusedCell)focusedCell.scrollIntoView({block:"nearest",inline:"center",behavior:"auto"});
  }catch(e){if(version!==tableVersion || selection!==selectionVersion)return;$("#dataTable tbody").innerHTML=`<tr><td class="error-cell">${esc(e.message)}</td></tr>`;}
}
function renderPagination(total){
  const p=$("#pagination"),pages=Math.max(1,Math.ceil(total/tableState.pageSize));
  p.innerHTML="";
  const prev=document.createElement("button");prev.className="page-btn";prev.textContent="‹";prev.disabled=tableState.page<=1;prev.onclick=()=>{tableState.page--;renderTable();};p.appendChild(prev);
  const info=document.createElement("span");info.className="page-info";info.textContent=`${tableState.page} / ${pages}`;p.appendChild(info);
  const next=document.createElement("button");next.className="page-btn";next.textContent="›";next.disabled=tableState.page>=pages;next.onclick=()=>{tableState.page++;renderTable();};p.appendChild(next);
}
function activateTab(name){
  $$(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===name));
  $("#treePanel").classList.toggle("hidden",name!=="tree");
  $("#tablePanel").classList.toggle("hidden",name!=="table");
  $("#rawPanel").classList.toggle("hidden",name!=="raw");
  $("#requestPanel").classList.toggle("hidden",name!=="request");
}
async function renderRawPreview(item=selected,version=selectionVersion){
  const r=await callWorker("rawPreview",{rid:item.rid,max:50000});
  if(version!==selectionVersion)return;
  $("#rawPreview").textContent=r.text;
  $("#rawMeta").textContent=`${r.length.toLocaleString()} 字符${r.truncated?" · 已省略":" · 完整"}`;
}
async function showFullRaw(){
  if(!selected?.rid)return;
  return openJsonViewer(selected.rid,[],"JSON 查看器");
}
async function showValue(path,title){
  if(!selected?.rid)return;
  return openJsonViewer(selected.rid,path,String(title||'JSON 查看器'));
}
function showModal(title,text){
  modalVersion++;modalSource=null;
  if(typeof disposeViewer==="function")disposeViewer();
  $("#viewerToolbar").classList.add("hidden");$("#modalContent").classList.remove("viewer-complete");
  $("#modalTitle").textContent=title;$("#modalContent").textContent=(text||"").slice(0,51000);modalCopyText=text;
  $("#modalCopy").textContent="复制完整数据";$("#modal").classList.remove("hidden");
}
function closeModal(){if(typeof disposeViewer==="function")disposeViewer();modalVersion++;modalSource=null;modalCopyText="";$("#modalContent").textContent="";$("#modal").classList.add("hidden");}
async function copyModal(){
  const source=modalSource;
  if(!source)return copyText(modalCopyText);
  toast("正在准备完整数据…");
  const r=await callWorker(source.raw?"rawFull":"value",{rid:source.rid,path:source.path});
  await copyText(r.text);
}
async function exportData(){
  if(!selected || !tableState.path)throw Error("请先选择数组");
  return callWorker("table",{rid:selected.rid,path:tableState.path,query:tableState.query,sortKey:tableState.sortKey,dir:tableState.dir,all:true});
}
async function toMarkdown(){
  const {rows,columns:cols}=await exportData();
  if(!cols.length)return;
  const f=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\|/g,"\\|").replace(/[\r\n]/g," ");
  let out=`| ${cols.map(f).join(" | ")} |\n| ${cols.map(()=> "---").join(" | ")} |\n`;
  for(const r of rows)out+=`| ${cols.map(c=>f(typeof r[c]==="object"?stringifyJson(r[c]):r[c])).join(" | ")} |\n`;
  await copyText(out);
}
async function toCSV(){
  const {rows,columns:cols}=await exportData();
  const q=v=>{let text=String(v??"");if(typeof v==='string' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
  const out=[cols.map(q).join(","),...rows.map(r=>cols.map(c=>q(typeof r[c]==="object"?stringifyJson(r[c]):r[c])).join(","))].join("\n");
  const blob=new Blob(["\ufeff"+out],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="api-table.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

$$(".tab").forEach(t=>t.onclick=safe(async()=>{
  if(t.dataset.tab==="table" && !tableState.path){
    if(selected?.meta.type==="array")return openTable([]);
    $("#dataTable tbody").innerHTML='<tr><td class="loading-cell">请在“数据结构”或“数组路径”中选择数组</td></tr>';
  }
  activateTab(t.dataset.tab);
}));
$("#searchInput").oninput=renderList;
$("#clearBtn").onclick=safe(async()=>{captureGeneration++;requests=[];resetDetail();renderList();await callWorker("clear");});
$("#copyUrlBtn").onclick=()=>selected&&copyText(selected.url);
$("#copyRawBtn").onclick=()=>selected&&callWorker("rawFull",{rid:selected.rid}).then(r=>copyText(r.text));
$("#copyRaw2Btn").onclick=()=>$("#copyRawBtn").click();
$("#showFullRawBtn").onclick=showFullRaw;
$("#modalClose").onclick=closeModal;
$("#modal").onclick=e=>{if(e.target.id==="modal")closeModal();};
$("#modalCopy").onclick=copyModal;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
$("#arrayPathsBtn").onclick=async()=>{
  if(!selected)return;
  const version=selectionVersion;
  const result=await callWorker("arrays",{rid:selected.rid,path:[]});
  if(version!==selectionVersion)return;
  const host=document.createElement("div");
  for(const x of result.items){const b=document.createElement("button");b.className="btn";b.textContent=`${pathText(x.path)} Array(${x.length})`;b.onclick=safe(()=>{closeModal();return openTable(x.path);});host.appendChild(b);}
  showModal("数组路径",result.items.length?"点击路径可打开表格":"未找到数组");
  if(result.truncated)host.appendChild(document.createTextNode("已达到扫描上限，仅显示部分路径"));
  $("#modalContent").appendChild(host);
};
$("#expandRootBtn").onclick=()=>{const h=$("#tree>.node>.node-head");if(h)h.click();};
$("#tableSearch").oninput=e=>{tableState.query=e.target.value;tableState.page=1;tableState.hitIndex=0;tableVersion++;clearTimeout(window.st);window.st=setTimeout(()=>{window.st=null;renderTable(true);},180);};
function stepMatch(delta){
  if(!tableState.hitTotal)return;
  tableState.hitIndex=Math.max(0,Math.min(tableState.hitTotal-1,(tableState.hitIndex||0)+delta));
  return renderTable(true);
}
$("#prevMatch").onclick=safe(()=>stepMatch(-1));
$("#nextMatch").onclick=safe(()=>stepMatch(1));
$("#tableSearch").onkeydown=safe(e=>{if(e.key==="Enter"){e.preventDefault();if(window.st){clearTimeout(window.st);window.st=null;return renderTable(true);}return stepMatch(e.shiftKey?-1:1);}});
$("#copyMdBtn").onclick=toMarkdown;
$("#csvBtn").onclick=toCSV;

const seen=new WeakSet(), recent=new Map();
const requestKey=r=>r.startedDateTime?stringifyJson([r.startedDateTime,r.request?.url,r.request?.method,r.time,r.response?.status]):null;
function capture(req){
  if(!req?.request?.url || typeof req.getContent!=="function")return;
  if(seen.has(req))return;seen.add(req);
  const key=requestKey(req);if(key && recent.has(key))return;
  if(key){recent.set(key,true);if(recent.size>500)recent.delete(recent.keys().next().value);}
  const generation=captureGeneration;
  const ct=(req.response?.headers||[]).find(h=>h.name.toLowerCase()==="content-type")?.value?.toLowerCase()||req.response?.content?.mimeType?.toLowerCase()||"";
  if(/^(image|audio|video|font)\//.test(ct))return;
  if(req.response?.content?.size>20*1024*1024)return;
  req.getContent((body,encoding)=>{
    if(chrome.runtime.lastError || generation!==captureGeneration || !body)return;
    try {
      if(encoding==="base64") {const binary=atob(body);body=new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));}
      if(body.length>20*1024*1024)return;
      if(ct.includes("json") || /^[\s]*[\[{]/.test(body))void safe(addRequest)(req,body,generation);
    } catch(e){toast("响应解码失败："+e.message);}
  });
}
function startNetworkCapture(){
  chrome.devtools.network.onRequestFinished.addListener(capture);
  const bootstrapGeneration=captureGeneration;
  chrome.devtools.network.getHAR(har=>{if(chrome.runtime.lastError || bootstrapGeneration!==captureGeneration)return;for(const req of har.entries||[])capture(req);});
}
// Initialize capture after the companion scripts and saved preferences are ready.
document.addEventListener("DOMContentLoaded",startNetworkCapture,{once:true});
// All UI promises report errors instead of producing unhandled rejections.
for(const el of document.querySelectorAll("button"))if(el.onclick)el.onclick=safe(el.onclick);
