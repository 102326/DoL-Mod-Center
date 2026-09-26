const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
 const checks=await page.evaluate(async()=>{
  const api=DMCStorage.create(),f=__fixture,checks=[];
  const eq=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label);checks.push(label);};
  const fail=async(fn,pattern)=>{try{await fn();throw Error('unexpected success');}catch(e){if(!pattern.test(e.message))throw e;checks.push(pattern.source);}};
  const cat=await api.catalog(await api.read());eq(cat.items.map(x=>x.name),['A','B','C'],'catalog all enabled and disabled packages');
  eq(cat.items[0].version,'1.0.0','stored version parsed');
  await fail(()=>api.reorderCatalog(cat,['A','A']),/名单/);
  await fail(()=>api.reorderCatalog(cat,['B']),/名单/);
  const state=await api.reorderCatalog(cat,['B','A']);eq(state.enabled,['B','A'],'atomic full reorder');eq(state.disabled,['C'],'disabled preserved');
  eq([...await api.exportZip('A')],[...f.pack('A')],'package bytes untouched');
  await fail(()=>api.reorderCatalog(cat,['A','B']),/失效/);
  const stale=await api.catalog(state);await f.seed([['fixture-package:A',f.pack('A','2.0.0')]]);
  await fail(()=>api.reorderCatalog(stale,['A','B']),/包体已变化/);
  eq((await api.read()).enabled,['B','A'],'stale same-name replacement blocked');
  const staleList=await api.catalog();await api.toggle(await api.read(),'C',true);
  await fail(()=>api.reorderCatalog(staleList,['A','B']),/变化/);
  const token=await api.catalog(),real=f.loader.customStore.bind(f.loader);
  f.loader.customStore=(mode,callback)=>real(mode,store=>callback(mode==='readwrite'?new Proxy(store,{get(t,k){if(k==='put')return()=>{throw Error('forced sorting quota failure');};const v=t[k];return typeof v==='function'?v.bind(t):v;}}):store));
  await fail(()=>api.reorderCatalog(token,['C','A','B']),/quota/);f.loader.customStore=real;
  eq((await api.read()).enabled,['B','A','C'],'write failure preserved order');
  modUtils.version='unknown';await fail(()=>api.reorderCatalog(token,['C','A','B']),/只读/);modUtils.version='2.101.1';
  await f.seed([['fixture-package:A',new Uint8Array([0])]]);const broken=await api.catalog();if(!broken.items.find(x=>x.name==='A').error)throw Error('broken metadata not reported');checks.push('broken package visible not filtered');
  await f.seed([['fixture-package:A',f.pack('A')],['enabled-custom','["B","A"]'],['disabled-custom','["C"]']]);return checks;
 });console.log('PASS',checks);
 // Full user flow with metadata, explicit dependency and beauty fallback.
 await page.evaluate(async()=>{
  const pack=b=>new TextEncoder().encode(JSON.stringify({version:'1.0.0',...b}));
  await __fixture.seed([['fixture-package:B',pack({name:'B',dependenceInfo:[{modName:'A',version:'*'}]})],['fixture-package:C',pack({name:'C',imgFileList:['img.png'],scriptFileList:[],styleFileList:[],tweeFileList:[]})],['enabled-custom','["C","B","A"]'],['disabled-custom','[]']]);
  DoLModCenter.open();
 });
 await page.getByRole('button',{name:'按前置排序',exact:true}).click();
 await page.waitForSelector('.dmc-sort-preview');assert.deepEqual(await page.locator('.dmc-sort-preview li').allTextContents(),['A　3 → 1','B　2 → 2','C　1 → 3']);
 await page.getByRole('button',{name:'应用此顺序',exact:true}).click();
 await page.waitForFunction(async()=>JSON.stringify((await DMCStorage.create().read()).enabled)==='["A","B","C"]');
 await page.waitForSelector('.dmc-sort-list');assert.ok((await page.locator('.dmc-sort-list').textContent()).includes('图片包'));
 await page.evaluate(()=>__fixture.cleanup());console.log('PASS sorting preview/apply UI and image label');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
