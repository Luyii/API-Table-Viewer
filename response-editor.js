// Response drafts are isolated from captured data. Mock rules are enabled explicitly.
const ResponseEditor=(()=>{
  const LIMIT=1024*1024, drafts=new WeakMap();
  let state=null, generation=0, timer;
  const bytes=text=>new TextEncoder().encode(text).byteLength;
  function validate(text){
    if(bytes(text)>LIMIT)throw Error('编辑内容超过 1 MiB，请缩小数据后重试');
    return parseJsonExact(text);
  }
  function format(text){
    validate(text);
    const tokens=String(text).replace(/^\uFEFF/,'').match(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)||[];
    const out=[];let depth=0;
    const indent=()=> '  '.repeat(depth);
    for(let i=0;i<tokens.length;i++){
      const token=tokens[i];
      if(token==='{'||token==='['){
        if(++depth>64)throw Error('嵌套超过 64 层，无法在编辑器中格式化');
        out.push(token);if(tokens[i+1]!=='}'&&tokens[i+1]!==']')out.push('\n',indent());
      }else if(token==='}'||token===']'){
        depth--;if(tokens[i-1]!=='{'&&tokens[i-1]!=='[')out.push('\n',indent());out.push(token);
      }else if(token===',')out.push(',\n',indent());
      else out.push(token===':'?': ':token);
    }
    const result=out.join('');
    if(bytes(result)>LIMIT)throw Error('格式化结果超过 1 MiB，请保留紧凑格式');
    return result;
  }
  function diff(before,after){
    const changes=[],stack=[{before,after,path:[],hasBefore:true,hasAfter:true}];
    let visited=0;
    while(stack.length && changes.length<100 && visited++<20000){
      const entry=stack.pop(),a=entry.before,b=entry.after;
      if(!entry.hasBefore){changes.push({...entry,kind:'added'});continue;}
      if(!entry.hasAfter){changes.push({...entry,kind:'removed'});continue;}
      if(Object.is(a,b))continue;
      if(a!==null && b!==null && typeof a==='object' && typeof b==='object' && Array.isArray(a)===Array.isArray(b)){
        if(entry.path.length>=64)return {changes,truncated:true};
        const keys=[...new Set([...Object.keys(a),...Object.keys(b)])];
        // Bound pending work as well as rendered changes on wide responses.
        if(keys.length+stack.length>20000)return {changes,truncated:true};
        for(let i=keys.length-1;i>=0;i--){const key=keys[i];stack.push({before:Object.hasOwn(a,key)?a[key]:undefined,after:Object.hasOwn(b,key)?b[key]:undefined,path:entry.path.concat(Array.isArray(a)?Number(key):key),hasBefore:Object.hasOwn(a,key),hasAfter:Object.hasOwn(b,key)});}
      }else changes.push({...entry,kind:'changed'});
    }
    return {changes,truncated:stack.length>0};
  }
  function preview(value,present){
    if(!present)return '（不存在）';
    if(Array.isArray(value))return `Array(${value.length})`;
    if(value!==null && typeof value==='object')return `Object(${Object.keys(value).length})`;
    if(typeof value==='string' && value.length>160)return stringifyJson(value.slice(0,160))+'…';
    return stringifyJson(value);
  }
  function remember(){if(state)drafts.set(state.item,{text:$('#responseEditorInput').value,savedText:state.savedText});}
  function renderChanges(result){
    const host=$('#responseEditorChanges');host.textContent='';
    $('#responseEditorDiffSummary').textContent=result.truncated?`已显示 ${result.changes.length} 项 · 对比达到上限`:`${result.changes.length} 项变更`;
    if(!result.changes.length){
      const empty=document.createElement('div');empty.className='response-diff-empty';empty.textContent=result.truncated?'数据较复杂，仅完成部分对比。':'字段值与原始响应一致。编辑右侧内容后，变更会显示在这里。';host.appendChild(empty);return;
    }
    const labels={added:'新增',removed:'删除',changed:'修改'};
    for(const change of result.changes){
      const row=document.createElement('div');row.className='response-change '+change.kind;
      const kind=document.createElement('span');kind.className='change-kind';kind.textContent=labels[change.kind];
      const path=document.createElement('code');path.className='change-path';path.textContent=pathText(change.path);path.title=path.textContent;
      const values=document.createElement('div');values.className='change-values';
      const before=document.createElement('span');before.className='change-before';before.textContent=preview(change.before,change.hasBefore);
      const arrow=document.createElement('span');arrow.className='change-arrow';arrow.textContent='→';
      const after=document.createElement('span');after.className='change-after';after.textContent=preview(change.after,change.hasAfter);
      values.appendChild(before);values.appendChild(arrow);values.appendChild(after);
      row.appendChild(kind);row.appendChild(path);row.appendChild(values);host.appendChild(row);
    }
  }
  function update(){
    clearTimeout(timer);if(!state)return false;
    const input=$('#responseEditorInput'),text=input.value;
    remember();
    const size=bytes(text);$('#responseEditorSize').textContent=`${(size/1024).toFixed(1)} KiB · ${text.split('\n').length} 行`;
    $('#responseEditorSaveState').textContent=text===state.savedText?(text===state.original?'未修改':'已保存草稿'):'未保存更改';
    try{
      validate(text);
      input.setAttribute('aria-invalid','false');$('#responseEditorError').classList.add('hidden');$('#responseEditorError').textContent='';
      $('#responseEditorValidity').textContent='✓ JSON 有效';$('#responseEditorValidity').className='editor-validity valid';
      $('#responseEditorSave').disabled=false;$('#responseEditorCopy').disabled=false;
      renderMock();return true;
    }catch(error){
      input.setAttribute('aria-invalid','true');$('#responseEditorError').textContent='JSON 无效：'+error.message;$('#responseEditorError').classList.remove('hidden');
      $('#responseEditorValidity').textContent='! JSON 无效';$('#responseEditorValidity').className='editor-validity invalid';
      $('#responseEditorSave').disabled=true;$('#responseEditorCopy').disabled=true;
      renderMock();return false;
    }
  }
  function reset(restoreFocus=false){
    ++generation;clearTimeout(timer);remember();state=null;
    $('#responseEditor').classList.add('hidden');
    $('#responseEditorInput').value='';$('#responseEditorOriginal').textContent='';$('#responseEditorChanges').textContent='';
    $('#responseEditorError').textContent='';$('#responseEditorError').classList.add('hidden');
    $('.app').inert=false;
    if(restoreFocus && selected)$('#editResponseBtn').focus();
  }
  async function open(){
    const item=selected;if(!item?.valid)return;
    const current=++generation;
    if(item.meta.bytes>LIMIT)throw Error('响应超过 1 MiB，当前编辑器仅支持较小的 JSON 响应');
    const raw=await callWorker('rawFull',{rid:item.rid});
    if(current!==generation || selected!==item)return;
    const originalValue=validate(raw.text);
    let original=raw.text;try{original=format(raw.text);}catch{}
    const draft=drafts.get(item);
    state={item,original,originalValue,savedText:draft?.savedText??original};
    closeModal();$('.app').inert=true;
    $('#responseEditorOriginal').textContent=original;
    $('#responseEditorInput').value=draft?.text??original;
    $('#responseEditorMethod').textContent=item.method;$('#responseEditorMethod').className='method '+item.method.toLowerCase();
    const mock=typeof ResponseMock==='undefined'?null:ResponseMock.get(item).rule;
    $('#responseMockMode').value=mock?.once===true?'once':'always';$('#responseMockStatus').value=String(mock?.status??(item.status>=200 && item.status<=599 && ![204,205,304].includes(item.status)?item.status:200));
    $('#responseEditorUrl').textContent=item.url;$('#responseEditorUrl').title=item.url;
    $('#responseEditor').classList.remove('hidden');update();$('#responseEditorInput').focus();
  }
  function save(){
    if(!update())return false;
    state.savedText=$('#responseEditorInput').value;remember();update();toast('草稿已保存；点击“应用到网页”后生效');return true;
  }
  function renderAppliedChanges(rule){
    // Compare only the response body confirmed as consumed by the page, never a draft.
    if(!rule || !rule.hits){
      state.comparedBody=undefined;
      $('#responseEditorChanges').textContent='';
      $('#responseEditorDiffSummary').textContent='网页使用假数据后自动对比';
      return;
    }
    if(state.comparedBody===rule.body)return;
    renderChanges(diff(state.originalValue,validate(rule.body)));
    state.comparedBody=rule.body;
  }
  function renderMock(){
    if(!state)return;
    const manager=typeof ResponseMock==='undefined'?null:ResponseMock.get(state.item),rule=manager?.rule;
    renderAppliedChanges(rule);
    const stale=rule && (rule.body!==$('#responseEditorInput').value || rule.once!==($('#responseMockMode').value==='once') || rule.status!==Number($('#responseMockStatus').value));
    const valid=$('#responseEditorInput').getAttribute('aria-invalid')!=='true' && !$('#responseEditorSave').disabled;
    $('#responseMockEnable').disabled=!valid || !manager || manager.busy;
    $('#responseMockDisable').disabled=!manager?.active || !rule?.enabled || manager.busy;
    $('#responseMockReload').disabled=!valid || !manager || manager.busy;
    $('#responseMockEnable').textContent='应用到网页';
    $('#responseMockState').textContent=!manager?'网页替换请在 Chrome DevTools 中使用':manager.error?manager.error:manager.reloading?'正在刷新网页…':manager.active && rule?.enabled?`替换中 · 已命中 ${rule.hits} 次${stale?' · 修改尚未应用':' · 回到网页重新查询'}`:'应用后，回到网页重新查询即可看到修改';
  }
  $('#responseMockMode').onchange=renderMock;$('#responseMockStatus').oninput=renderMock;
  async function applyToPage(){
    if(!update() || typeof ResponseMock==='undefined')return;
    const item=state.item,body=$('#responseEditorInput').value,options={once:$('#responseMockMode').value==='once',status:Number($('#responseMockStatus').value)};
    await ResponseMock.enable(item,body,options);
    if(state?.item===item){state.savedText=body;remember();update();}
    return true;
  }
  $('#responseMockEnable').onclick=safe(applyToPage);
  $('#responseMockDisable').onclick=safe(()=>state && typeof ResponseMock!=='undefined' && ResponseMock.disable(state.item));
  $('#responseMockReload').onclick=safe(async()=>{if(await applyToPage())await ResponseMock.reload();});
  if(typeof ResponseMock!=='undefined')ResponseMock.subscribe(renderMock);
  $('#editResponseBtn').onclick=safe(open);
  $('#responseEditorClose').onclick=()=>reset(true);
  $('#responseEditorValidate').onclick=update;$('#responseEditorCompare').onclick=update;
  $('#responseEditorSave').onclick=save;
  $('#responseEditorCopy').onclick=safe(()=>{if(update())return copyText($('#responseEditorInput').value);});
  $('#responseEditorFormat').onclick=safe(()=>{if(!state)return;$('#responseEditorInput').value=format($('#responseEditorInput').value);update();});
  $('#responseEditorRestore').onclick=()=>{if(!state)return;$('#responseEditorInput').value=state.original;update();};
  $('#responseEditorInput').oninput=()=>{
    if(!state)return;remember();$('#responseEditorSaveState').textContent='未保存更改';
    $('#responseEditorValidity').textContent='正在校验…';$('#responseEditorSave').disabled=true;$('#responseEditorCopy').disabled=true;
    $('#responseMockEnable').disabled=true;
    // Keep the last applied comparison while editing the next draft.
    clearTimeout(timer);timer=setTimeout(update,220);
  };
  document.addEventListener('keydown',e=>{
    if(!state)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();reset(true);return;}
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){e.preventDefault();save();return;}
    if(e.key==='Tab'){
      const focusable=[...$('#responseEditor').querySelectorAll('button:not(:disabled):not([hidden]), textarea, select, input, summary, [tabindex="0"]')].filter(el=>!el.closest('details:not([open])') || el===el.closest('details').querySelector('summary'));
      const first=focusable[0],last=focusable.at(-1);
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  },true);
  return {open,reset,validate,format,diff,update,save};
})();
