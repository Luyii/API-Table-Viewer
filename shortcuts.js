// Shortcuts apply while focus is inside the extension panel.
function activeSearchScope(){
  if(!$('#modal').classList.contains('hidden'))return viewerState?'viewer':null;
  const active=document.activeElement;
  if(active===$('#searchInput') || active?.closest?.('#requestSidebar'))return 'requests';
  if(selected && !$('#tablePanel').classList.contains('hidden'))return 'table';
  if(selected && !$('#treePanel').classList.contains('hidden'))return 'tree';
  return 'requests';
}
function focusActiveSearch(){
  const scope=activeSearchScope();if(!scope)return;
  const input=$(scope==='viewer'?'#viewerQuery':scope==='table'?'#tableSearch':scope==='tree'?'#treeSearch':'#searchInput');
  if(scope==='requests' && typeof setSidebarCollapsed==='function' && sidebarLayout.collapsed)setSidebarCollapsed(false);
  input.focus();input.select();return scope;
}
async function nextSearchMatch(delta){
  const scope=activeSearchScope();
  if(scope==='viewer')return stepViewerMatch(delta);
  if(scope==='table'){
    if(!tableState.query.trim()){focusActiveSearch();return;}
    if(window.st){clearTimeout(window.st);window.st=null;return renderTable(true);}
    return stepMatch(delta);
  }
  if(scope==='tree')return searchResponseFields();
  if(scope==='requests')focusActiveSearch();
}
async function handleSearchShortcut(e){
  if(e.defaultPrevented || e.isComposing || e.altKey)return;
  const key=e.key.toLowerCase(),command=e.ctrlKey||e.metaKey;
  if(command && key==='f' && !e.shiftKey){
    if(!activeSearchScope())return;e.preventDefault();e.stopPropagation();focusActiveSearch();return;
  }
  if((key==='f3' && !command) || (command && key==='g')){
    if(!activeSearchScope())return;e.preventDefault();e.stopPropagation();return nextSearchMatch(e.shiftKey?-1:1);
  }
}
document.addEventListener('keydown',safe(handleSearchShortcut),true);
$('#treeSearch').title='搜索当前响应的字段名或值；Enter 打开查看器并定位；Ctrl/⌘+F 聚焦';
$('#tableSearch').title='Ctrl/⌘+F 搜索；Enter/F3 下一个；Shift+Enter/Shift+F3 上一个';
$('#viewerQuery').title='Ctrl/⌘+F 搜索；Enter/F3 下一个；Shift+Enter/Shift+F3 上一个';
$('#searchInput').title='仅筛选左侧接口 URL / 路径，不搜索响应字段；焦点在左侧时 Ctrl/⌘+F 聚焦';
