'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright'),JSZip=require('jszip');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
  await page.addScriptTag({path:require.resolve('jszip/dist/jszip.min.js')}); // Test-only; not shipped.
  const content='# README\n<img src="https://example.invalid/track" onerror="window.pwned=1">\n<script>window.pwned=2</script>\n<<run window.pwned=3>>\n![badge](https://example.invalid/badge)\n中文说明';
  const make=async(files,compression='DEFLATE')=>{const z=new JSZip();for(const [n,v]of Object.entries(files))z.file(n,v);return Array.from(await z.generateAsync({type:'uint8array',compression}));};
  const inspect=data=>page.evaluate(data=>DMCReadme.read(new Uint8Array(data)),data);
  const archive=await make({'README.md':content,'docs/README.txt':'secondary','boot.json':JSON.stringify({name:'C',version:'1.0.0',author:'Test author',homepage:'https://example.org/info',repository:'javascript:alert(1)',dependenceInfo:[{modName:'Example',version:'>=1'}]})});
  assert.equal((await inspect(archive)).text,content);
  assert.equal((await inspect(await make({'readme.txt':'stored'},'STORE'))).text,'stored');
  assert.equal((await inspect(await make({'docs/README.zh-CN.md':'localized'}))).text,'localized');
  assert.match((await inspect(await make({'payload.js':'no documentation'}))).message,/未找到/);
  assert.match((await inspect(await make({'README.md':'x'.repeat(262145)}))).message,/超过/);
  assert.match((await inspect([1,2,3])).message,/不可读/);
  const corrupted=await make({'README.md':'checksum'},'STORE');
  const signature=Buffer.from(corrupted).indexOf(Buffer.from('checksum'));corrupted[signature]^=1;
  assert.match((await inspect(corrupted)).message,/校验/);
  assert.match((await inspect(await make({'README.md':Buffer.from([0xff,0xfe,0x00])}))).message,/不可读/);
  assert.equal(await page.evaluate(()=>DMCReadme.choose(['../README.md','/README.md','a\\README.md'])),undefined);
  const loaded=await page.evaluate(async data=>DMCReadme.loaded(await JSZip.loadAsync(new Uint8Array(data))),archive);
  assert.equal(loaded.text,content);
  assert.match(await page.evaluate(async()=> (await DMCReadme.loaded({files:{'README.md':{}},file:()=>({async:()=>{throw Error('must not call');}})})).message),/不支持/);
  const big=await make({'README.md':'x'.repeat(262145)});
  assert.match(await page.evaluate(async data=>(await DMCReadme.loaded(await JSZip.loadAsync(new Uint8Array(data)))).message,big),/超过/);
  await page.evaluate(async data=>{
   await __fixture.seed([['fixture-package:C',new Uint8Array(data)]]);
   modModLoadController.checkModZipFileIndexDB=async bytes=>JSON.parse(await (await JSZip.loadAsync(bytes)).file('boot.json').async('string'));
   const zip=await JSZip.loadAsync(new Uint8Array(data));modUtils.getModZip=()=>({getZipFile:()=>zip});
  },archive);
  assert.equal(await page.evaluate(async()=> (await DMCStorage.create().details('C')).readme.text),content);
  assert.equal(await page.evaluate(async()=> (await DMCStorage.create().loadedDetails('A')).readme.text),content);
  await page.evaluate(()=>{const wrapper=modUtils.getModZip();modUtils.getModZip=()=>wrapper.getZipFile();});
  assert.equal(await page.evaluate(async()=> (await DMCStorage.create().loadedDetails('A')).readme.text),content);
  await page.locator('#dmc-sidebar-button').click();
  const card=page.locator('.dmc-card').filter({has:page.locator('.dmc-card-head strong').filter({hasText:/^C$/})});
  await card.getByRole('button',{name:'详情',exact:true}).click();const detail=page.locator('.dmc-detail-page');await detail.locator('.dmc-readme').waitFor();
  assert.equal(await detail.locator('.dmc-readme-source pre').textContent(),content);assert.equal(await detail.locator('.dmc-readme h1').textContent(),'README');
  assert.equal(await detail.locator('.dmc-readme img,.dmc-readme script').count(),0);
  assert.equal(await page.evaluate(()=>window.pwned),undefined);
  const links=detail.locator('.dmc-reference-links a');assert.equal(await links.count(),2);
  assert.equal(await links.first().getAttribute('rel'),'noopener noreferrer');
  for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/a','https://u:p@example.org/','https://example.org/a.zip','https://example.org/releases/download/tag/file','https://example.org/\npage'])assert.equal(await page.evaluate(url=>DMCModInfo.safeUrl(url),url),null);
  for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});assert.ok(await detail.evaluate(e=>e.scrollWidth<=e.clientWidth+1));}
  await page.setViewportSize({width:390,height:844});await detail.scrollIntoViewIfNeeded();fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-results/readme-mobile.png')});
  await page.evaluate(()=>{window.cordova={};});await links.first().click();assert.match(await detail.innerText(),/复制上方地址/);
  await page.evaluate(()=>{cordova.InAppBrowser={open:(...args)=>window.externalOpened=args};});await links.first().click();
  assert.deepEqual(await page.evaluate(()=>window.externalOpened),['https://example.org/info','_system']);
  assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
  // Read-only real local ZIP check; no game boot, imports or user database writes.
  for(const filename of process.argv.slice(2)){
   const bytes=fs.readFileSync(filename),zip=await JSZip.loadAsync(bytes),paths=Object.keys(zip.files);
   const chosen=await page.evaluate(paths=>DMCReadme.choose(paths),paths),actual=await inspect(Array.from(bytes));
   assert.ok(chosen);assert.equal(actual.text,await zip.file(chosen).async('string'));console.log('PASS real archive README:',path.basename(filename),chosen);
  }
  await page.evaluate(()=>{DoLModCenter.destroy();return __fixture.cleanup();});
  console.log('PASS README ZIP/CRC/limits, loaded JSZip, stored disabled package, safe text, metadata links, no network, mobile widths and external bridge');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
