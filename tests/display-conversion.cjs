const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const base=path.resolve(__dirname,'..');const context={TextEncoder,console,self:{},Map,WeakMap,Set};
context.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(path.join(base,n),'utf8'),context));
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(base,'worker.js'),'utf8'),context);
let id=0;function call(cmd,p={}){let response;context.self.postMessage=x=>response=x;context.self.onmessage({data:{id:++id,cmd,...p}});assert(response.ok,response.error);return response.result;}
const input={items:[{data:'{"a":[1,2]}',none:null,empty:'',array:[],object:{},created:1641281171000},{data:'[3,4]',none:'x'}]};
const rid=call('parse',{raw:JSON.stringify(input)}).rid;
let result=call('table',{rid,path:['items'],page:1,pageSize:1,preview:true});
assert.equal(result.rows[0].data.jsonString,'object');assert.equal(result.rows[0].none.type,'null');assert.equal(result.rows[0].array.text,'Array(0)');assert.equal(result.rows[0].object.text,'Object · 0 个字段');assert.equal(result.rows[0].created.text,'1641281171000');
result=call('table',{rid,path:['items'],page:2,pageSize:1,preview:true});assert.equal(result.rows[0].data.jsonString,'array');
result=call('table',{rid,path:['items'],page:1,pageSize:1,preview:true,query:'[3,4]'});assert.equal(result.rows[0].data.jsonString,'array');
assert.equal(call('valueText',{rid,path:['items',0,'data']}).text,input.items[0].data);assert.deepEqual(JSON.parse(call('rawFull',{rid}).text),input);
const panel=fs.readFileSync(path.join(base,'panel.js'),'utf8');const formatter=panel.slice(panel.indexOf('function formatTimestamp('),panel.indexOf('function timestampValue('));const formatContext={Date};vm.createContext(formatContext);vm.runInContext(formatter,formatContext);assert(formatContext.formatTimestamp('1641281171000','number'));assert.equal(formatContext.formatTimestamp('1641281171000','number'),formatContext.formatTimestamp('1641281171','number'));assert.equal(formatContext.formatTimestamp('123','number'),null);
console.log('Display conversion, pagination, search and original data checks passed');
