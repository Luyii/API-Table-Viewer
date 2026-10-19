const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);assert(fs.existsSync(path.join(root,manifest.devtools_page)));
const scripts=[];
for(const file of ['devtools.html','panel.html']){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size,'Duplicate HTML identifiers');
  assert(!/\bon\w+=/i.test(html),'Inline event handler violates extension CSP');
  for(const match of html.matchAll(/<(script|link)\b[^>]*(?:src|href)="([^"]+)"/g)){
    assert(!/^(https?:|data:|\/\/)/.test(match[2]),'Unexpected external code asset');assert(fs.existsSync(path.join(root,match[2])),match[2]);
    if(match[1]==='script' && file==='panel.html')scripts.push(match[2]);
  }
}
for(const file of fs.readdirSync(root).filter(x=>x.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
// Check the actual shared page scope, so conflicting top-level declarations fail here.
new vm.Script(scripts.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n;\n'));
for(const match of fs.readFileSync(path.join(root,'worker.js'),'utf8').matchAll(/importScripts\('([^']+)'\)/g))assert(fs.existsSync(path.join(root,match[1])));
console.log(`PASS manifest ${manifest.version}, HTML identifiers, asset files, CSP, JavaScript syntax and page scope`);
