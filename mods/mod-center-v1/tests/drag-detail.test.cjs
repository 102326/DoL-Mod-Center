'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:1100},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
  await page.locator('#dmc-sidebar-button').click();await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('就绪'));
  const state=()=>page.evaluate(()=>DMCStorage.create().read());
  const card=n=>page.locator('.dmc-sort-list .dmc-card').filter({has:page.locator('.dmc-card-head strong').filter({hasText:new RegExp('^'+n+'$')})});
  await card('B').scrollIntoViewIfNeeded();const b=await card('B').locator('.dmc-drag-handle').boundingBox(),a=await card('A').boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(a.x+45,a.y+15,{steps:10});await page.mouse.up();
  await page.waitForFunction(async()=> (await DMCStorage.create().read()).enabled.join(',')==='B,A');assert.deepEqual((await state()).enabled,['B','A']);assert.equal(await page.locator('.dmc-inline-confirm').count(),0);
  // A click or a cancelled pointer gesture must not change the persisted order.
  const unchanged=await card('A').locator('.dmc-drag-handle').boundingBox();await page.mouse.move(unchanged.x+5,unchanged.y+5);await page.mouse.down();await page.mouse.up();assert.deepEqual((await state()).enabled,['B','A']);
  await page.evaluate(()=>{const h=document.querySelector('.dmc-sort-list .dmc-drag-handle');h.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,pointerId:91,clientX:20,clientY:20,button:0}));h.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,isPrimary:true,pointerId:91,clientX:60,clientY:60}));h.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,isPrimary:true,pointerId:91}));});assert.deepEqual((await state()).enabled,['B','A']);
  // Real browser touch gesture against the isolated fixture, not the game.
  await card('B').scrollIntoViewIfNeeded();const touchB=await card('B').locator('.dmc-drag-handle').boundingBox(),touchA=await card('A').boundingBox();
  const session=await page.context().newCDPSession(page),x=touchB.x+touchB.width/2,y=touchB.y+touchB.height/2;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+15}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:touchA.y+touchA.height-15}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(async()=> (await DMCStorage.create().read()).enabled.join(',')==='A,B');assert.deepEqual((await state()).enabled,['A','B']);
  // Keyboard cancellation does not close the manager or persist the preview.
  await card('A').locator('.dmc-drag-handle').focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('Escape');
  assert.ok(await page.getByRole('dialog').isVisible());assert.deepEqual((await state()).enabled,['A','B']);assert.equal(await page.locator('.dmc-inline-confirm').count(),0);
  // Stale config during a gesture is rejected when release commits.
  await card('A').locator('.dmc-drag-handle').focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.evaluate(()=>__fixture.seed([['enabled-custom',JSON.stringify(['B','A'])]]));await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('其他操作'));assert.deepEqual((await state()).enabled,['B','A']);
  // Independent page, preserved search and back behavior.
  await page.getByRole('searchbox').fill('A');assert.ok(await card('A').locator('.dmc-drag-handle').isDisabled());
  await card('A').getByRole('button',{name:'详情',exact:true}).click();await page.locator('.dmc-detail-page h4').first().waitFor();
  assert.equal(await page.locator('.dmc-card').count(),0);assert.match(await page.locator('.dmc-detail-page').innerText(),/版本/);
  await page.evaluate(()=>document.dispatchEvent(new Event('backbutton',{cancelable:true})));assert.equal(await page.getByRole('searchbox').inputValue(),'A');assert.ok(await page.getByRole('dialog').isVisible());
  await card('A').getByRole('button',{name:'详情',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('searchbox').inputValue(),'A');
  await page.getByRole('searchbox').fill('');
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-results/drag-list-mobile.png')});
  await page.evaluate(async()=>{const names=['A','B',...Array.from({length:30},(_,i)=>'Long'+i)];await __fixture.seed([['enabled-custom',JSON.stringify(names)],...names.slice(2).map(n=>['fixture-package:'+n,__fixture.pack(n)])]);});
  await page.getByRole('button',{name:'刷新',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.dmc-sort-list .dmc-card').length===32);
  await card('A').locator('.dmc-drag-handle').scrollIntoViewIfNeeded();const longHandle=await card('A').locator('.dmc-drag-handle').boundingBox(),scroller=await page.locator('.dmc-content').boundingBox();
  const beforeScroll=await page.locator('.dmc-content').evaluate(e=>e.scrollTop);
  await page.mouse.move(longHandle.x+20,longHandle.y+20);await page.mouse.down();await page.mouse.move(scroller.x+60,scroller.y+scroller.height-8,{steps:8});
  await page.waitForFunction(before=>document.querySelector('.dmc-content').scrollTop>before+500,beforeScroll);await page.mouse.up();await page.waitForFunction(()=>!DMCStorage.isBusy());
  await page.waitForFunction(async()=>(await DMCStorage.create().read()).enabled.indexOf('A')>1);
  await page.evaluate(()=>{DoLModCenter.destroy();return __fixture.cleanup();});assert.deepEqual(errors,[]);
  console.log('PASS direct mouse/touch reorder, keyboard cancel, stale rejection, independent details and back/search restoration');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
