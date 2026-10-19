// Preserve integer literals outside Number's safe range without changing JSON strings.
function parseJsonExact(text){
  text=String(text).replace(/^\uFEFF/,'');
  if(!/-?\d{16,}/.test(text))return JSON.parse(text);
  let prefix='__API_TABLE_INTEGER__';while(text.includes(prefix))prefix+='_';
  let integers,rewritten,collision;
  do{
    integers=[];collision=false;
    rewritten=text.replace(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,token=>{
      if(token[0]==='"'){
        if((token.includes(prefix)||token.includes('\\u')) && JSON.parse(token).startsWith(prefix))collision=true;
        return token;
      }
      if(/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))){const index=integers.push(BigInt(token))-1;return JSON.stringify(prefix+index);}
      return token;
    });
    if(collision)prefix+='_';
  }while(collision);
  let root=JSON.parse(rewritten);
  const decode=v=>typeof v==='string' && v.startsWith(prefix) && /^\d+$/.test(v.slice(prefix.length))?integers[Number(v.slice(prefix.length))]:v;
  root=decode(root);const stack=root&&typeof root==='object'?[root]:[];
  while(stack.length){const value=stack.pop();for(const key of Object.keys(value)){value[key]=decode(value[key]);if(value[key]&&typeof value[key]==='object')stack.push(value[key]);}}
  return root;
}
function stringifyJson(value,replacer=null,space){
  // Native raw JSON emits large integers as number literals, not quoted text.
  if(typeof JSON.rawJSON==='function')return JSON.stringify(value,(key,v)=>{if(typeof replacer==='function')v=replacer(key,v);return typeof v==='bigint'?JSON.rawJSON(String(v)):v;},space);
  let prefix='__API_TABLE_BIGINT__';
  for(;;){
    const values=[];let collision=false;
    const text=JSON.stringify(value,(key,v)=>{
      if(typeof replacer==='function')v=replacer(key,v);
      if(key.startsWith(prefix) || typeof v==='string' && v.startsWith(prefix))collision=true;
      if(typeof v==='bigint')return prefix+(values.push(String(v))-1);
      return v;
    },space);
    if(collision){prefix+='_';continue;}
    return text?.replace(new RegExp('"'+prefix+'(\\d+)"','g'),(_,index)=>values[Number(index)]);
  }
}
