// Shared scalar patch engine. Numeric codec is kept identical to json-codec.js.
const FieldPatchCore=(()=>{
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

  const scalar=v=>v===null || ['string','number','boolean','bigint'].includes(typeof v);
  const kind=v=>typeof v==='bigint'?'number':v===null?'null':typeof v;
  const token=v=>stringifyJson(v);
  function target(root,path){
    if(!Array.isArray(path) || path.length>64)throw Error('字段路径过深');
    let value=root;const anchors=[];
    for(let depth=0;depth<path.length;depth++){
      const key=path[depth];
      if(value===null || typeof value!=='object' || !Object.hasOwn(value,key))throw Error('字段已不存在');
      if(Array.isArray(value)){
        if(!Number.isInteger(key) || key<0 || value.length>100000)throw Error('数组定位超出支持范围');
        const row=value[key];
        if(row && typeof row==='object' && !Array.isArray(row)){
          const keys=Object.keys(row).filter(k=>/^(id|uuid|key)$/i.test(k) || /id$/i.test(k));
          const identity=keys.find(k=>scalar(row[k]) && row[k]!==null && value.filter(r=>r && Object.hasOwn(r,k) && token(r[k])===token(row[k])).length===1);
          if(!identity){
            const snapshot=token(row);
            if(snapshot.length>65536)throw Error('无唯一标识的数组行超过 64 KiB，无法安全编辑');
            if(value.filter(r=>token(r)===snapshot).length!==1)throw Error('数组中存在内容相同的行，无法安全定位修改');
            anchors.push({depth,key:null,value:snapshot,snapshot:true});
          }
          if(identity && depth===path.length-2 && path.at(-1)===identity)throw Error('暂不支持修改用于定位数组行的标识字段');
          if(identity)anchors.push({depth,key:identity,value:token(row[identity])});
        }else if(scalar(row))anchors.push({depth,key:null,value:token(row)});
        else throw Error('嵌套数组缺少稳定标识，暂不支持编辑');
      }
      value=value[key];
    }
    if(!scalar(value))throw Error('请双击字符串、数字、布尔值或 null');
    if(token(value).length>65536)throw Error('单个字段超过 64 KiB，暂不支持编辑');
    return {path:[...path],anchors,type:kind(value),old:token(value),value:token(value)};
  }
  function validate(patch){
    if(!patch || !Array.isArray(patch.path) || patch.path.length>64 || !patch.path.every(k=>typeof k==='string' || Number.isInteger(k)&&k>=0))throw Error('字段路径无效');
    if(!Array.isArray(patch.anchors) || patch.anchors.length>64)throw Error('数组定位无效');
    for(const a of patch.anchors){
      if(!Number.isInteger(a.depth) || a.depth<0 || a.depth>=patch.path.length || a.key!==null && typeof a.key!=='string' || typeof a.value!=='string' || a.value.length>65536 || !(a.snapshot===true?a.key===null && parseJsonExact(a.value)!==null && typeof parseJsonExact(a.value)==='object' && !Array.isArray(parseJsonExact(a.value)):scalar(parseJsonExact(a.value))))throw Error('数组标识无效');
    }
    if(typeof patch.value!=='string' || patch.value.length>65536 || typeof patch.old!=='string' || patch.old.length>65536)throw Error('字段内容过大');
    const value=parseJsonExact(patch.value),old=parseJsonExact(patch.old);
    if(!scalar(value) || !scalar(old) || kind(old)!==patch.type || kind(value)!==patch.type)throw Error('修改必须保持原字段类型');
    return patch;
  }
  function resolve(root,patch){
    let value=root;const path=[];
    for(let depth=0;depth<patch.path.length;depth++){
      let key=patch.path[depth];const anchor=patch.anchors.find(a=>a.depth===depth);
      if(Array.isArray(value)){
        if(!anchor || value.length>100000)throw Error('数组缺少定位信息');
        if(anchor.snapshot===true){
          const original=parseJsonExact(anchor.value),updated=parseJsonExact(anchor.value);
          let parent=updated;
          for(const part of patch.path.slice(depth+1,-1)){if(parent===null || typeof parent!=='object' || !Object.hasOwn(parent,part))throw Error('数组行内容已改变');parent=parent[part];}
          Object.defineProperty(parent,patch.path.at(-1),{value:parseJsonExact(patch.value),writable:true,enumerable:true,configurable:true});
          const before=token(original),after=token(updated),indices=[];
          for(let i=0;i<value.length;i++){const text=token(value[i]);if(text===before || text===after)indices.push(i);}
          if(indices.length!==1)throw Error('无标识数组行已改变或重复，已跳过修改');
          key=indices[0];
        }else if(anchor.key===null){if(token(value[key])!==anchor.value && token(value[key])!==patch.value)throw Error('数组元素已改变');}
        else{
          const indices=[];
          for(let i=0;i<value.length;i++)if(value[i] && Object.hasOwn(value[i],anchor.key) && token(value[i][anchor.key])===anchor.value)indices.push(i);
          if(indices.length!==1)throw Error('数组行标识不存在或重复');
          key=indices[0];
        }
      }
      if(value===null || typeof value!=='object' || !Object.hasOwn(value,key))throw Error('字段路径已失效');
      path.push(key);value=value[key];
    }
    if(!scalar(value) || kind(value)!==patch.type)throw Error('字段类型已改变');
    return path;
  }
  function apply(root,patches){
    const warnings=[];let applied=0;
    const targets=patches.map(patch=>{try{validate(patch);return {patch,path:resolve(root,patch)};}catch(error){warnings.push(error.message);return null;}});
    for(const target of targets){
      if(!target)continue;const {patch,path}=target;
      try{
        const next=parseJsonExact(patch.value);
        if(!path.length)root=next;
        else{let parent=root;for(const key of path.slice(0,-1))parent=parent[key];Object.defineProperty(parent,path.at(-1),{value:next,writable:true,enumerable:true,configurable:true});}
        applied++;
      }catch(error){warnings.push(error.message);}
    }
    return {value:root,applied,warnings};
  }
  function identity(patch){return JSON.stringify([patch.path.map((k,i)=>patch.anchors.some(a=>a.depth===i && (a.key!==null || a.snapshot===true))?'*':k),patch.anchors]);}
  return {parse:parseJsonExact,stringify:stringifyJson,target,validate,resolve,apply,identity};
})();
