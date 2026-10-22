// Content previews are capped; full field names always define the minimum width.
let tableMeasureContext;
function measureTableText(value,header=false){
  const size=typeof Appearance!=='undefined'?Appearance.fontSize:13;
  const text=header?String(value??''):String(value??'').slice(0,240);
  if(tableMeasureContext===undefined){try{tableMeasureContext=document.createElement('canvas').getContext?.('2d')||null;}catch{tableMeasureContext=null;}}
  if(tableMeasureContext){tableMeasureContext.font=header?`650 ${size}px "Segoe UI","Microsoft YaHei",sans-serif`:`${size}px Consolas,Monaco,monospace`;return tableMeasureContext.measureText(text).width;}
  return [...text].reduce((width,c)=>width+(c.codePointAt(0)>255?size:size*.6),0);
}
function tableHeaderMinWidth(col){
  // Padding, sort arrow, gap and resize handle must not cover the field name.
  return Math.max(88,Math.ceil(measureTableText(col,true))+60);
}
function tableColumnWidths(columns,rows){
  return new Map(columns.map(col=>{
    const minimum=tableHeaderMinWidth(col);
    let width=minimum;
    for(const row of rows.slice(0,200)){
      const cell=row[col];if(!cell)continue;
      const extra=cell.expand?55:24;
      width=Math.max(width,measureTableText(cell.text)+extra+(cell.matched?56:0));
    }
    return [col,Math.max(minimum,Math.min(380,Math.ceil(width)))];
  }));
}
function tableColumnKind(col,rows){
  const names={number:'数字',string:'文本',boolean:'布尔',array:'数组',object:'对象',null:'空值',undefined:'缺失'};
  const kinds=new Set(rows.map(r=>r[col]?.type).filter(x=>x && x!=='undefined' && x!=='null'));
  return kinds.size>1?'混合类型':kinds.size?names[[...kinds][0]]:rows.length?'空值 / 缺失':'字段';
}
function createTableHeader(col,rows,width){
  const th=document.createElement('th');th.scope='col';th.style.width=width+'px';th.title=col+' · 点击排序';
  const sorted=tableState.sortKey===col;
  th.setAttribute('aria-sort',sorted?(tableState.dir===1?'ascending':'descending'):'none');
  if(sorted)th.classList.add('sorted-column');
  const top=document.createElement('div');top.className='th-main';
  const label=document.createElement('span');label.className='th-field';highlightText(label,col,tableState.query);top.appendChild(label);
  const arrow=document.createElement('span');arrow.className='th-sort';arrow.textContent=sorted?(tableState.dir===1?'↑':'↓'):'↕';top.appendChild(arrow);th.appendChild(top);
  const kind=document.createElement('span');kind.className='th-kind';kind.textContent=tableColumnKind(col,rows);th.appendChild(kind);
  const sort=()=>{if(tableState.sortKey===col)tableState.dir*=-1;else{tableState.sortKey=col;tableState.dir=1;}return renderTable();};
  th.tabIndex=0;th.onclick=safe(sort);th.onkeydown=safe(e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();return sort();}});
  bindColumnResize(th,col);return th;
}

// Keep widths stable across paging/sorting, with a bounded cache per response and array.
const tableWidthStates=new Map();
let currentTableWidths=new Map(),currentTableColumns=[],currentWidthKey=null;
function tableWidthKey(){return selected?.rid && tableState.path?JSON.stringify([selected.rid,tableState.path,typeof Appearance!=='undefined'?Appearance.fontSize:13]):null;}
function widthState(){
  const key=tableWidthKey();if(!key)return {auto:new Map(),manual:new Map()};
  if(!tableWidthStates.has(key)){tableWidthStates.set(key,{auto:new Map(),manual:new Map()});if(tableWidthStates.size>32)tableWidthStates.delete(tableWidthStates.keys().next().value);}
  return tableWidthStates.get(key);
}
function resolvedTableWidths(columns,rows){
  const measured=tableColumnWidths(columns,rows),saved=widthState();
  const widths=new Map();
  for(const col of columns){const auto=Math.max(saved.auto.get(col)||0,measured.get(col));saved.auto.set(col,auto);widths.set(col,Math.max(tableHeaderMinWidth(col),saved.manual.get(col)||auto));}
  currentTableColumns=[...columns];currentTableWidths=widths;currentWidthKey=tableWidthKey();return widths;
}
function applyColumnWidth(col,width){
  if(tableWidthKey()!==currentWidthKey)return;
  const index=currentTableColumns.indexOf(col);if(index<0)return;
  const minimum=tableHeaderMinWidth(col);
  width=Math.max(minimum,Math.min(Math.max(960,minimum),Math.round(width)));
  widthState().manual.set(col,width);currentTableWidths.set(col,width);
  const column=$('#tableColumns').children[index],head=$('#dataTable thead').children[0]?.children[index];
  if(column)column.style.width=width+'px';if(head){head.style.width=width+'px';const grip=head.children[head.children.length-1];if(grip?.className==='column-resizer')grip.setAttribute('aria-valuenow',String(width));}
  $('#dataTable').style.width=[...currentTableWidths.values()].reduce((sum,v)=>sum+v,0)+'px';
}
function bindColumnResize(th,col){
  const grip=document.createElement('span');grip.className='column-resizer';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.setAttribute('aria-label','调整 '+col+' 列宽');grip.title='拖动调整列宽，双击重新适配；方向键微调';
  let drag=null;
  const stop=e=>{e.stopPropagation();};
  grip.onclick=stop;
  grip.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();drag={id:e.pointerId,x:e.clientX,width:currentTableWidths.get(col),key:tableWidthKey()};grip.setPointerCapture(e.pointerId);document.body.classList.add('column-dragging');};
  grip.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;if(drag.key!==tableWidthKey()){finish();return;}applyColumnWidth(col,drag.width+e.clientX-drag.x);grip.setAttribute('aria-valuenow',String(currentTableWidths.get(col)));};
  function finish(){const id=drag?.id;drag=null;document.body.classList.remove('column-dragging');if(id!==undefined && grip.hasPointerCapture?.(id))grip.releasePointerCapture(id);}
  grip.onpointerup=finish;grip.onpointercancel=finish;grip.onlostpointercapture=finish;
  grip.ondblclick=safe(e=>{e.preventDefault();e.stopPropagation();widthState().manual.delete(col);widthState().auto.delete(col);return renderTable();});
  grip.onkeydown=e=>{e.stopPropagation();if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();applyColumnWidth(col,e.key==='Home'?88:e.key==='End'?380:(currentTableWidths.get(col)||88)+(e.key==='ArrowLeft'?-16:16));grip.setAttribute('aria-valuenow',String(currentTableWidths.get(col)));};
  grip.setAttribute('aria-valuemin',String(tableHeaderMinWidth(col)));grip.setAttribute('aria-valuemax',String(Math.max(960,tableHeaderMinWidth(col))));grip.setAttribute('aria-valuenow',String(currentTableWidths.get(col)||88));th.appendChild(grip);
}
async function refitTableColumns(){const state=widthState();state.manual.clear();state.auto.clear();return renderTable();}
$('#refitColumns').onclick=safe(refitTableColumns);

// A font change only resizes rendered columns; response parsing and DOM rows stay intact.
document.addEventListener('appearancechange',()=>{
  if(!currentTableColumns.length || !tableState.rows.length || !tableWidthKey())return;
  const widths=resolvedTableWidths(currentTableColumns,tableState.rows);
  for(const [index,col] of currentTableColumns.entries()){
    const width=widths.get(col),column=$('#tableColumns').children[index],header=$('#dataTable thead').children[0]?.children[index];
    if(column)column.style.width=width+'px';
    if(header){
      header.style.width=width+'px';const grip=header.querySelector('.column-resizer');
      if(grip){grip.setAttribute('aria-valuenow',String(width));grip.setAttribute('aria-valuemin',String(tableHeaderMinWidth(col)));grip.setAttribute('aria-valuemax',String(Math.max(960,tableHeaderMinWidth(col))));}
    }
  }
  $('#dataTable').style.width=[...widths.values()].reduce((sum,width)=>sum+width,0)+'px';
});
