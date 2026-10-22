// In-place editor. Only scalar patches cross the extension boundary; captured Worker data stays immutable.
const FieldMock=(()=>{
  let rules=[],origin='',version=0,loading=0,queue=Promise.resolve();
  const bindings=new WeakMap(),locations=new Map();
  const keyFor=item=>String(item.method).toUpperCase()+' '+normalize(item.url);
  function normalize(url){const parsed=new URL(url);parsed.hash='';return parsed.href;}
  const ruleFor=item=>rules.find(r=>r.method+' '+r.url===keyFor(item));
  async function request(action,changes){
    if(!chrome.runtime?.sendMessage)throw Error('请重新加载扩展并刷新网页后编辑');
    const result=await chrome.runtime.sendMessage({channel:'atv-fields',action,tabId:chrome.devtools.inspectedWindow.tabId,origin:action==='set'?origin:undefined,rules:changes});
    if(!result?.ok)throw Error(result?.error||'无法保存修改规则');return result;
  }
  async function load(){
    const current=++loading;
    try{const result=await request('get');if(current!==loading)return;origin=result.origin;rules=result.rules;version++;locations.clear();render();paintAll();}
    catch(error){if(current!==loading)return;origin='';rules=[];version++;locations.clear();render();paintAll();}
  }
  function mutate(change){
    const requestedOrigin=origin;
    const operation=queue.then(async()=>{
      if(origin!==requestedOrigin || !origin)throw Error('网页已切换，请重新编辑');
      const next=structuredClone(rules);change(next);
      const result=await request('set',next.filter(r=>r.patches.length));
      if(result.origin!==origin)return;
      rules=result.rules;version++;locations.clear();render();paintAll();
    });
    queue=operation.catch(()=>{});return operation;
  }
  function resolved(item){
    const rule=ruleFor(item);if(!rule)return Promise.resolve([]);
    const key=item.rid+':'+version;
    if(!locations.has(key))locations.set(key,callWorker('patchLocations',{rid:item.rid,patches:rule.patches}).then(result=>result.paths).catch(()=>[]));
    return locations.get(key);
  }
  async function paint(el){
    const binding=bindings.get(el);if(!binding || binding.editing)return;
    const current=version,paths=await resolved(binding.item);if(current!==version || binding.editing || !el.isConnected)return;
    const found=paths.find(entry=>JSON.stringify(entry.path)===JSON.stringify(binding.path));
    const patch=found?ruleFor(binding.item)?.patches[found.index]:null;
    binding.patch=patch;
    binding.mark.classList.toggle('field-mock-edited',!!patch);
    if(patch){
      binding.altered=true;const value=FieldPatchCore.parse(patch.value);el.textContent=typeof value==='string'?value:patch.value;
      el.title='已修改 · 原值：'+patch.old+' → '+patch.value+'\n双击继续编辑；顶部可恢复此项';
      el.setAttribute('aria-label',pathText(binding.path)+'，已修改，原值 '+patch.old+'，当前 '+patch.value);
    }else{
      if(binding.altered){el.innerHTML=binding.html;binding.altered=false;}el.title=binding.title+'\n双击修改 · F2 编辑';el.removeAttribute('aria-label');
    }
  }
  function paintAll(){for(const el of document.querySelectorAll('[data-field-mock]'))void paint(el);}
  function bind(el,item,path,type,mark=el){
    if(!el || !item || !['string','number','boolean','null'].includes(type))return;
    const binding={item,path:[...path],type,mark,text:el.textContent,html:el.innerHTML,title:el.title||'',editing:false,patch:null};bindings.set(el,binding);
    el.dataset.fieldMock='1';el.tabIndex=0;el.title=binding.title+'\n双击修改 · F2 编辑';
    const click=el.onclick;let timer;
    if(click)el.onclick=e=>{e.stopPropagation();clearTimeout(timer);timer=setTimeout(()=>{if(!binding.editing && selected===binding.item)void click(e);},260);};
    const start=safe(async e=>{e.preventDefault();e.stopPropagation();clearTimeout(timer);await edit(el);});
    el.ondblclick=start;
    const keydown=el.onkeydown;el.onkeydown=e=>{if(e.key==='F2'){void start(e);return;}keydown?.(e);};
    void paint(el);
  }
  async function edit(el){
    const binding=bindings.get(el);if(!binding || binding.editing)return;
    if(!origin)await load();if(!origin)throw Error('当前页面不支持编辑，请重新加载扩展并刷新网页');
    const currentOrigin=origin;
    const target=await callWorker('patchTarget',{rid:binding.item.rid,path:binding.path});
    if(origin!==currentOrigin || !el.isConnected)return;
    const existing=binding.patch;
    const patch=existing?structuredClone(existing):target;
    const current=FieldPatchCore.parse(patch.value);
    const input=document.createElement(typeof current==='string'&&current.includes('\n')?'textarea':'input');
    if(input.tagName==='INPUT')input.type='text';else input.rows=3;
    input.className='field-mock-input';input.value=typeof current==='string'?current:patch.value;
    input.setAttribute('aria-label','修改 '+pathText(binding.path)+'（'+binding.type+'）');
    input.title='Enter 提交 · Esc 取消（保持 '+binding.type+' 类型）';
    binding.editing=true;binding.altered=true;el.textContent='';el.appendChild(input);input.focus();input.select();let finished=false,saving=false;
    const cancel=()=>{finished=true;binding.editing=false;void paint(el);};
    async function commit(){
      if(finished || saving)return;
      let value;
      try{
        value=patch.type==='string'?JSON.stringify(input.value):FieldPatchCore.stringify(FieldPatchCore.parse(input.value));
        FieldPatchCore.validate({...patch,value});
      }catch(error){input.setAttribute('aria-invalid','true');input.title=error.message+' · Esc 取消';toast(error.message);input.focus();return;}
      saving=true;input.disabled=true;
      try{
        if(origin!==currentOrigin)throw Error('网页已切换，修改未保存');
        await mutate(next=>{
          const id=keyFor(binding.item);let rule=next.find(r=>r.method+' '+r.url===id);
          if(!rule){rule={method:binding.item.method.toUpperCase(),url:normalize(binding.item.url),patches:[]};next.push(rule);}
          const identity=FieldPatchCore.identity(patch),index=rule.patches.findIndex(p=>FieldPatchCore.identity(p)===identity);
          const original=index>=0?rule.patches[index].old:patch.old;
          if(value===original){if(index>=0)rule.patches.splice(index,1);}
          else{const updated={...patch,old:original,value};if(index>=0)rule.patches[index]=updated;else rule.patches.push(updated);}
        });
        finished=true;binding.editing=false;void paint(el);toast('已保存修改，网页下次请求自动应用；刷新后保留');
      }catch(error){input.disabled=false;toast(error.message);input.focus();}
      finally{saving=false;}
    }
    input.onclick=e=>e.stopPropagation();input.ondblclick=e=>e.stopPropagation();
    input.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();cancel();}else if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();void commit();}};
    input.onblur=()=>{void commit();};
  }
  function restore(rule,patch){return mutate(next=>{const target=next.find(r=>r.method===rule.method && r.url===rule.url);if(target)target.patches=target.patches.filter(p=>FieldPatchCore.identity(p)!==FieldPatchCore.identity(patch));});}
  async function locate(rule,patch){
    const item=requests.find(r=>r.valid && keyFor(r)===rule.method+' '+rule.url);
    if(!item)throw Error('当前捕获列表没有该接口，请在网页重新请求');
    await selectRequest(item);
    const paths=await resolved(item),index=ruleFor(item)?.patches.findIndex(p=>FieldPatchCore.identity(p)===FieldPatchCore.identity(patch));
    const found=paths.find(entry=>entry.index===index);if(!found)throw Error('该字段已不存在或数组标识已改变');
    await openJsonViewer(item.rid,found.path,'已修改字段 · '+pathText(found.path));
  }
  function render(){
    const count=rules.reduce((sum,r)=>sum+r.patches.length,0);
    $('#fieldMockBar').classList.toggle('hidden',!count);
    $('#fieldMockSummary').textContent=`编辑模式 · ${rules.length} 个接口 · ${count} 处修改 · 刷新后保留`;
    const list=$('#fieldMockChangeList');list.textContent='';
    for(const rule of rules)for(const patch of rule.patches){
      const row=document.createElement('div');row.className='field-mock-change';
      const text=document.createElement('span');text.textContent=rule.method+' '+rule.url+' · '+pathText(patch.path)+' · '+patch.old+' → '+patch.value;row.appendChild(text);
      for(const [label,action] of [['定位',()=>locate(rule,patch)],['恢复此项',()=>restore(rule,patch)]]){const button=document.createElement('button');button.className='btn ghost';button.textContent=label;button.onclick=safe(action);row.appendChild(button);}
      list.appendChild(row);
    }
  }
  $('#fieldMockExit').onclick=safe(async()=>{await mutate(next=>{next.length=0;});toast('已退出编辑模式，后续请求返回真实响应；重新查询网页以恢复显示');});
  chrome.devtools.network.onNavigated.addListener(()=>{void load();});
  void load();
  return {bind,load,edit};
})();
