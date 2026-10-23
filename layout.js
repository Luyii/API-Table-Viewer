const layoutWorkspace=$('.workspace'), sidebarResizer=$('#sidebarResizer');
const SIDEBAR_PREF_KEY='api-table-viewer.layout.v1';
let sidebarLayout={width:300,collapsed:false}, sidebarDrag=null;
try{const saved=JSON.parse(localStorage.getItem(SIDEBAR_PREF_KEY));if(saved && Number.isFinite(saved.width))sidebarLayout={width:Math.max(80,Math.min(2000,saved.width)),collapsed:saved.collapsed===true};}catch{}
function sidebarBounds(){
  const width=layoutWorkspace.getBoundingClientRect().width;
  const rightMin=Math.min(280,Math.max(120,width*.45));
  const max=Math.max(0,width-6-rightMin);
  return {min:Math.min(160,max),max};
}
function saveSidebarLayout(){try{localStorage.setItem(SIDEBAR_PREF_KEY,JSON.stringify(sidebarLayout));}catch{}}
function applySidebarLayout(){
  const {min,max}=sidebarBounds(),width=Math.max(min,Math.min(max,sidebarLayout.width));
  layoutWorkspace.style.setProperty('--sidebar-width',width+'px');
  layoutWorkspace.classList.toggle('sidebar-collapsed',sidebarLayout.collapsed);
  $('#requestSidebar').setAttribute('aria-hidden',String(sidebarLayout.collapsed));
  const button=$('#toggleSidebar');button.textContent=sidebarLayout.collapsed?'显示列表':'收起列表';button.title=sidebarLayout.collapsed?'展开左侧接口列表':'收起左侧接口列表';button.setAttribute('aria-expanded',String(!sidebarLayout.collapsed));
  sidebarResizer.setAttribute('aria-valuemin',String(Math.round(min)));sidebarResizer.setAttribute('aria-valuemax',String(Math.round(max)));sidebarResizer.setAttribute('aria-valuenow',String(Math.round(width)));
}
function finishSidebarDrag(){
  if(!sidebarDrag)return;
  const id=sidebarDrag.id;sidebarDrag=null;
  document.body.classList.remove('sidebar-dragging');
  if(sidebarResizer.hasPointerCapture?.(id))sidebarResizer.releasePointerCapture(id);
  saveSidebarLayout();
}
function setSidebarCollapsed(collapsed){
  finishSidebarDrag();sidebarLayout.collapsed=collapsed;applySidebarLayout();saveSidebarLayout();
}
$('#toggleSidebar').onclick=()=>setSidebarCollapsed(!sidebarLayout.collapsed);
$('#closeSidebar').onclick=()=>{setSidebarCollapsed(true);$('#toggleSidebar').focus();};
sidebarResizer.onpointerdown=e=>{
  if(e.button!==0 || sidebarLayout.collapsed)return;
  e.preventDefault();sidebarDrag={id:e.pointerId};sidebarResizer.setPointerCapture(e.pointerId);document.body.classList.add('sidebar-dragging');
};
sidebarResizer.onpointermove=e=>{
  if(!sidebarDrag || sidebarDrag.id!==e.pointerId)return;
  const {min,max}=sidebarBounds();sidebarLayout.width=Math.max(min,Math.min(max,e.clientX-layoutWorkspace.getBoundingClientRect().left));applySidebarLayout();
};
sidebarResizer.onpointerup=finishSidebarDrag;sidebarResizer.onpointercancel=finishSidebarDrag;sidebarResizer.onlostpointercapture=finishSidebarDrag;
sidebarResizer.ondblclick=()=>{sidebarLayout.width=300;applySidebarLayout();saveSidebarLayout();};
sidebarResizer.onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const {min,max}=sidebarBounds(),current=Number(sidebarResizer.getAttribute('aria-valuenow'))||sidebarLayout.width;
  sidebarLayout.width=e.key==='Home'?min:e.key==='End'?max:Math.max(min,Math.min(max,current+(e.key==='ArrowLeft'?-20:20)));applySidebarLayout();saveSidebarLayout();
};
window.addEventListener('resize',applySidebarLayout);window.addEventListener('blur',finishSidebarDrag);
applySidebarLayout();

// Keep the disclosure reachable while all detail controls are hidden.
const detailControlsToggle=$('#toggleDetailControls');
detailControlsToggle.onclick=()=>{
  const collapsed=$('#detail').classList.toggle('detail-controls-collapsed');
  detailControlsToggle.setAttribute('aria-expanded',String(!collapsed));
  const label=collapsed?'展开上方工具区':'收起上方工具区';
  detailControlsToggle.setAttribute('aria-label',label);detailControlsToggle.title=label;
};
