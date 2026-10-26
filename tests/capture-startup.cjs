'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPanel,request}=require('./helpers/capture-panel.cjs');
async function assertCaptured(panel,url){await panel.request(request(url));assert.equal(panel.run(`requests.filter(item=>item.url===${JSON.stringify(url)}).length`),1);assert(panel.ids.get('requestList').children.length>0,'request must reach the visible list');}
for(const readyState of ['loading','complete'])test(`full HTML startup registers capture without UI interaction (${readyState})`,async t=>{
 const p=createPanel({readyState});t.after(()=>p.dispose());await p.boot();assert.equal(p.listeners,1);assert.equal(p.attempts,1);assert.equal(p.harCalls,1);
 for(const url of ['http://localhost/api/boot','http://localhost:5173/api/boot','http://127.0.0.1:8765/api/boot','https://example.test/api/boot'])await assertCaptured(p,url);
 assert.match(p.ids.get('captureStatus').textContent,/监听中/);
});
test('theme changes, layout toggles and repeated starts do not duplicate or disable listeners',async t=>{
 const p=createPanel();t.after(()=>p.dispose());await p.boot();p.ids.get('appearanceThemeHex').value='#e2e9df';p.ids.get('appearanceThemeHex').oninput();p.ids.get('toggleSidebar').onclick();p.ids.get('toggleDetailControls').onclick();
 p.run('startNetworkCapture();startNetworkCapture()');await p.advance();assert.equal(p.listeners,1);assert.equal(p.attempts,1);assert.equal(p.harCalls,1);await assertCaptured(p,'http://localhost/api/after-ui');
});
test('historical empty body can finish later and HAR/finished duplicates insert only once',async t=>{
 const early=request('http://localhost/api/early','');const p=createPanel({har:[early]});t.after(()=>p.dispose());await p.boot();assert.equal(p.run('requests.length'),0);
 await p.request(request('http://localhost/api/early'));await p.request(request('http://localhost/api/early'));await p.advance(2000);assert.equal(p.run('requests.length'),1);
});
test('a failed HAR lookup leaves new-request capture active',async t=>{
 const p=createPanel({harError:true});t.after(()=>p.dispose());await p.boot();await assertCaptured(p,'http://localhost/api/after-har-error');assert.equal(p.listeners,1);
});
test('registration failure is visible and a successful retry starts capture',async t=>{
 const p=createPanel({registrationError:true});t.after(()=>p.dispose());await p.boot();assert.equal(p.listeners,0);assert.match(p.ids.get('captureStatus').textContent,/registration blocked/);
 p.setRegistrationError(false);p.run('startNetworkCapture()');await p.advance();await assertCaptured(p,'http://localhost/api/recovered');assert.equal(p.listeners,1);
});
test('late initial HAR responses cannot repopulate a cleared list',async t=>{
 const p=createPanel({deferHar:true});t.after(()=>p.dispose());await p.boot();const clearing=p.ids.get('clearBtn').onclick();await p.advance();await clearing;
 p.deliverHar([request('http://localhost/api/stale')]);await p.advance();assert.equal(p.run('requests.length'),0);await assertCaptured(p,'http://localhost/api/new');
});
test('unreadable content retries are bounded and clearing cancels pending retry work',async t=>{
 let reads=0;const p=createPanel();t.after(()=>p.dispose());await p.boot();await p.request(request('http://localhost/api/unreadable','',{getContent:done=>{reads++;done('','');}}));await p.advance(2000);assert.equal(reads,4);await p.advance(2000);assert.equal(reads,4);
 let cancelled=0;await p.request(request('http://localhost/api/cancel','',{getContent:done=>{cancelled++;done('','');}}));const clearing=p.ids.get('clearBtn').onclick();await p.advance();await clearing;await p.advance(2000);assert.equal(cancelled,1);await assertCaptured(p,'http://localhost/api/still-active');
});
test('invalid JSON is isolated from later valid responses',async t=>{
 const p=createPanel();t.after(()=>p.dispose());await p.boot();await p.request(request('http://localhost/api/bad','{bad}'));assert.equal(p.run('requests.length'),0);await assertCaptured(p,'http://localhost/api/good');
});
test('startup regression is detected when registration is accidentally moved behind activateTab',async t=>{
 const source=fs.readFileSync(path.join(__dirname,'../panel.js'),'utf8');
 const hook="if(document.readyState==='loading')document.addEventListener(\"DOMContentLoaded\",startNetworkCapture,{once:true});\nelse setTimeout(startNetworkCapture,0);";
 assert(source.includes(hook),'update this mutation when startup wiring changes');
 const broken=source.replace(hook,'').replace('function activateTab(name){','function activateTab(name){ startNetworkCapture();');
 const p=createPanel({overrides:{'panel.js':broken}});t.after(()=>p.dispose());await p.boot();
 await assert.rejects(()=>assertCaptured(p,'http://localhost/api/not-started'),assert.AssertionError);
});
