// Synthetic fixtures only. This file is served by the preview server, never the extension.
const previewFieldRules=[];
window.chrome={runtime:{sendMessage:async message=>{
  if(message.action==='set')previewFieldRules.splice(0,previewFieldRules.length,...message.rules);
  return {ok:true,origin:'https://demo.local',rules:structuredClone(previewFieldRules)};
}},devtools:{inspectedWindow:{tabId:1},network:{onRequestFinished:{addListener(){}},onNavigated:{addListener(){}},getHAR(callback){
  const samples=[
    ['/api/orders?page=1&pageSize=20','GET',84,'{"code":200,"message":"success","data":{"total":2,"records":[{"orderId":9007199254740993,"customerName":"林小满","status":"paid","amount":128.50,"createdAt":"2026-10-22 10:30:00","remark":"标准订单"},{"orderId":9007199254740994,"customerName":"陈一诺","status":"pending","amount":299.00,"createdAt":"2026-10-22 11:15:00","remark":"等待付款"}]}}'],
    ['/api/users/profile','GET',32,'{"code":200,"data":{"id":1001,"name":"示例用户","role":"developer","email":"demo@example.com","active":true}}'],
    ['/api/dashboard/summary','POST',56,'{"code":200,"data":{"orders":128,"revenue":25680.50,"conversionRate":0.125,"trend":[12,18,15,26,31]}}']
  ];
  callback({entries:samples.map(([url,method,time,text])=>({request:{url:'https://demo.local'+url,method,headers:[]},response:{status:200,statusText:'OK',headers:[{name:'content-type',value:'application/json'}],content:{mimeType:'application/json',size:new TextEncoder().encode(text).byteLength}},time,getContent:done=>done(text,'')}))});
}}}};
