'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const suites={
 docs:['node','scripts/check-docs.cjs'],
 resources:['node','tests/package-check.cjs'],
 capture:['node','--test','tests/capture-startup.cjs'],
 appearance:['node','--test','tests/appearance.cjs'],
 regression:['node','tests/regression.cjs'],
 display:['node','tests/display-conversion.cjs'],
 fixtures:['node','--test','tests/manual/check.cjs'],
 fields:['node','--test','tests/field-mock.cjs'],
 mock:['node','--test','tests/response-mock.cjs'],
 preview:['node','--test','tests/preview/check.cjs'],
 selection:['node','--test','tests/test-selection.cjs']
};
function select(files){
 const selected=new Set(),reasons={};let full=false;
 const add=(file,...names)=>{for(const name of names){selected.add(name);(reasons[name]??=[]).push(file);}};
 for(const raw of files){
  const file=raw.replaceAll('\\','/').replace(/^\.\//,'');
  if(file.endsWith('.md')){add(file,'docs');continue;}
  if(['.gitignore','.editorconfig'].includes(file))continue;
  if(['package.json','package-lock.json','manifest.json','scripts/test-changed.cjs','scripts/check-docs.cjs','tests/test-selection.cjs'].includes(file)||file.startsWith('.github/')){full=true;continue;}
  if(file==='appearance.js'){add(file,'appearance','resources','capture');continue;}
  if(file==='style.css'){add(file,'resources','capture');continue;}
  if(file==='panel.html'){add(file,'resources','capture','appearance','preview');continue;}
  if(file==='capture-status.js'||file==='devtools.js'||file==='devtools.html'){add(file,'resources','capture');continue;}
  if(['panel.js','developer.js','viewer.js','viewer-expanded.js','layout.js','shortcuts.js','table-ui.js'].includes(file)){
   add(file,'resources','capture','regression');if(['panel.js','viewer.js','viewer-expanded.js'].includes(file))add(file,'display');if(file==='table-ui.js')add(file,'appearance');continue;
  }
  if(['worker.js','json-codec.js','field-patch-core.js'].includes(file)){add(file,'resources','regression','capture','fixtures','fields');if(file==='worker.js')add(file,'display');if(file==='field-patch-core.js')add(file,'mock');continue;}
  if(file.startsWith('field-mock')&&file.endsWith('.js')){add(file,'resources','capture','fields');continue;}
  if(['response-editor.js','response-mock.js','mock-page.js'].includes(file)){add(file,'resources','capture','regression','mock');continue;}
  if(file==='scripts/package.py'||file==='tests/package-archive.py'){add(file,'resources');add(file,'archive');continue;}
  const tests={'tests/display-conversion.cjs':'display','tests/regression.cjs':'regression','tests/capture-startup.cjs':'capture','tests/helpers/capture-panel.cjs':'capture','tests/appearance.cjs':'appearance','tests/field-mock.cjs':'fields','tests/response-mock.cjs':'mock','tests/package-check.cjs':'resources'};
  if(tests[file]){add(file,tests[file]);continue;}
  if(file.startsWith('tests/manual/')){add(file,'fixtures','mock');continue;}
  if(file.startsWith('tests/preview/')){add(file,'preview');continue;}
  // An unmapped dependency must not silently skip verification.
  full=true;
 }
 return {full,suites:[...Object.keys(suites),'archive'].filter(name=>selected.has(name)),reasons};
}
function changed({base,head='HEAD',ci=false,cwd=root}={}){
 const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(ci){
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  if(process.env.GITHUB_EVENT_NAME==='workflow_dispatch'||/^release:/i.test(event.head_commit?.message||''))return {full:true,reason:'手动全量检查或正式发布'};
  base=process.env.GITHUB_EVENT_NAME==='pull_request'?event.pull_request?.base?.sha:event.before;
  head=process.env.GITHUB_SHA||'HEAD';
  if(!base||/^0+$/.test(base))return {full:true,reason:'没有可用比较基线'};
 }
 try{
  if(base){git(['rev-parse','--verify',base+'^{commit}']);git(['rev-parse','--verify',head+'^{commit}']);return {files:git(['diff','--no-renames','--name-only','-z',base,head,'--']).split('\0').filter(Boolean)};}
  const files=[...new Set((git(['diff','--no-renames','--name-only','-z','HEAD','--'])+git(['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean))];
  return {files};
 }catch{return {full:true,reason:'无法确定改动范围，回退完整检查'};}
}
function main(argv=process.argv.slice(2)){
 let files,base,head,ci=false,dry=false;
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--files'){files=argv.slice(i+1).filter(x=>x!=='--dry-run');break;}
  if(argv[i]==='--base')base=argv[++i];else if(argv[i]==='--head')head=argv[++i];else if(argv[i]==='--ci')ci=true;else if(argv[i]==='--dry-run')dry=true;else throw Error('未知参数：'+argv[i]);
 }
 dry ||= argv.includes('--dry-run');
 const change=files?{files}:changed({base,head,ci});const plan=change.full?{full:true,suites:[],reason:change.reason}:select(change.files);
 console.log(JSON.stringify({files:change.files||[],...plan},null,2));if(dry)return;
 const execute=(command,args)=>{const result=spawnSync(command,args,{cwd:root,stdio:'inherit',shell:false});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} 执行失败（${result.status}）`);};
 if(plan.full){
  if(process.env.npm_execpath)execute(process.execPath,[process.env.npm_execpath,'test']);
  else if(process.platform==='win32'){for(const name of Object.keys(suites)){const [, ...args]=suites[name];execute(process.execPath,args);}}
  else execute('npm',['test']);return;
 }
 for(const name of plan.suites){
  console.log(`\n[按改动测试] ${name}`);
  if(name==='archive'){execute(process.platform==='win32'?'python':'python3',['scripts/package.py']);execute(process.platform==='win32'?'python':'python3',['tests/package-archive.py']);}
  else {const [command,...args]=suites[name];execute(command==='node'?process.execPath:command,args);}
 }
 if(!plan.suites.length)console.log('没有需要测试的改动。可使用 npm test 主动执行完整检查。');
}
module.exports={select,changed};
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
