const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1704,height:1136},deviceScaleFactor:2,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
 await page.evaluate(async()=>{
  __loaded.push({name:'BeautySelectorAddon',version:'2.9.0',bootJson:{name:'BeautySelectorAddon',version:'2.9.0'}});
  const all=['示例立绘','示例界面','可选衣饰'].map((type,i)=>({type,modRef:{name:'A'},imgListRef:new Map([['img/'+i,{}]])}));
  window.addonBeautySelectorAddon={getTypeOrder:()=>all,typeOrderUsed:all.slice(0,2),BeautySelectorAddon_OrderSaveKey:'fixture-beauty-custom',async iniCustomStore(){if(!this.customStore)this.customStore=__fixture.loader.customStore.bind(__fixture.loader);}};
  DoLModCenter.open();
 });
 const host=page.locator('.dmc-beauty-section');await host.getByRole('button',{name:'启用图层',exact:true}).waitFor();
 assert.equal(await host.locator('.dmc-beauty-sort .dmc-card').count(),2);
 await host.getByRole('button',{name:'启用图层',exact:true}).click();
 await page.waitForFunction(()=>addonBeautySelectorAddon.typeOrderUsed.length===3);
 await page.waitForFunction(()=>document.querySelectorAll('.dmc-beauty-sort .dmc-card').length===3);
 const handle=host.getByRole('button',{name:'调整美化优先级：可选衣饰',exact:true});await handle.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>addonBeautySelectorAddon.typeOrderUsed[0].type==='可选衣饰');
 await host.locator('[data-beauty-type="示例界面"]').getByRole('button',{name:'停用图层',exact:true}).click();
 await page.waitForFunction(()=>!addonBeautySelectorAddon.typeOrderUsed.some(t=>t.type==='示例界面'));
 await page.waitForFunction(()=>document.querySelectorAll('.dmc-beauty-sort .dmc-card').length===2);
 assert.deepEqual(await page.evaluate(async()=> (await DMCBeautyStorage.create().read()).enabled),['可选衣饰','示例立绘']);
 await host.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(__dirname,'../test-results/beauty-tablet-landscape.png')});
 await host.getByRole('button',{name:'所属模组详情',exact:true}).first().click();await page.locator('.dmc-info-grid').waitFor();assert.ok((await page.locator('.dmc-info-summary').textContent()).includes('A'));
 await page.getByRole('button',{name:'返回模组列表',exact:true}).click();await host.getByRole('button',{name:'启用图层',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await host.scrollIntoViewIfNeeded();assert.ok(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:path.join(__dirname,'../test-results/beauty-phone.png')});
 assert.deepEqual(errors,[]);await page.evaluate(()=>__fixture.cleanup());console.log('PASS beauty layer toggle, direct keyboard drag, owner details, persisted order and tablet/phone geometry');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
