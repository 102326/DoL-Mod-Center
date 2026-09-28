const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage();await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
  const data=await page.evaluate(()=>{
   const error=new Error("Cannot read properties of undefined (reading 'upper')",{cause:new Error('nested-cause')});
   error.stack="TypeError: upper\n"+Array.from({length:30},(_,i)=>'    at paint'+i+' (file:///C:/Users/Private/main.js:'+(i+1)+':20)').join('\n');
   const unsafe={get secret(){throw Error('getter must not run')}};unsafe.self=unsafe;
   console.error('[DoLGameUI] wardrobe preview failed',error,unsafe);
   console.warn('warning token=SECRET_VALUE https://example.test/a?token=PRIVATE');
   dispatchEvent(new ErrorEvent('error',{message:'runtime-test',error:new Error('runtime-stack'),filename:'https://example.test/main.js',lineno:42,colno:7}));
   dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:new Error('promise-stack')}));
   const host=document.createElement('div');document.body.append(host);DMCDiagnostics.mount(host);
   return {entries:DMCDiagnostics.snapshot().runtime,report:DMCDiagnostics.getReport()};
  });
  const log=data.entries.find(x=>x.detail.includes('[DoLGameUI]'));
  assert.ok(log.detail.includes('paint29'),'long stack survives summary cap');assert.ok(log.detail.includes(':30:20'),'line and column survive');assert.ok(log.detail.includes('nested-cause'));
  assert.ok(!data.report.includes('Users/Private'));assert.ok(!data.report.includes('SECRET_VALUE'));assert.ok(!data.report.includes('token=PRIVATE'));
  assert.ok(data.report.includes('runtime-stack'));assert.ok(data.report.includes('promise-stack'));assert.ok(data.report.includes('42:7'));
  await page.getByRole('button',{name:'详细日志',exact:true}).click();await page.getByLabel('搜索详细日志').fill('paint29');assert.equal(await page.locator('.dwb-body details').count(),1);
  await page.getByLabel('日志级别').selectOption('warn');assert.equal(await page.locator('.dwb-body details').count(),0);
  const count=await page.evaluate(()=>{for(let i=0;i<305;i++)console.warn('bounded-'+i);return DMCDiagnostics.snapshot().runtime.length});assert.equal(count,300);
  const restored=await page.evaluate(()=>{const wrapper=console.error;DMCDiagnostics.destroy();return console.error!==wrapper});assert.equal(restored,true);
  await page.evaluate(()=>__fixture.cleanup());console.log('PASS detailed logs: Error stack/cause, global error/rejection, redaction, filter, bounded retention, console cleanup');
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
