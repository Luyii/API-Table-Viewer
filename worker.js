importScripts('json-codec.js');
const records = new Map();
let seq = 0, retainedBytes = 0;
const MAX_BYTES = 20 * 1024 * 1024, CACHE_BYTES = 80 * 1024 * 1024, MAX_RECORDS = 150;
const typeOf = v => typeof v === 'bigint' ? 'number' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const label = v => Array.isArray(v) ? `Array(${v.length})` : v && typeof v === 'object' ? `Object · ${Object.keys(v).length} 个字段` : String(v).slice(0,160);
function getAt(v,path=[]) { for(const key of path) { if(v == null || !Object.hasOwn(v,key)) throw Error('路径不存在'); v=v[key]; } return v; }
// Bounded traversal: never stringify the entire subtree before truncation.
function valuePreview(value) {
  const LIMIT=50000, NODES=1000, DEPTH=8;
  const parts=[];let used=0,nodes=0,truncated=false;
  function emit(text){const room=LIMIT-used;if(text.length>room){parts.push(text.slice(0,room));used=LIMIT;truncated=true;}else{parts.push(text);used+=text.length;}}
  function visit(v,depth){
    if(used>=LIMIT || ++nodes>NODES){truncated=true;return;}
    if(typeof v==='string'){const room=Math.max(0,LIMIT-used);if(v.length>room){emit(stringifyJson(v.slice(0,room)));truncated=true;}else emit(stringifyJson(v));return;}
    if(!v || typeof v!=='object'){emit(stringifyJson(v)??'null');return;}
    if(depth>=DEPTH){emit(Array.isArray(v)?'"[数组已折叠]"':'"[对象已折叠]"');truncated=true;return;}
    const array=Array.isArray(v);emit(array?'[':'{');let count=0;
    for(const k in v){
      if(!Object.hasOwn(v,k))continue;
      if(used>=LIMIT || nodes>=NODES){truncated=true;break;}
      if(count++)emit(',');emit('\n'+'  '.repeat(depth+1));
      if(!array){if(k.length>1000)truncated=true;emit(stringifyJson(k.slice(0,1000))+': ');}
      visit(v[k],depth+1);
    }
    emit('\n'+'  '.repeat(depth)+(array?']':'}'));
  }
  visit(value,0);
  return {text:parts.join(''),truncated};
}
function viewerDocument(value,path=[]){
  const LIMIT_NODES=5000,LIMIT_CHARS=500000,LIMIT_DEPTH=32;
  let nodes=0,chars=0;
  try{
    function visit(v,current,depth){
      if(++nodes>LIMIT_NODES)throw Error('节点超过 5,000 个');
      if(depth>LIMIT_DEPTH)throw Error('嵌套超过 32 层');
      const type=typeOf(v),complex=type==='array'||type==='object';
      if(typeof v==='string' && v.length>LIMIT_CHARS)throw Error('内容超过 500,000 字符');
      const text=complex?label(v):typeof v==='string'?stringifyJson(v):String(v);
      chars+=text.length+String(current.at(-1)??'root').length;
      if(chars>LIMIT_CHARS)throw Error('内容超过 500,000 字符');
      const meta={type,label:text,path:current};
      if(complex){
        if(Array.isArray(v) && v.length>LIMIT_NODES-nodes)throw Error('节点超过 5,000 个');
        const keys=Object.keys(v);if(keys.length>LIMIT_NODES-nodes)throw Error('节点超过 5,000 个');
        meta.totalChildren=keys.length;meta.fullChildren=keys.map(k=>visit(v[k],current.concat(Array.isArray(v)?Number(k):k),depth+1));
      }
      return meta;
    }
    const meta=visit(value,path,0);
    return {complete:true,meta,nodes,chars,text:value===null || typeof value!=='object'?(typeof value==='string'?value:stringifyJson(value)):null};
  }catch(e){return {complete:false,reason:e.message,nodes,chars};}
}
function viewerLabel(v,query=''){
  if(typeof v!=='string' || !query.trim())return label(v);
  const q=query.trim().toLowerCase(),hit=v.toLowerCase().indexOf(q);
  if(hit<0)return label(v);
  const start=Math.max(0,hit-8),end=Math.min(v.length,Math.max(start+160,hit+Math.min(q.length,160)));
  return (start?'…':'')+v.slice(start,end)+(end<v.length?'…':'');
}
function children(v,path=[],offset=0,focusKey,query="") {
  const keys=v && typeof v==='object' ? Object.keys(v) : [];
  if(focusKey!==undefined){const index=keys.indexOf(String(focusKey));if(index<0)throw Error('定位字段不存在');offset=Math.floor(index/200)*200;}
  return {type:typeOf(v),label:label(v),totalChildren:keys.length,offset,
    children:keys.slice(offset,offset+200).map(k=>({key:Array.isArray(v)?Number(k):k,path:path.concat(Array.isArray(v)?Number(k):k),type:typeOf(v[k]),label:viewerLabel(v[k],query),preview:label(v[k])}))};
}
function arrays(v,path=[]) {
  const out=[],stack=[{v,path}], LIMIT=100000;let visited=0;
  while(stack.length && out.length<200 && visited<LIMIT) {
    const frame=stack[stack.length-1];
    if(!frame.keys){
      visited++;
      if(Array.isArray(frame.v))out.push({path:frame.path,length:frame.v.length});
      if(!frame.v || typeof frame.v!=='object'){stack.pop();continue;}
      frame.keys=Object.keys(frame.v);frame.index=0;
    }
    if(frame.index>=frame.keys.length){stack.pop();continue;}
    const k=frame.keys[frame.index++];
    stack.push({v:frame.v[k],path:frame.path.concat(Array.isArray(frame.v)?Number(k):k)});
  }
  return {items:out,truncated:stack.length>0};
}
const schemas = new WeakMap();
function table(v,{page=1,pageSize=100,query='',sortKey=null,dir=1,all=false,preview=false,path=[],focusIndex=0,navigate=false}={}) {
  if(!Array.isArray(v)) throw Error('请先从数据结构选择数组');
  let schema=schemas.get(v);
  if(!schema){
    const objectRows=v.every(r=>r!==null && typeof r==='object' && !Array.isArray(r));
    const set=new Set();if(objectRows)for(const r of v)for(const k of Object.keys(r))set.add(k);
    const indices=new WeakMap();if(objectRows)v.forEach((r,i)=>indices.set(r,i));
    schema={objectRows,indices,columns:objectRows?[...set]:['index','value']};schemas.set(v,schema);
  }
  const {objectRows,columns}=schema;
  let rows=objectRows?v:v.map((r,i)=>({index:i,value:r}));
  const q=query.trim().toLowerCase(); if(q) rows=rows.filter(r=>stringifyJson(r).toLowerCase().includes(q));
  if(sortKey!==null && columns.includes(sortKey)) rows=[...rows].sort((a,b)=>{
    const av=Object.hasOwn(a,sortKey)?a[sortKey]:undefined,bv=Object.hasOwn(b,sortKey)?b[sortKey]:undefined;
    const rank=x=>x===undefined?0:x===null?1:typeof x==='boolean'?2:typeof x==='number'||typeof x==='bigint'?3:typeof x==='string'?4:5;
    let c=rank(av)-rank(bv);
    if(!c && av!==bv) { if(typeof av==='number'||typeof av==='bigint'||typeof av==='boolean')c=av>bv?1:av<bv?-1:0; else c=String(typeof av==='object'?stringifyJson(av):av??'').localeCompare(String(typeof bv==='object'?stringifyJson(bv):bv??'')); }
    return c*(dir===-1?-1:1);
  });
  const total=rows.length; pageSize=Math.max(1,Math.min(500,Number(pageSize)||100));page=Math.max(1,Math.min(Math.ceil(total/pageSize)||1,Number(page)||1));
  let focus=null,hitTotal=0;
  const desired=Math.max(0,Number(focusIndex)||0);
  if(q && preview){
    for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
      const row=rows[rowIndex];
      for(const column of columns){
        if(!Object.hasOwn(row,column))continue;
        const value=row[column],text=typeof value==='string'?value:stringifyJson(value)??'';
        if(!column.toLowerCase().includes(q) && !text.toLowerCase().includes(q))continue;
        const hit={index:hitTotal++,rowIndex,column};
        if(navigate){if(hit.index<=desired)focus=hit;}
        else if(!focus && rowIndex>=(page-1)*pageSize && rowIndex<page*pageSize)focus=hit;
      }
    }
    if(navigate && focus)page=Math.floor(focus.rowIndex/pageSize)+1;
  }
  return {ok:true,columns,total,allTotal:v.length,page,pageSize,focus,hitTotal,rows:(all?rows:rows.slice((page-1)*pageSize,page*pageSize)).map(r=>Object.fromEntries(columns.map(c=>{
    const value=Object.hasOwn(r,c)?r[c]:undefined;
    if(!preview)return [c,value];
    const index=objectRows?schema.indices.get(r):r.index;
    const cellPath=value===undefined?null:objectRows?path.concat(index,c):c==='value'?path.concat(index):null;
    let text=value===undefined?'':label(value).slice(0,160);
    const complex=value!==null && typeof value==='object';
    const matched=!!q && complex && stringifyJson(value).toLowerCase().includes(q);
    if(q && typeof value==='string'){
      const hit=value.toLowerCase().indexOf(q);
      if(hit>=0){const start=Math.max(0,hit-8),end=Math.min(value.length,Math.max(start+160,hit+Math.min(q.length,160)));text=(start?'…':'')+value.slice(start,end)+(end<value.length?'…':'');}
    }
    return [c,{type:typeOf(value),text,path:cellPath,matched,expand:complex || typeof value==='string' && (value.length>24 || /[\r\n]/.test(value))}];
  })))};

}
function* walkNodes(value,path){
  const stack=[{value,path}];
  while(stack.length){
    const f=stack[stack.length-1];
    if(!f.entered){f.entered=true;yield {value:f.value,path:f.path};
      if(!f.value || typeof f.value!=='object'){stack.pop();continue;}
      f.keys=Object.keys(f.value);f.index=0;
    }
    if(f.index>=f.keys.length){stack.pop();continue;}
    const key=f.keys[f.index++];stack.push({value:f.value[key],path:f.path.concat(Array.isArray(f.value)?Number(key):key)});
  }
}
let expansionSeq=0;
function viewerExpansion(rec,data){
  if(data.cmd==='viewerExpandStart'){
    const path=data.path||[];rec.expansion={token:String(++expansionSeq),iterator:walkNodes(getAt(rec.obj,path),path),rows:[],done:false};
    return {token:rec.expansion.token};
  }
  if(data.cmd==='viewerExpandRelease'){if(rec.expansion?.token===data.token)rec.expansion=null;return true;}
  const state=rec.expansion;if(!state || state.token!==data.token)throw Error('展开任务已结束');
  if(data.cmd==='viewerExpandStep'){
    for(let n=0;n<1000&&!state.done;n++){const next=state.iterator.next();if(next.done){state.done=true;state.iterator=null;}else state.rows.push(next.value);}
    return {total:state.rows.length,done:state.done};
  }
  const start=Math.max(0,Number(data.start)||0),end=Math.min(state.rows.length,start+Math.min(200,Number(data.limit)||80));
  return {start,total:state.rows.length,rows:state.rows.slice(start,end).map(({value,path})=>({path,type:typeOf(value),label:viewerLabel(value,data.query||'')}))};
}
function viewerSearch(rec,data){
  const q=String(data.query||'').trim().toLowerCase(),path=data.path||[],key=stringifyJson([path,q]);
  if(!q){rec.viewerSearch=null;return {items:[],done:true,scanned:0};}
  if(data.restart || rec.viewerSearch?.key!==key)rec.viewerSearch={key,iterator:walkNodes(getAt(rec.obj,path),path),scanned:0};
  const search=rec.viewerSearch,items=[];let done=false;
  for(let n=0;n<10000 && items.length<50;n++){
    const step=search.iterator.next();if(step.done){done=true;break;}search.scanned++;
    const {value,path}=step.value;
    const key=String(path.at(-1)??'root');
    if(key.toLowerCase().includes(q) || (value===null || typeof value!=='object') && String(value).toLowerCase().includes(q))items.push({path,type:typeOf(value),label:label(value)});
  }
  return {items,done,scanned:search.scanned};
}
function remove(rid) {const r=records.get(rid);if(r)retainedBytes-=r.bytes;records.delete(rid);}
self.onmessage=e=>{
  const {id,cmd}=e.data;
  try {
    let result;
    if(cmd==='parse') {
      const raw=e.data.raw;if(typeof raw!=='string')throw Error('响应不是文本');
      const bytes=new TextEncoder().encode(raw).length;if(bytes>MAX_BYTES)throw Error('响应超过 20 MiB，已跳过');
      const obj=parseJsonExact(raw),rid=String(++seq),evicted=[];
      while(records.size>=MAX_RECORDS || retainedBytes+bytes>CACHE_BYTES) {const first=records.keys().next().value;remove(first);evicted.push(first);}
      records.set(rid,{obj,raw,bytes});retainedBytes+=bytes;
      result={rid,type:typeOf(obj),label:label(obj),evicted,bytes};
    } else if(cmd==='clear') {records.clear();retainedBytes=0;result=true;}
    else if(cmd==='release') {remove(e.data.rid);result=true;}
    else {
      const rec=records.get(e.data.rid);if(!rec)throw Error('数据已释放，请刷新页面重新捕获');
      if(cmd==='children')result=children(getAt(rec.obj,e.data.path),e.data.path,e.data.offset||0,e.data.focusKey,e.data.query);
      else if(cmd==='arrays')result=arrays(getAt(rec.obj,e.data.path),e.data.path);
      else if(cmd==='table')result=table(getAt(rec.obj,e.data.path),e.data);
      else if(cmd.startsWith('viewerExpand'))result=viewerExpansion(rec,e.data);
      else if(cmd==='viewerDocument')result=viewerDocument(getAt(rec.obj,e.data.path),e.data.path||[]);
      else if(cmd==='viewerSearch')result=viewerSearch(rec,e.data);
      else if(cmd==='viewerSearchRelease'){rec.viewerSearch=null;result=true;}
      else if(cmd==='valuePage'){
        const value=getAt(rec.obj,e.data.path);
        if(value!==null && typeof value==='object')throw Error('对象和数组请使用树形模式');
        const text=typeof value==='string'?value:stringifyJson(value),size=10000;
        const requested=Number(e.data.page)||0,query=String(e.data.query||'').trim().toLowerCase();
        const hit=requested<0 && query?text.toLowerCase().indexOf(query):-1;
        const page=Math.max(0,Math.min(Math.ceil(text.length/size)-1,hit>=0?Math.floor(hit/size):requested));
        result={text:text.slice(page*size,(page+1)*size),page,pages:Math.max(1,Math.ceil(text.length/size)),length:text.length};
      }
      else if(cmd==='valuePreview')result=valuePreview(getAt(rec.obj,e.data.path));
      else if(cmd==='value')result={text:stringifyJson(getAt(rec.obj,e.data.path),null,2)};
      else if(cmd==='rawFull')result={text:rec.raw};
      else if(cmd==='rawPreview') {const max=e.data.max||50000;result={text:rec.raw.slice(0,max),length:rec.raw.length,truncated:rec.raw.length>max};}
      else throw Error('未知命令');
    }
    self.postMessage({id,ok:true,result});
  } catch(err) {self.postMessage({id,ok:false,error:err.message});}
};
