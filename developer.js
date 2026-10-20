// Tools for everyday API debugging. Request data stays within the extension.
const DEV_PREF_KEY='api-table-viewer.dev.v1';
let devPrefs={preserveLog:true,pageSize:100};
try{const p=JSON.parse(localStorage.getItem(DEV_PREF_KEY));if(p){devPrefs.preserveLog=p.preserveLog!==false;if([25,50,100,200].includes(p.pageSize))devPrefs.pageSize=p.pageSize;}}catch{}
let hiddenTableColumns=new Set();
function saveDevPrefs(){try{localStorage.setItem(DEV_PREF_KEY,stringifyJson(devPrefs));}catch{}}
function resetTablePreferences(){hiddenTableColumns=new Set();tableState.pageSize=devPrefs.pageSize;$('#columnMenu').open=false;$('#pageSizeSelect').value=String(devPrefs.pageSize);}
function snapshotRequest(req){
  const source=req.request||{},response=req.response||{},post=source.postData;
  const limit=256*1024,body=typeof post?.text==='string'?post.text:null;
  const params=(post?.params||[]).map(x=>({name:x.name,value:String(x.value??'').slice(0,limit),fileName:x.fileName}));
  return {started:req.startedDateTime||'',httpVersion:response.httpVersion||'',statusText:response.statusText||'',requestHeaders:source.headers||[],responseHeaders:response.headers||[],mimeType:response.content?.mimeType||'',bodySize:response.content?.size,post:post?{mimeType:post.mimeType||'',text:body===null?null:body.slice(0,limit),params,truncated:body!==null && body.length>limit || (post.params||[]).some(x=>String(x.value??'').length>limit)}:null};
}
function matchesRequestFilters(item,q=''){
  const method=$('#methodFilter').value,status=$('#statusFilter').value;
  return (!q || item.url.toLowerCase().includes(q)) && (!method || item.method===method) && (!status || (status==='0'?item.status<200||item.status>=600:Math.floor(item.status/100)===Number(status)));
}
function detailGroup(host,title,pairs){
  const group=document.createElement('section');group.className='request-section';
  const h=document.createElement('h3');h.textContent=title;group.appendChild(h);
  if(!pairs.length){const p=document.createElement('p');p.className='hint';p.textContent='无';group.appendChild(p);}
  for(const [key,value] of pairs){const row=document.createElement('div');row.className='detail-pair';const k=document.createElement('span');k.className='detail-key';k.textContent=key;const v=document.createElement('span');v.className='detail-value';v.textContent=String(value??'');row.appendChild(k);row.appendChild(v);group.appendChild(row);}host.appendChild(group);
}
function requestBodyJsonText(item){
  const post=item?.details?.post;
  if(!post || typeof post.text!=='string' || !post.text.trim())throw Error('此请求没有 JSON 请求体');
  if(post.truncated)throw Error('请求体未完整保留，请在 Network 中复制原始数据');
  const raw=post.text;try{JSON.parse(raw);}catch{throw Error('请求体不是有效 JSON');}
  // Format source tokens so large integer IDs and numeric literals stay exact.
  if(raw.length>50000)return raw;
  const tokens=raw.match(/"(?:\\.|[^"\\])*"|[^\s]/g)||[],out=[];let depth=0;
  const indent=()=> '  '.repeat(Math.min(depth,12));
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i];
    if(token==='{'||token==='['){out.push(token);depth++;if(tokens[i+1]!=='}'&&tokens[i+1]!==']')out.push('\n',indent());}
    else if(token==='}'||token===']'){depth--;if(tokens[i-1]!=='{'&&tokens[i-1]!=='[')out.push('\n',indent());out.push(token);}
    else if(token===',')out.push(',\n',indent());
    else if(token===':')out.push(': ');
    else out.push(token);
  }
  return out.join('');
}
function renderRequestDetails(item){
  const host=$('#requestDetails');host.textContent='';const d=item.details||{};
  detailGroup(host,'概览',[['URL',item.url],['Method',item.method],['Status',`${item.status} ${d.statusText||''}`],['耗时',`${item.time} ms`],['响应大小',`${(item.meta.bytes||0).toLocaleString()} bytes (UTF-8)`],['Content-Type',d.mimeType||'未知'],['开始时间',d.started||'未知']]);
  let query=[];try{query=[...new URL(item.url).searchParams.entries()];}catch{}
  detailGroup(host,'Query 参数',query);
  detailGroup(host,'Request Headers',(d.requestHeaders||[]).map(h=>[h.name,h.value]));
  detailGroup(host,'Response Headers',(d.responseHeaders||[]).map(h=>[h.name,h.value]));
  if(d.post){
    let body=d.post.text;try{body=requestBodyJsonText(item);}catch{}
    detailGroup(host,'请求体',[['类型',d.post.mimeType],...(body!==null?[['内容',body]]:d.post.params.map(x=>[x.name,x.fileName?'[文件] '+x.fileName:x.value])),...(d.post.truncated?[['提示','请求体详情仅保留前 256 Ki 字符；请在 Network 查看原始请求。']]:[])]);
  }
  $('#copyCurlBtn').disabled=!!d.post?.truncated;
  const copyBody=$('#copyRequestBodyBtn');
  try{requestBodyJsonText(item);copyBody.disabled=false;copyBody.title='复制请求体 JSON，保留原始数值';}
  catch(e){copyBody.disabled=true;copyBody.title=e.message;}
}
const shellQuote=text=>"'"+String(text).replace(/'/g,"'\\''")+"'";
function makeCurl(item){
  const d=item.details||{};if(d.post?.truncated)throw Error('请求体未完整保留，请使用 Chrome Network 的 Copy as cURL');
  const parts=['curl --compressed -X '+shellQuote(item.method)+' '+shellQuote(item.url)];
  for(const h of d.requestHeaders||[]){if(h.name.startsWith(':') || /^(host|content-length|connection|accept-encoding)$/i.test(h.name))continue;parts.push('-H '+shellQuote(h.name+': '+h.value));}
  if(d.post){
    if(d.post.text!==null)parts.push('--data-raw '+shellQuote(d.post.text));
    else if(d.post.params.length){
      if(d.post.params.some(x=>x.fileName) || /multipart/i.test(d.post.mimeType))throw Error('文件或 multipart 请求请使用 Network 的 Copy as cURL');
      parts.push('--data-raw '+shellQuote(new URLSearchParams(d.post.params.map(x=>[x.name,x.value])).toString()));
    }
  }
  return parts.join(' \\\n  ');
}
function downloadText(text,name,type='application/json;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadName(suffix='response'){
  let name='api';try{name=new URL(selected?.url||'').pathname.split('/').filter(Boolean).pop()||'api';}catch{}
  return name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,60)+'-'+suffix+'.json';
}
function updateColumnMenu(){
  const cols=tableState.columns,visible=cols.filter(c=>!hiddenTableColumns.has(c));$('#columnSummary').textContent=`显示列 ${visible.length} / ${cols.length}`;
  const host=$('#columnList');host.textContent='';
  for(const col of cols){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=!hiddenTableColumns.has(col);box.disabled=visible.length===1 && box.checked;box.onchange=safe(async()=>{box.checked?hiddenTableColumns.delete(col):hiddenTableColumns.add(col);await renderTable();});label.appendChild(box);label.appendChild(document.createTextNode(col));host.appendChild(label);}
}
// Supported paths: root.data[0]["a.b"], $.data[0], or an array of path segments.
function parseJsonPath(input){
  const text=String(input).trim();if(!text)throw Error('请输入 JSON 路径');
  if(text.startsWith('[')){
    try{const path=JSON.parse(text);if(Array.isArray(path) && path.every(x=>typeof x==='string'||Number.isSafeInteger(x)&&x>=0))return path;}catch{}
  }
  const root=/^(root|\$)(?=\.|\[|$)/.exec(text);if(!root)throw Error('路径须以 root 或 $ 开头');
  const out=[];let i=root[0].length;
  while(i<text.length){
    const rest=text.slice(i);let m;
    if((m=/^\.([A-Za-z_$][\w$]*)/.exec(rest))){out.push(m[1]);i+=m[0].length;continue;}
    if((m=/^\[(0|[1-9]\d*)\]/.exec(rest))){const n=Number(m[1]);if(!Number.isSafeInteger(n))throw Error('数组下标超出范围');out.push(n);i+=m[0].length;continue;}
    if((m=/^\[("(?:[^"\\]|\\.)*")\]/.exec(rest))){out.push(JSON.parse(m[1]));i+=m[0].length;continue;}
    throw Error('路径格式错误：特殊字段请使用 ["字段名"]');
  }
  return out;
}
async function jumpViewerPath(){
  const s=viewerState;if(!s)return;const version=s.version,path=parseJsonPath($('#viewerPathInput').value);
  // Validate before replacing the current view, so invalid paths leave it intact.
  await callWorker('children',{rid:s.rid,path});if(viewerState!==s || s.version!==version)return;
  return navigateViewer(path);
}
async function clearCapturedRequests(){tableWidthStates.clear();captureGeneration++;requests=[];recent.clear();resetDetail();renderList();await callWorker('clear');}
$('#methodFilter').onchange=renderList;$('#statusFilter').onchange=renderList;
$('#preserveLog').checked=devPrefs.preserveLog;
$('#preserveLog').onchange=()=>{devPrefs.preserveLog=$('#preserveLog').checked;saveDevPrefs();};
$('#copyCurlBtn').onclick=safe(()=>selected&&copyText(makeCurl(selected)));
$('#downloadResponseBtn').onclick=safe(async()=>{if(!selected)return;const name=downloadName(),r=await callWorker('rawFull',{rid:selected.rid});downloadText(r.text,name);});
$('#pageSizeSelect').value=String(devPrefs.pageSize);$('#pageSizeSelect').onchange=safe(async()=>{const size=Number($('#pageSizeSelect').value);if(![25,50,100,200].includes(size))return;devPrefs.pageSize=size;saveDevPrefs();tableState.pageSize=size;tableState.page=1;await renderTable(true);});
$('#showAllColumns').onclick=safe(()=>{hiddenTableColumns.clear();return renderTable();});
$('#resetColumns').onclick=safe(()=>{hiddenTableColumns=new Set(tableState.columns.slice(1));return renderTable();});
$('#exportTableJson').onclick=safe(async()=>{const name=downloadName('table'),r=await exportData();downloadText(stringifyJson(r.rows,null,2),name);});
$('#viewerDownload').onclick=safe(async()=>{if(!viewerState)return;const rid=viewerState.rid,path=viewerCurrentPath(),r=await callWorker('value',{rid,path});downloadText(r.text,'json-node.json');});
$('#viewerJump').onclick=safe(jumpViewerPath);$('#viewerPathInput').onkeydown=safe(e=>{if(e.key==='Enter'){e.preventDefault();return jumpViewerPath();}});
$('#clearBtn').onclick=safe(clearCapturedRequests);
chrome.devtools.network.onNavigated.addListener(safe(()=>{if(!devPrefs.preserveLog)return clearCapturedRequests();}));

$('#copyRequestBodyBtn').onclick=safe(()=>copyText(requestBodyJsonText(selected)));

// Search the selected response through the existing inspector, with no URL filtering.
let responseFieldSearchVersion=0;
async function searchResponseFields(){
  const requestVersion=++responseFieldSearchVersion;
  const item=selected,query=$('#treeSearch').value.trim();
  if(!item?.valid)return;
  if(!query){$('#treeSearch').focus();return;}
  await showValue([],'字段 / 值搜索');
  if(requestVersion!==responseFieldSearchVersion || selected!==item || viewerState?.rid!==item.rid)return;
  $('#viewerQuery').value=query;
  return searchViewer(true);
}
$('#treeSearchBtn').onclick=safe(searchResponseFields);
$('#treeSearch').onkeydown=safe(e=>{if(e.key==='Enter' && !e.isComposing){e.preventDefault();return searchResponseFields();}});
