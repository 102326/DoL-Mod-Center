const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),JSZip=require('jszip');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
 await page.evaluate(()=>{window.nativeTestName='DMC_NATIVE_'+crypto.randomUUID();window.modLoaderKeyConfigWinHookFunction=c=>{
  c.config.set('ModLoader_IndexDBLoader',nativeTestName);c.config.set('keyval',nativeTestName);c.config.set('modDataIndexDBZipList','test-enabled');c.config.set('modDataIndexDBZipListHidden','test-disabled');c.config.set('modDataIndexDBZipPrefix','test-package');
 };});
 await page.addScriptTag({path:path.join(__dirname,'native-loader.fixture.js')});
 const packages={};for(const name of ['Alpha','Beta']){const z=new JSZip();z.file('boot.json',JSON.stringify({name,version:'1.0.0',scriptFileList:[],styleFileList:[],tweeFileList:[],imgFileList:[]}));z.file('README.md','# '+name);packages[name]=Array.from(await z.generateAsync({type:'uint8array',compression:'DEFLATE'}));}
 const output=await page.evaluate(async packages=>{
  const api=DMCStorage.create(),loader=modUtils.getModLoader().getIndexDBLoader(),cls=loader.constructor;
  if(!cls.dbName.startsWith('DMC_NATIVE_')||!cls.storeName.startsWith('DMC_NATIVE_'))throw Error('Unsafe test database');
  const seed=entries=>loader.customStore('readwrite',store=>new Promise((resolve,reject)=>{for(const [k,v]of entries)store.put(v,k);store.transaction.oncomplete=resolve;store.transaction.onabort=()=>reject(store.transaction.error);}));
  const fail=async(fn,pattern)=>{try{await fn();throw Error('Expected rejection');}catch(e){if(!pattern.test(e.message))throw e;}};
  for(const name of Object.keys(packages)){const bytes=new Uint8Array(packages[name]);await api.install(await api.prepare(await api.read(),name),bytes);}
  const catalog=await api.catalog(await api.read());if(catalog.items.length!==2)throw Error('Native ZIP catalog missing packages');
  await api.reorderCatalog(catalog,['Beta','Alpha']);
  if(JSON.stringify((await api.read()).enabled)!=='["Beta","Alpha"]')throw Error('Native catalog reorder failed');
  const sv=modSC2DataManager.getDependenceChecker().getInfiniteSemVerApi();
  const plan=DMCSort.plan([{name:'Alpha',bootJson:{version:'1.0.0',dependenceInfo:[{modName:'Beta',version:'>=2.0.0'}]}},{name:'Beta',bootJson:{version:'1.0.0'}}],{checkVersion:(v,r)=>sv.satisfies(sv.parseVersion(v).version,sv.parseRange(r))});
  if(!plan.errors.length)throw Error('Native version rejection not applied');
  await api.toggle(await api.read(),'Beta',false);
  await seed([['unrelated','keep-me']]);const backup=await api.backup();
  if(backup.packages.length!==2)throw Error('Backup incomplete');
  await api.remove(await api.prepare(await api.read(),'Alpha'),'Alpha');
  await api.restore(await api.prepareRestore(backup));
  if(JSON.stringify((await api.read()).enabled)!=='["Alpha"]')throw Error('Restore lists mismatch');
  await loader.load();if(!loader.modList.some(m=>m.modInfo?.name==='Alpha'||m.modInfo?.bootJson?.name==='Alpha'))throw Error('Native loader did not read restored package');
  const unrelated=await loader.customStore('readonly',store=>new Promise(resolve=>{const r=store.get('unrelated');r.onsuccess=()=>resolve(r.result);}));if(unrelated!=='keep-me')throw Error('Unrelated key changed');
  const damaged=structuredClone(backup);damaged.packages[0].sha256='0'.repeat(64);await fail(()=>api.prepareRestore(damaged),/哈希/);
  const duplicate=structuredClone(backup);duplicate.packages.push(duplicate.packages[0]);await fail(()=>api.prepareRestore(duplicate),/重复/);
  const token=await api.prepareRestore(backup);await api.toggle(await api.read(),'Alpha',false);await fail(()=>api.restore(token),/变化/);
  const before=await api.backup(),restorePlan=await api.prepareRestore(backup),real=loader.customStore;
  loader.customStore=(mode,callback)=>real(mode,store=>callback(mode!=='readwrite'?store:new Proxy(store,{get(t,p){if(p==='put')return()=>{throw Error('forced quota failure');};const v=t[p];return typeof v==='function'?v.bind(t):v;}})));
  await fail(()=>api.restore(restorePlan),/quota/);loader.customStore=real;
  const after=await api.backup();if(JSON.stringify([before.enabled,before.disabled,before.packages])!==JSON.stringify([after.enabled,after.disabled,after.packages]))throw Error('Rollback incomplete');
  // Preserve embedded references, but never trust arbitrary runtime-only entries.
  const ml=modUtils.getModLoader(),originalCache=ml.getModCacheOneArray;
  let refs=[{name:'Embedded',from:'Local',mod:{bootJson:{name:'Embedded',version:'1.0'}}}];
  ml.getModCacheOneArray=()=>refs;
  await seed([[cls.modDataIndexDBZipList,JSON.stringify(['Embedded','Alpha'])],[cls.modDataIndexDBZipListHidden,JSON.stringify(['Beta'])]]);
  const withPreload=await api.backup();
  if(withPreload.preloaded.length!==1||withPreload.packages.length!==2)throw Error('Preload backup failed');
  const preToken=await api.prepareRestore(withPreload);if(preToken.orphans!==0)throw Error('Incorrect orphan count');
  await api.restore(preToken);
  if(JSON.stringify((await api.read()).enabled)!=='["Embedded","Alpha"]')throw Error('Preload order changed');
  await seed([[cls.modDataIndexDBZipList,JSON.stringify(['Alpha'])],[cls.modDataIndexDBZipListHidden,JSON.stringify(['Embedded','Beta'])]]);
  const disabledPreload=await api.backup();await api.restore(await api.prepareRestore(disabledPreload));
  if(JSON.stringify((await api.read()).disabled)!=='["Embedded","Beta"]')throw Error('Disabled preload changed');
  refs.push({name:'Alpha',from:'Local',mod:{bootJson:{name:'Alpha',version:'old'}}});
  if((await api.backup()).preloaded.some(p=>p.name==='Alpha'))throw Error('Stored override mistaken for external');
  refs.pop();
  const stalePreload=await api.prepareRestore(withPreload);
  refs[0].mod.bootJson.version='2.0';await fail(()=>api.restore(stalePreload),/相同版本/);
  await fail(()=>api.prepareRestore(withPreload),/相同版本/);
  refs[0].from='IndexDB';await fail(()=>api.backup(),/Embedded/);
  refs=[];await fail(()=>api.prepareRestore(withPreload),/Embedded/);
  const forged=structuredClone(withPreload);forged.preloaded.push(forged.preloaded[0]);await fail(()=>api.prepareRestore(forged),/重复/);
  await seed([[cls.modDataIndexDBZipList,JSON.stringify(['Alpha'])]]);
  const legacy=structuredClone(backup);legacy.schema='DoLModCenter.full.v1';delete legacy.preloaded;
  await api.restore(await api.prepareRestore(legacy));
  ml.getModCacheOneArray=originalCache;
  console.log('PASS preload order, target version/source checks, stale preload, duplicates, legacy v1 restore');
  await api.toggle(await api.read(),'Alpha',true);const snapshot=await api.read();await api.disableAll(snapshot);const rescued=await api.read();if(rescued.enabled.length||rescued.packages.length!==2)throw Error('Rescue deleted bytes');
  await fail(()=>api.disableAll(snapshot),/变化/);
  return {version:modUtils.version,db:cls.dbName,checks:'native ZIP install/toggle/delete/restore; full bytes/hash/list backup; malformed archive; stale restore; forced failure rollback; unrelated key preserved; atomic rescue'};
 },packages);assert.equal(output.version,'2.101.1');console.log('PASS',output.checks);
 // Exercise backup UI against native storage in the isolated database.
 await page.locator('#dmc-sidebar-button').click();await page.getByRole('button',{name:'完整备份',exact:true}).click();
 assert.ok(await page.getByLabel('选择完整备份').isDisabled());
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前完整备份'}).click();
 const backupPath=await (await download).path();assert.equal(JSON.parse(fs.readFileSync(backupPath,'utf8')).schema,'DoLModCenter.full.v2');
 await page.getByLabel('选择完整备份').setInputFiles(backupPath);await page.waitForFunction(()=>document.querySelector('.dmc-backups').textContent.includes('校验通过'));
 assert.ok(await page.getByRole('button',{name:'恢复这份备份'}).isDisabled());
 await page.getByLabel('已保存刚导出的当前备份',{exact:false}).check();await page.getByRole('button',{name:'恢复这份备份'}).click();
 await page.waitForFunction(()=>document.querySelector('.dmc-backups').textContent.includes('恢复已提交'));await page.getByRole('button',{name:'关闭',exact:true}).click();
 // Gate test uses the actual loader interface but never starts game or mod scripts.
 await page.addScriptTag({path:path.join(__dirname,'../src/startup.js')});
 await page.evaluate(()=>{window.startedCount=0;DMCStartup.wait().then(()=>startedCount++);});assert.equal(await page.evaluate(()=>startedCount),0);
 assert.equal(await page.evaluate(()=>modModLoadController.canLoadThisMod({name:'DoLModCenter'},null)),false);
 assert.equal(await page.evaluate(()=>modModLoadController.canLoadThisMod({name:'Alpha'},null)),true);
 await assert.rejects(()=>page.evaluate(()=>modModLoadController.removeModIndexDB('Alpha')),/统一存储/);
 await page.getByRole('button',{name:'停用全部旁加载模组'}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>startedCount),0);
 await page.getByRole('button',{name:'启动游戏',exact:true}).click();assert.equal(await page.evaluate(()=>startedCount),1);
 await page.evaluate(()=>DMCStartup.failure(Error('Synthetic preload failure')));assert.ok(await page.locator('#dmc-startup').isVisible());
 console.log('PASS startup gate, retained failure rescue and legacy write blocking');
 await page.evaluate(()=>{DoLModCenter.destroy();return __fixture.cleanup();});
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
