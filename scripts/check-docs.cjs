'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):entry.name.endsWith('.md')?[path.join(dir,entry.name)]:[]);}
function anchors(text){
 const used=new Map(),result=new Set();let code=false;
 for(const line of text.split('\n')){
  if(/^```/.test(line)){code=!code;continue;}if(code)continue;
  const match=/^#{1,6}\s+(.+?)\s*#*$/.exec(line);if(!match)continue;
  const title=match[1].replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').toLowerCase();
  const slug=title.replace(/[^\p{L}\p{N}\p{M}_ -]/gu,'').replaceAll(' ','-');const n=used.get(slug)||0;used.set(slug,n+1);result.add(slug+(n?'-'+n:''));
 }
 return result;
}
const files=[...fs.readdirSync(root).filter(n=>n.endsWith('.md')).map(n=>path.join(root,n)),...walk(path.join(root,'docs'))];
for(const file of files){
 const text=fs.readFileSync(file,'utf8');
 const withoutCode=text.replace(/```[\s\S]*?```/g,'');
 assert.equal((withoutCode.match(/^# /gm)||[]).length,1,`${file}: 一级标题数量`);
 for(const [,link] of withoutCode.matchAll(/(?<!!)\]\(([^)]+)\)/g)){
  if(/^[a-z][\w+.-]*:/i.test(link))continue;
  const [name,fragment]=link.split('#'),target=name?path.resolve(path.dirname(file),decodeURIComponent(name)):file;
  assert(fs.existsSync(target),`${file}: 文件不存在 ${link}`);
  if(fragment&&target.endsWith('.md'))assert(anchors(fs.readFileSync(target,'utf8')).has(decodeURIComponent(fragment)),`${file}: 锚点不存在 ${link}`);
 }
}
console.log(`PASS ${files.length} 份文档的本地链接、锚点与标题检查`);
