'use strict';
function showOrders(raw,status,source){
  document.querySelector('#error').textContent='';
  document.querySelector('#source').textContent=`${source} · HTTP ${status}`;
  document.querySelector('#response').textContent=raw;
  if(status<200 || status>=300)throw Error(`接口返回 HTTP ${status}`);
  const result=JSON.parse(raw),rows=result.data?.records;
  if(!Array.isArray(rows))throw Error('响应中缺少 data.records 数组');
  const host=document.querySelector('#orders');host.textContent='';
  for(const row of rows){const tr=document.createElement('tr');for(const key of ['orderId','customerName','status','amount']){const td=document.createElement('td');td.textContent=String(row[key]??'—');tr.appendChild(td);}host.appendChild(tr);}
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='暂无订单';tr.appendChild(td);host.appendChild(tr);}
}
async function fetchOrders(){
  try{const response=await fetch('/api/mock-orders');showOrders(await response.text(),response.status,response.headers.get('x-api-table-viewer-mock')?'Fetch · 模拟响应':'Fetch · 真实后端');}
  catch(error){document.querySelector('#error').textContent=error.message;}
}
function xhrOrders(){
  const xhr=new XMLHttpRequest();xhr.open('GET','/api/mock-orders');
  xhr.onload=()=>{try{showOrders(xhr.responseText,xhr.status,xhr.getResponseHeader('x-api-table-viewer-mock')?'XHR · 模拟响应':'XHR · 真实后端');}catch(error){document.querySelector('#error').textContent=error.message;}};
  xhr.onerror=()=>{document.querySelector('#error').textContent='XHR 请求失败';};xhr.send();return xhr;
}
document.querySelector('#fetchOrders').addEventListener('click',fetchOrders);
document.querySelector('#xhrOrders').addEventListener('click',xhrOrders);
// Load on startup to verify persistent field patches after ordinary refresh.
void fetchOrders();
