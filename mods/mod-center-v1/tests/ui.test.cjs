'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
  await page.locator('#dmc-sidebar-button').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('就绪'));
  const card=name=>page.locator('.dmc-card').filter({has:page.locator('.dmc-card-head strong').filter({hasText:new RegExp('^'+name+'$')})}).first();
  const confirm=()=>page.locator('.dmc-inline-confirm').getByRole('button',{name:'确认',exact:true}).click();
  const state=()=>page.evaluate(()=>DMCStorage.create(window).read());
  assert.equal(await page.getByRole('button',{name:'上移',exact:true}).count(),0);
  // Filtering must not change absolute load-order positions.
  await page.getByRole('searchbox',{name:'搜索模组'}).fill('B');assert.ok(await page.getByRole('searchbox').evaluate(e=>e===document.activeElement));
  assert.ok(await card('B').locator('.dmc-drag-handle').isDisabled());await page.getByRole('searchbox').fill('');await card('B').locator('.dmc-drag-handle').focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
  assert.equal(await page.locator('.dmc-inline-confirm').count(),0);
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('移动'));
  assert.deepEqual((await state()).enabled,['B','A']);await page.getByRole('searchbox').fill('');
  await card('A').getByRole('button',{name:'禁用',exact:true}).click();await confirm();
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('禁用'));
  assert.deepEqual((await state()).disabled,['C','A']);
  // Stored detail remains available for disabled, never-loaded package.
  await card('C').getByRole('button',{name:'详情',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dmc-details')?.textContent.includes('1.0.0'));await page.getByRole('button',{name:'返回模组列表'}).click();
  const download=page.waitForEvent('download');await card('C').getByRole('button',{name:'导出 ZIP',exact:true}).click();
  const exported=await (await download).path();assert.equal(JSON.parse(fs.readFileSync(exported,'utf8')).name,'C');
  const zip=Buffer.from(JSON.stringify({name:'C',version:'2.0.0',dependenceInfo:[]}));
  await page.locator('.dmc-toolbar input[type=file]').setInputFiles({name:'update.mod.zip',mimeType:'application/zip',buffer:zip});
  await page.locator('.dmc-inline-confirm').waitFor();assert.match(await page.locator('.dmc-inline-confirm').innerText(),/更新现有/);await confirm();
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('已导入'));
  assert.ok((await state()).disabled.includes('C'));
  await card('C').getByRole('button',{name:'详情',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dmc-details')?.textContent.includes('2.0.0'));await page.getByRole('button',{name:'返回模组列表'}).click();
  // Confirmation token detects replacing bytes even with unchanged enabled lists.
  await card('C').getByRole('button',{name:'删除',exact:true}).click();await page.locator('.dmc-inline-confirm').waitFor();
  await page.evaluate(()=>__fixture.seed([['fixture-package:C',__fixture.pack('C','3.0.0')]]));await confirm();
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('目标包'));
  assert.match(await page.locator('.dmc-status').innerText(),/失败/);
  assert.ok((await state()).disabled.includes('C'));
  // Orphan overwrite is explicitly disclosed, cancellation preserves package.
  await page.evaluate(()=>__fixture.seed([['fixture-package:Orphan',__fixture.pack('Orphan')]]));await page.getByRole('button',{name:'刷新',exact:true}).click();
  await card('Orphan').getByRole('button',{name:'导出 ZIP',exact:true}).waitFor();
  assert.match(await card('Orphan').innerText(),/未登记/);
  assert.equal(await card('Orphan').getByRole('button',{name:'启用',exact:true}).count(),0);
  await page.locator('.dmc-toolbar input[type=file]').setInputFiles({name:'orphan.zip',mimeType:'application/zip',buffer:Buffer.from(JSON.stringify({name:'Orphan',version:'2.0.0'}))});
  await page.locator('.dmc-inline-confirm').waitFor();assert.match(await page.locator('.dmc-inline-confirm').innerText(),/未登记的同名包/);
  await page.locator('.dmc-inline-confirm').getByRole('button',{name:'取消',exact:true}).click();assert.ok((await state()).orphans.includes('Orphan'));
  // New configuration snapshots capture persisted state, not current-run versions.
  await page.getByRole('button',{name:'配置快照',exact:true}).click();await page.getByLabel('配置快照名称').fill('验证配置');
  await page.getByRole('button',{name:'保存当前配置',exact:true}).click();await page.getByRole('button',{name:'比较配置',exact:true}).waitFor();
  await page.getByRole('button',{name:'比较配置',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dmc-config').textContent.includes('共同启用模组顺序'));assert.match(await dialog.innerText(),/共同启用模组顺序：未变/);
  const snapDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出快照',exact:true}).click();
  const snap=JSON.parse(fs.readFileSync(await (await snapDownload).path(),'utf8'));assert.deepEqual(snap.disabled,['C','A']);
  await page.getByRole('button',{name:'运行诊断',exact:true}).click();assert.match(await dialog.innerText(),/优先检查/);
  await page.getByRole('button',{name:'诊断',exact:true}).click();assert.match(await dialog.innerText(),/Synthetic fixture error/);
  for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'width '+width);}
  await page.getByRole('button',{name:'本地管理',exact:true}).click();await page.setViewportSize({width:390,height:844});
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-results/local-mobile.png'),fullPage:true});
  await page.evaluate(()=>{modUtils.version='99.0.0';});await page.getByRole('button',{name:'刷新',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('只读'));
  assert.ok(await page.getByRole('button',{name:'导入单个 ZIP',exact:true}).isDisabled());assert.ok(await card('B').getByRole('button',{name:'禁用',exact:true}).isDisabled());
  assert.ok(await card('B').getByRole('button',{name:'导出 ZIP',exact:true}).isEnabled());
  await page.evaluate(()=>__fixture.seed([['enabled-custom','bad-json']]));await page.getByRole('button',{name:'刷新',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('无法读取'));
  assert.match(await dialog.innerText(),/BuiltIn/);assert.ok(await page.getByRole('button',{name:'导入单个 ZIP',exact:true}).isDisabled());
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.locator('.dmc-shell').evaluate(e=>getComputedStyle(e).display),'none');
  await page.locator('#dmc-sidebar-button').click();await page.evaluate(()=>document.dispatchEvent(new Event('backbutton',{cancelable:true})));await dialog.waitFor({state:'hidden'});
  await page.evaluate(()=>{DoLModCenter.destroy();});assert.equal(await page.locator('.dmc-shell').count(),0);
  assert.deepEqual(errors,[]);await page.evaluate(()=>__fixture.cleanup());console.log('PASS original manager UI with native test IndexedDB: confirmations, filtered ordering, disabled update/details/export, concurrent replacement, orphan warning, config snapshots, diagnostics, narrow layout, readonly fallback, lifecycle');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
