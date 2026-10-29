'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const version=require('../package.json').version,sha='1'.repeat(40),dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-metadata-'));
try{
 const eventPath=path.join(dir,'event.json');
 fs.writeFileSync(eventPath,JSON.stringify({head_commit:{id:sha,message:'release: publish v'+version}}));
 const result=spawnSync(process.execPath,['scripts/release-metadata.cjs'],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_EVENT_PATH:eventPath,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha}});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,new RegExp('RELEASE_TAG=v'+version.replaceAll('.','\\.')));
 assert.match(result.stdout,new RegExp('RELEASE_TITLE=v'+version.replaceAll('.','\\.')+'：'));
 console.log('PASS release metadata matches the CI publication contract');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
