'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {select}=require('../scripts/test-changed.cjs');
test('documentation-only changes run document checks without functional suites',()=>{const p=select(['README.md','docs/USAGE.md']);assert(!p.full);assert.deepEqual(p.suites,['docs']);});
test('appearance changes exclude worker and response engine tests but protect capture startup',()=>{const p=select(['appearance.js','style.css']);assert(!p.full);assert.deepEqual(p.suites,['resources','capture','appearance']);});
test('capture changes select startup and relevant regression coverage',()=>{assert.deepEqual(select(['capture-status.js']).suites,['resources','capture']);const p=select(['panel.js']);assert(p.suites.includes('regression'));assert(p.suites.includes('capture'));assert(!p.suites.includes('mock'));});
test('shared parsing dependencies include consumers and unions are deduplicated',()=>{const p=select(['worker.js','appearance.js','worker.js']);for(const s of ['capture','regression','fixtures','fields','appearance'])assert(p.suites.includes(s));assert.equal(new Set(p.suites).size,p.suites.length);assert(!p.full);});
test('unknown files and configuration changes fall back to the full suite',()=>{for(const name of ['new-engine.js','manifest.json','package.json','.github/workflows/ci.yml','scripts/test-changed.cjs'])assert(select([name]).full,name);});
test('test-file changes select their own suite and packaging scripts select archive checks',()=>{assert.deepEqual(select(['tests/capture-startup.cjs','tests/helpers/capture-panel.cjs']).suites,['capture']);assert.deepEqual(select(['scripts/package.py']).suites,['resources','archive']);assert.deepEqual(select([]).suites,[]);});

test('working-tree detection includes staged, unstaged, deleted and untracked files',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atv-select-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git('init');for(const name of ['appearance.js','style.css','old.js'])fs.writeFileSync(path.join(dir,name),'before');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','baseline');
 fs.writeFileSync(path.join(dir,'appearance.js'),'after');git('add','appearance.js');fs.writeFileSync(path.join(dir,'style.css'),'after');fs.unlinkSync(path.join(dir,'old.js'));fs.writeFileSync(path.join(dir,'new.js'),'new');
 const {changed}=require('../scripts/test-changed.cjs');assert.deepEqual(changed({cwd:dir}).files.sort(),['appearance.js','new.js','old.js','style.css']);
 git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','change');assert.deepEqual(changed({cwd:dir}).files,[]);assert(changed({cwd:dir,base:'HEAD~1'}).files.includes('appearance.js'));
});
test('missing comparison history fails closed to full verification',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atv-no-git-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {changed}=require('../scripts/test-changed.cjs');assert.equal(changed({cwd:dir,base:'missing'}).full,true);
});
