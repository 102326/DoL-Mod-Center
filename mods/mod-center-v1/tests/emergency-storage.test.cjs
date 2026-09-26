'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage();await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);
  await page.waitForFunction(()=>window.__fixtureReady);
  const result=await page.evaluate(async()=>{
   const api=DMCStorage.create(window), f=__fixture, out=[];
   const ok=(condition,label)=>{if(!condition)throw Error(label);out.push(label);};
   let archive=await api.emergencyBackup();
   ok(archive.schema==='DoLModCenter.emergency.v1','distinct emergency schema');
   ok(archive.restorable===false && archive.completePackageCapture===true,'explicit non-restorable complete capture');
   ok(archive.packages.every(p=>p.data&&/^[A-Za-z0-9+/=]+$/.test(p.data)&&p.sha256),'bytes and sha256 captured');
   ok(archive.packages.every(p=>p.validation.status==='valid'),'native validation status captured');
   ok(Array.isArray(archive.exclusions)&&archive.exclusions.join(',')==='saves,game,embeddedPackages,typeconfigs,caches','sensitive exclusions disclosed');
   await f.seed([['enabled-custom','["A","Missing"]'],['disabled-custom','not-json'],['fixture-package:Broken',new Uint8Array([1,2,3])],['fixture-package:Unreadable',{bad:true}]]);
   archive=await api.emergencyBackup();
   ok(archive.completePackageCapture===false,'malformed capture is incomplete');
   ok(archive.config.enabled.valid===true && archive.config.disabled.valid===false,'raw config remains independently reportable');
   ok(archive.config.missing.includes('Missing'),'missing configured reference reported');
   const broken=archive.packages.find(p=>p.name==='Broken'), unreadable=archive.packages.find(p=>p.name==='Unreadable');
   ok(broken.capture==='complete'&&broken.data&&broken.validation.status==='invalid','corrupt readable bytes preserved with validation issue');
   ok(unreadable.capture==='unreadable'&&!unreadable.data,'unreadable package reported without invented bytes');
   await f.seed([['enabled-custom','x'.repeat(70000)],['disabled-custom','[]']]);
   archive=await api.emergencyBackup();
   ok(archive.config.enabled.raw.truncated===true&&archive.config.enabled.raw.value.length===65536,'raw config report capped');
   window.modUtils.getModLoader=()=>({getIndexDBLoader:()=>f.loader,getModCacheOneArray:()=>[{name:'RuntimeOnly',from:'Local',mod:{bootJson:{name:'RuntimeOnly',version:'9.0.0'}}}]});
   archive=await api.emergencyBackup();
   ok(archive.preloaded.length===1&&archive.preloaded[0].name==='RuntimeOnly','runtime preloaded metadata kept separate');
   let rejected=false;try{await api.prepareRestore(archive);}catch(error){rejected=/备份格式/.test(error.message);}
   ok(rejected,'emergency schema rejected by restore preparation');
   await f.cleanup();return out;
  });
  assert.equal(result.length,13);console.log('PASS '+result.length+' emergency storage assertions\n'+result.join('\n'));
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
