const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>__fixtureReady);
 await page.evaluate(async()=>{const a=DMCStorage.create();await a.installBatch(await a.prepareInstallBatch(await a.read(),[__fixture.pack('A','2'),__fixture.pack('New')]));});
 await page.addScriptTag({path:path.join(__dirname,'../src/storage.js')});
 assert.equal(await page.evaluate(async()=>(await DMCStorage.create().readRecovery()).pendingRestart),false,'new module session recognizes persisted record');
 const count=await page.evaluate(async()=>{
  const a=DMCStorage.create(),f=__fixture,k='DoLModCenter.recovery.v1';let count=0;
  const dump=()=>f.loader.customStore('readonly',s=>new Promise(r=>{let keys,values;const done=()=>{if(keys&&values)r(JSON.stringify([keys,values]))};const q=s.getAllKeys(),v=s.getAll();q.onsuccess=()=>{keys=q.result;done()};v.onsuccess=()=>{values=v.result;done()}}));
  const get=key=>f.loader.customStore('readonly',s=>new Promise(r=>{const q=s.get(key);q.onsuccess=()=>r(q.result)}));
  async function rejects(fn,label){const before=await dump();let failed=false;try{await fn()}catch{failed=true}if(!failed)throw Error(label+' unexpectedly succeeded');if(await dump()!==before)throw Error(label+' wrote data');count++;}
  const record=await get(k),raw=await get('enabled-custom');
  await f.seed([['enabled-custom',' '+raw]]);await rejects(()=>a.prepareRecovery(),'raw-only edit');await f.seed([['enabled-custom',raw]]);
  for(const [name,data] of [['fixture-package:A',f.pack('A','9')],['fixture-package:Other',f.pack('Other')],['fixture-package:B',undefined]]){
   const old=await get(name);await f.seed([[name,data]]);await rejects(()=>a.prepareRecovery(),'external package '+name);await f.seed([[name,old]]);
  }
  for(const alter of [r=>r.previous.push({name:'Absent',data:null,sha256:null}),r=>r.previous.push({...r.previous[0]}),r=>r.previous[0].sha256='0'.repeat(64),r=>r.previous[0].data='!!!!',r=>r.expected='bad']){
   const r=structuredClone(record);alter(r);await f.seed([[k,r]]);await rejects(()=>a.prepareRecovery(),'corrupt recovery');await f.seed([[k,record]]);
  }
  const token=await a.prepareRecovery();await f.seed([['disabled-custom','["C","Other"]']]);await rejects(()=>a.rollbackRecovery(token),'post-confirm config race');await f.seed([['disabled-custom','["C"]']]);
  await a.rollbackRecovery(await a.prepareRecovery());if((await a.details('A')).version!=='1.0.0')throw Error('old bytes not restored');count++;
  const state=await a.read(),before=await dump(),many=Array.from({length:2000},(_,i)=>'M'+i);await f.seed([['enabled-custom',JSON.stringify(many)]]);await rejects(async()=>a.prepareInstallBatch(await a.read(),[f.pack('OneTooMany')]),'2000 boundary');await f.seed([['enabled-custom',JSON.stringify(state.enabled)]]);
  // Two independent instances receive plans before either commits.
  const b=DMCStorage.create(),s=await a.read(),x=await a.prepareInstallBatch(s,[f.pack('X')]),y=await b.prepareInstallBatch(s,[f.pack('Y')]);const result=await Promise.allSettled([a.installBatch(x),b.installBatch(y)]);if(result.filter(x=>x.status==='fulfilled').length!==1)throw Error('two instance race');count++;
  return count;
 });
 await page.addScriptTag({path:path.join(__dirname,'../src/storage.js')});
 await page.addScriptTag({path:path.join(__dirname,'../src/startup-recovery.js')});
 await page.locator('#dmc-startup-recovery').waitFor();
 const before=await page.evaluate(async()=>JSON.stringify(await DMCStorage.create().read()));
 await page.evaluate(()=>dispatchEvent(new ErrorEvent('error',{message:'synthetic startup error'})));
 await page.getByRole('button',{name:'检查启动恢复',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal(await page.evaluate(async()=>JSON.stringify(await DMCStorage.create().read())),before,'error and cancel never auto rollback');
 await page.getByRole('button',{name:'检查启动恢复',exact:true}).click();await page.getByRole('button',{name:'确认恢复模组配置',exact:true}).click();await page.getByText('模组配置已恢复，请手动重启游戏。',{exact:true}).waitFor();
 await page.evaluate(async()=>{
  const api=DMCStorage.create(),f=__fixture,original=f.loader.customStore.bind(f.loader);
  async function race(operation){let injected=false;f.loader.customStore=(mode,fn)=>Promise.resolve(original(mode,fn)).then(async result=>{if(mode==='readwrite'&&!injected){injected=true;await original('readwrite',store=>new Promise((resolve,reject)=>{const q=store.get('enabled-custom');q.onsuccess=()=>store.put(' '+q.result,'enabled-custom');store.transaction.oncomplete=resolve;store.transaction.onabort=reject}));}return result});try{let failure;try{await operation()}catch(e){failure=e}if(!failure||!/回读/.test(failure.message))throw Error('post-commit raw race was not reported');}finally{f.loader.customStore=original}}
  const plan=await api.prepareInstallBatch(await api.read(),[f.pack('PostRace')]);await race(()=>api.installBatch(plan));await api.dismissRecovery((await api.readRecovery()).id);
  await api.installBatch(await api.prepareInstallBatch(await api.read(),[f.pack('PostRace','2')]));const rollback=await api.prepareRecovery();await race(()=>api.rollbackRecovery(rollback));
 });
 await page.evaluate(()=>{DMCStartupRecovery.destroy();return __fixture.cleanup()});console.log('PASS recovery boundaries '+count+' storage cases + cross-session prompt, error/cancel no writes, explicit recovery');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
