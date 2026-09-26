const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const p=await browser.newPage();await p.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await p.waitForFunction(()=>window.__fixtureReady);
 await p.addStyleTag({path:path.join(__dirname,'../dist/ui.css')});
 await p.evaluate(()=>{window.originalWrap=DMCJournal.wrap;DMCJournal.wrap=()=>{throw Error('synthetic setup failure')}});
 await p.addScriptTag({path:path.join(__dirname,'../dist/ui.js')});
 await p.locator('.dmc-next-error').waitFor();assert.equal(await p.locator('.dmc-panel,.dmc-shell').count(),0);
 await p.evaluate(()=>{DMCJournal.wrap=originalWrap});await p.getByRole('button',{name:'重试',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('.dmc-next')?.getClientRects().length>0);assert.equal(await p.locator('.dmc-next-error').count(),0);
 await p.waitForTimeout(100);
 await p.evaluate(()=>{window.originalBusy=DMCStorage.isBusy;DMCStorage.isBusy=()=>true;DoLModCenter.close()});assert.ok(await p.locator('.dmc-next').isVisible(),'busy close must not hide UI');
 await p.evaluate(()=>{DMCStorage.isBusy=originalBusy;DoLModCenter.close()});assert.equal(await p.locator('.dmc-next').isVisible(),false);
 await p.addScriptTag({path:path.join(__dirname,'../dist/ui.js')});assert.equal(await p.locator('#dmc-next-root').count(),1);assert.equal(await p.locator('#dmc-sidebar-button').count(),1);
 await p.locator('#dmc-sidebar-button').click();assert.ok(await p.locator('.dmc-next').isVisible());
 await p.evaluate(()=>DoLModCenter.destroy());assert.equal(await p.locator('#dmc-next-root,#dmc-sidebar-button,.dmc-next-error').count(),0);assert.equal(await p.evaluate(()=>document.body.style.overflow),'');await p.evaluate(()=>__fixture.cleanup());
 console.log('PASS Vue-only setup failure/retry, busy close, duplicate bundle, sidebar reopen and destroy cleanup');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
