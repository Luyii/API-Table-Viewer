'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../appearance.js'),'utf8');
const key='api-table-viewer.appearance.v1';
function panel(storage=new Map(),blocked=false){
  const nodes=new Map(),events=new Map(),changes=[];
  function element(data={}){return {dataset:data,value:'',checked:false,open:false,textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){this.focused=true;},contains(target){return target===this;}};}
  function get(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}
  const palettes=['graphite','ocean','forest','paper'].map(themeChoice=>element({themeChoice})),accents=['#8b9dff','#4ea1ff','#52c9a5','#edb35c','#ed87a8'].map(accentChoice=>element({accentChoice}));
  get('appearanceMenu').querySelectorAll=s=>s==='[data-theme-choice]'?palettes:accents;
  const root={dataset:{},style:{values:{},setProperty(k,v){this.values[k]=v;}}};
  const context=vm.createContext({localStorage:{getItem:k=>{if(blocked)throw Error('blocked');return storage.get(k)??null;},setItem:(k,v)=>{if(blocked)throw Error('blocked');storage.set(k,v);}},
    document:{documentElement:root,readyState:'complete',getElementById:get,addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:e=>changes.push(e.type)},CustomEvent:class{constructor(type){this.type=type;}}});
  vm.runInContext(source,context);return {get,root,palettes,accents,changes,events,storage,context};
}
test('appearance choices survive reopening, preserve unrelated preferences and apply immediately',()=>{
  const p=panel(new Map([['layout','keep']]));p.palettes[2].onclick();p.accents[3].onclick();p.get('appearanceFont').value='16';p.get('appearanceFont').onchange();p.get('appearanceDensity').value='compact';p.get('appearanceDensity').onchange();p.get('appearanceStriped').checked=false;p.get('appearanceStriped').onchange();
  assert.equal(p.root.dataset.theme,'forest');assert.equal(p.root.dataset.density,'compact');assert.equal(p.root.dataset.striped,'false');assert.equal(p.root.style.values['--data-font-size'],'16px');assert.equal(p.changes.length,1);
  const reopened=panel(p.storage);assert.equal(reopened.get('appearanceFont').value,'16');assert.equal(reopened.get('appearanceAccent').value,'#edb35c');assert.equal(reopened.palettes[2].attributes['aria-pressed'],'true');assert.equal(p.storage.get('layout'),'keep');
  reopened.get('appearanceReset').onclick();const reset=JSON.parse(p.storage.get(key));assert.equal(reset.theme,'graphite');assert.equal(reset.fontSize,13);assert.equal(reset.striped,true);assert.equal(p.storage.get('layout'),'keep');
});
test('malformed, outdated and blocked storage leave the panel usable',()=>{
  for(const raw of ['bad json','null','{"theme":"toString","accent":"url(bad)","fontSize":999,"striped":null}']){
    const p=panel(new Map([[key,raw]]));assert.equal(p.root.dataset.theme,'graphite');assert.equal(p.get('appearanceFont').value,'13');assert.equal(p.get('appearanceAccent').value,'#8b9dff');
  }
  const p=panel(new Map(),true);p.palettes[3].onclick();assert.equal(p.root.dataset.theme,'paper');assert(p.get('appearanceStatus').textContent.includes('无法保存'));
});
test('extreme custom accents remain legible against light and dark backgrounds',()=>{
  const p=panel();p.get('appearanceAccent').value='#000000';p.get('appearanceAccent').oninput();assert.notEqual(p.root.style.values['--blue'],'#000000');
  p.palettes[3].onclick();p.get('appearanceAccent').value='#ffffff';p.get('appearanceAccent').oninput();assert.notEqual(p.root.style.values['--blue'],'#ffffff');assert.equal(p.get('appearanceAccent').value,'#ffffff');
});
test('Escape and an outside click close appearance settings; Escape restores focus',()=>{
  const p=panel(),menu=p.get('appearanceMenu');menu.open=true;p.events.get('pointerdown')({target:menu});assert(menu.open);p.events.get('pointerdown')({target:{}});assert(!menu.open);
  menu.open=true;let prevented=false;p.events.get('keydown')({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){}});assert(!menu.open);assert(prevented);assert(p.get('appearanceToggle').focused);
});

test('larger data fonts expand header widths without replacing rows or parsing responses again',()=>{
  let resized;const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{style:{},children:[],querySelector:()=>null});return nodes.get(id);};
  const header={style:{},querySelector:()=>null};get('#tableColumns').children=[{style:{}}];get('#dataTable thead').children=[{children:[header]}];
  const column='aLongHeaderThatMustStayOnOneLine';
  const rows=[{[column]:{text:'short',type:'string'}}],state={path:['records'],rows};
  const context=vm.createContext({Appearance:{fontSize:13},selected:{rid:'r'},tableState:state,$:get,safe:fn=>fn,document:{createElement:()=>({getContext:()=>null}),addEventListener:(_,fn)=>{resized=fn;}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../table-ui.js'),'utf8'),context);context.column=column;
  const before=vm.runInContext('resolvedTableWidths([column],tableState.rows).get(column)',context);
  context.Appearance.fontSize=16;resized();
  assert(parseFloat(header.style.width)>before);assert.equal(context.tableState.rows,rows);assert.equal(get('#tableColumns').children[0].style.width,header.style.width);
});
