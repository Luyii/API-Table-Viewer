// Apply saved colors before the first paint; appearance never changes captured data.
const Appearance=(()=>{
  const storageKey='api-table-viewer.appearance.v1';
  const themes={graphite:{background:'#181a20',accent:'#8b9dff'},ocean:{background:'#171e28',accent:'#4ea1ff'},forest:{background:'#14201d',accent:'#52c9a5'},paper:{background:'#f3f5f9',accent:'#4f5bd5'}};
  const defaults={theme:'graphite',accent:themes.graphite.accent,fontSize:13,density:'comfortable',striped:true};
  function normalize(value){
    const data=value && typeof value==='object'?value:{};
    const theme=Object.hasOwn(themes,data.theme)?data.theme:defaults.theme;
    return {theme,accent:typeof data.accent==='string' && /^#[\da-f]{6}$/i.test(data.accent)?data.accent:themes[theme].accent,
      fontSize:[12,13,14,15,16].includes(data.fontSize)?data.fontSize:defaults.fontSize,
      density:data.density==='compact'?'compact':'comfortable',striped:typeof data.striped==='boolean'?data.striped:true};
  }
  let prefs={...defaults};
  try{prefs=normalize(JSON.parse(localStorage.getItem(storageKey)));}catch{}
  function luminance(color){
    const rgb=color.match(/[\da-f]{2}/gi).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  }
  function readableAccent(color,background){
    const bg=luminance(background),contrast=c=>(Math.max(luminance(c),bg)+.05)/(Math.min(luminance(c),bg)+.05);
    if(contrast(color)>=4.5)return color;
    const rgb=color.match(/[\da-f]{2}/gi).map(c=>parseInt(c,16));
    const end=bg>.179?0:255;
    for(let step=1;step<=20;step++){
      const mixed='#'+rgb.map(c=>Math.round(c+(end-c)*step/20).toString(16).padStart(2,'0')).join('');
      if(contrast(mixed)>=4.5)return mixed;
    }
    return end?'#ffffff':'#000000';
  }
  function apply(){
    const root=document.documentElement;
    root.dataset.theme=prefs.theme;root.dataset.density=prefs.density;root.dataset.striped=String(prefs.striped);
    root.style.setProperty('--blue',readableAccent(prefs.accent,themes[prefs.theme].background));
    root.style.setProperty('--blue2',prefs.accent);
    root.style.setProperty('--data-font-size',prefs.fontSize+'px');
  }
  apply();
  function mount(){
    const menu=document.getElementById('appearanceMenu'),status=document.getElementById('appearanceStatus');
    const color=document.getElementById('appearanceAccent'),font=document.getElementById('appearanceFont'),density=document.getElementById('appearanceDensity'),striped=document.getElementById('appearanceStriped');
    const palettes=[...menu.querySelectorAll('[data-theme-choice]')],accents=[...menu.querySelectorAll('[data-accent-choice]')];
    function sync(){
      color.value=prefs.accent;font.value=String(prefs.fontSize);density.value=prefs.density;striped.checked=prefs.striped;
      for(const button of palettes)button.setAttribute('aria-pressed',String(button.dataset.themeChoice===prefs.theme));
      for(const button of accents)button.setAttribute('aria-pressed',String(button.dataset.accentChoice.toLowerCase()===prefs.accent.toLowerCase()));
      document.getElementById('appearanceAccentValue').textContent=prefs.accent.toUpperCase();
    }
    function update(changes){
      const previousFont=prefs.fontSize;prefs=normalize({...prefs,...changes});apply();sync();
      try{localStorage.setItem(storageKey,JSON.stringify(prefs));status.textContent='已保存，下次打开继续使用';}
      catch{status.textContent='已应用，本次设置无法保存';}
      if(previousFont!==prefs.fontSize)document.dispatchEvent(new CustomEvent('appearancechange'));
    }
    for(const button of palettes)button.onclick=()=>update({theme:button.dataset.themeChoice,accent:themes[button.dataset.themeChoice].accent});
    for(const button of accents)button.onclick=()=>update({accent:button.dataset.accentChoice});
    color.oninput=()=>update({accent:color.value});font.onchange=()=>update({fontSize:Number(font.value)});
    density.onchange=()=>update({density:density.value});striped.onchange=()=>update({striped:striped.checked});
    document.getElementById('appearanceReset').onclick=()=>update(defaults);
    document.getElementById('appearanceClose').onclick=()=>close();
    function close(){menu.open=false;document.getElementById('appearanceToggle').focus();}
    document.addEventListener('pointerdown',e=>{if(menu.open && !menu.contains(e.target))menu.open=false;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && menu.open){e.preventDefault();e.stopPropagation();close();}},true);
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return {get fontSize(){return prefs.fontSize;}};
})();
