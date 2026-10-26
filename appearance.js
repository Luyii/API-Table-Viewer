// Apply saved colors before the first paint; appearance never changes captured data.
const Appearance=(()=>{
  const storageKey='api-table-viewer.appearance.v1';
  const themes={graphite:{background:'#181a20',accent:'#8b9dff'},ocean:{background:'#171e28',accent:'#4ea1ff'},forest:{background:'#14201d',accent:'#52c9a5'},paper:{background:'#f3f5f9',accent:'#4f5bd5'}};
  const themeColors={
    "graphite": {
      "bg": "#181a20",
      "panel": "#20232c",
      "panel2": "#2b303d",
      "control": "#1b1e27",
      "header": "#2b3040",
      "row": "#1e222b",
      "row-alt": "#252a35",
      "text": "#e6e8ef",
      "muted": "#a6adbd",
      "line": "#3d4352",
      "hover": "#2c3241",
      "selection": "#343954",
      "key": "#c3b4f3",
      "number": "#9fcaff",
      "string": "#a3d5a4",
      "boolean": "#edb974",
      "null": "#b4a1d6",
      "green": "#5bc48b",
      "red": "#f16b6b",
      "yellow": "#d7ad58",
      "edited": "#213d37",
      "edited-line": "#71c5a4",
      "match": "#5a4820",
      "match-text": "#fff0ba",
      "match-line": "#edbf5d",
      "scroll-thumb": "#50596e",
      "scroll-hover": "#69758c",
      "scroll-active": "#8793ac"
    },
    "ocean": {
      "bg": "#171e28",
      "panel": "#202b3b",
      "panel2": "#293b52",
      "control": "#162130",
      "header": "#293b52",
      "row": "#1e2836",
      "row-alt": "#253244",
      "text": "#e6edf8",
      "muted": "#a5b4c8",
      "line": "#43536c",
      "hover": "#2c4059",
      "selection": "#2d4561",
      "key": "#b1d7ff",
      "number": "#a8d4ff",
      "string": "#b8dda7",
      "boolean": "#ffd193",
      "null": "#c0afdc",
      "green": "#5bc48b",
      "red": "#f16b6b",
      "yellow": "#d7ad58",
      "edited": "#213d37",
      "edited-line": "#71c5a4",
      "match": "#5a4820",
      "match-text": "#fff0ba",
      "match-line": "#edbf5d",
      "scroll-thumb": "#536780",
      "scroll-hover": "#718eaf",
      "scroll-active": "#91b8e0"
    },
    "forest": {
      "bg": "#14201d",
      "panel": "#1c2a27",
      "panel2": "#283b35",
      "control": "#17241f",
      "header": "#293d35",
      "row": "#192a23",
      "row-alt": "#203329",
      "text": "#e0eee7",
      "muted": "#a3bcb0",
      "line": "#3c554c",
      "hover": "#2a4138",
      "selection": "#2e4c40",
      "key": "#a5d7c5",
      "number": "#a7c8ff",
      "string": "#a3dfa7",
      "boolean": "#eec782",
      "null": "#c7b2df",
      "green": "#5bc48b",
      "red": "#f16b6b",
      "yellow": "#d7ad58",
      "edited": "#213d37",
      "edited-line": "#71c5a4",
      "match": "#5a4820",
      "match-text": "#fff0ba",
      "match-line": "#edbf5d",
      "scroll-thumb": "#506d60",
      "scroll-hover": "#6b8879",
      "scroll-active": "#8ba797"
    },
    "paper": {
      "bg": "#f3f5f9",
      "panel": "#ffffff",
      "panel2": "#e8edf6",
      "control": "#f7f9fc",
      "header": "#e6ebf5",
      "row": "#ffffff",
      "row-alt": "#f0f3f9",
      "text": "#263249",
      "muted": "#59677d",
      "line": "#cbd3e0",
      "hover": "#e8edf6",
      "selection": "#dfe5f8",
      "key": "#5a439e",
      "number": "#245ba6",
      "string": "#246438",
      "boolean": "#8b5100",
      "null": "#775293",
      "green": "#197145",
      "red": "#b52c3b",
      "yellow": "#8b5a00",
      "edited": "#e0f2e9",
      "edited-line": "#247b57",
      "match": "#ffe6a0",
      "match-text": "#533300",
      "match-line": "#946400",
      "scroll-thumb": "#b0bbce",
      "scroll-hover": "#8e9db5",
      "scroll-active": "#6f819d"
    }
  };
  const colorKeys=Object.keys(themeColors.graphite);
  const validHex=value=>typeof value==='string' && /^#[\da-f]{6}$/i.test(value);
  const defaults={theme:'graphite',accent:themes.graphite.accent,fontSize:13,density:'comfortable',striped:true,customColor:null};
  function normalize(value){
    const data=value && typeof value==='object'?value:{};
    const theme=Object.hasOwn(themes,data.theme)?data.theme:defaults.theme;
    const seed=data.customColor??data.colors?.bg;
    const customColor=validHex(seed)?seed.toLowerCase():null;
    return {customColor,theme,accent:typeof data.accent==='string' && /^#[\da-f]{6}$/i.test(data.accent)?data.accent:themes[theme].accent,
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
  function mix(color,target,weight){
    const a=color.match(/[\da-f]{2}/gi),b=target.match(/[\da-f]{2}/gi);
    return '#'+a.map((value,i)=>Math.round(parseInt(value,16)*(1-weight)+parseInt(b[i],16)*weight).toString(16).padStart(2,'0')).join('');
  }
  function generatedColors(seed){
    const light=luminance(seed)>.179,end=light?'#ffffff':'#000000';
    const colors={...themeColors[light?'paper':'graphite'],bg:seed};
    for(const [key,amount] of Object.entries({panel:.12,panel2:.23,control:.06,header:.20,row:0,'row-alt':.08,hover:.27,selection:.32}))colors[key]=mix(seed,end,amount);
    const text=light?'#17201b':'#eef5f0';
    colors.text=readableAccent(text,seed);colors.muted=readableAccent(mix(colors.text,seed,.25),seed);
    colors.line=mix(seed,colors.text,.30);
    for(const key of ['key','number','string','boolean','null','green','red','yellow'])colors[key]=readableAccent(colors[key],seed);
    colors.edited=mix(seed,colors.green,.12);colors['edited-line']=colors.green;
    colors.match=mix(seed,colors.yellow,.15);colors['match-text']=readableAccent(colors.text,colors.match);colors['match-line']=colors.yellow;
    colors['scroll-thumb']=mix(seed,colors.text,.40);colors['scroll-hover']=mix(seed,colors.text,.55);colors['scroll-active']=mix(seed,colors.text,.70);
    return colors;
  }
  function apply(){
    const root=document.documentElement,colors=prefs.customColor?generatedColors(prefs.customColor):null;
    root.dataset.theme=colors?(luminance(prefs.customColor)>.179?'paper':'graphite'):prefs.theme;
    root.dataset.density=prefs.density;root.dataset.striped=String(prefs.striped);
    for(const key of colorKeys){if(colors)root.style.setProperty('--'+key,colors[key]);else root.style.removeProperty('--'+key);}
    const background=prefs.customColor||themes[prefs.theme].background;
    root.style.setProperty('color-scheme',luminance(background)>.179?'light':'dark');
    root.style.setProperty('--blue',readableAccent(prefs.accent,background));
    root.style.setProperty('--blue2',prefs.accent);
    root.style.setProperty('--data-font-size',prefs.fontSize+'px');
  }
  apply();
  function mount(){
    const menu=document.getElementById('appearanceMenu'),status=document.getElementById('appearanceStatus');
    const color=document.getElementById('appearanceAccent'),font=document.getElementById('appearanceFont'),density=document.getElementById('appearanceDensity'),striped=document.getElementById('appearanceStriped');
    const palettes=[...menu.querySelectorAll('[data-theme-choice]')],accents=[...menu.querySelectorAll('[data-accent-choice]')];
    function sync(){
      const seed=prefs.customColor||themes[prefs.theme].background;
      document.getElementById('appearanceThemeHex').value=seed;
      document.getElementById('appearanceThemeHex').setAttribute('aria-invalid','false');
      document.getElementById('appearanceThemeColor').value=seed;
      color.value=prefs.accent;font.value=String(prefs.fontSize);density.value=prefs.density;striped.checked=prefs.striped;
      for(const button of palettes)button.setAttribute('aria-pressed',String(!prefs.customColor && button.dataset.themeChoice===prefs.theme));
      for(const button of accents)button.setAttribute('aria-pressed',String(button.dataset.accentChoice.toLowerCase()===prefs.accent.toLowerCase()));
      document.getElementById('appearanceAccentValue').textContent=prefs.accent.toUpperCase();
    }
    function update(changes){
      const previousFont=prefs.fontSize;prefs=normalize({...prefs,...changes});apply();sync();
      try{localStorage.setItem(storageKey,JSON.stringify(prefs));status.textContent='已保存，下次打开继续使用';}
      catch{status.textContent='已应用，本次设置无法保存';}
      if(previousFont!==prefs.fontSize)document.dispatchEvent(new CustomEvent('appearancechange'));
    }
    for(const button of palettes)button.onclick=()=>update({theme:button.dataset.themeChoice,accent:themes[button.dataset.themeChoice].accent,customColor:null});
    for(const button of accents)button.onclick=()=>update({accent:button.dataset.accentChoice});
    function bindHex(input,read,commit){
      input.oninput=()=>{
        const value=input.value.trim();
        const valid=validHex(value);input.setAttribute('aria-invalid',String(!valid));
        if(valid)commit(value.toLowerCase());
        else status.textContent='请输入完整色值，例如 #e2e9df；未完成的输入不会应用';
      };
      input.onblur=()=>{if(!validHex(input.value.trim())){input.value=read();input.setAttribute('aria-invalid','false');status.textContent='无效色值未应用，已恢复上次颜色';}};
      input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.oninput();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();input.value=read();input.setAttribute('aria-invalid','false');}};
    }
    const customize=value=>update({customColor:value,accent:readableAccent(mix(value,luminance(value)>.179?'#154d36':'#b3f0ce',.65),value)});
    bindHex(document.getElementById('appearanceThemeHex'),()=>prefs.customColor||themes[prefs.theme].background,customize);
    document.getElementById('appearanceThemeColor').oninput=event=>customize(event.target.value);
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
