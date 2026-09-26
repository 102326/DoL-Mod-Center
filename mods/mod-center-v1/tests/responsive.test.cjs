const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 for(const [name,width,height,scale,touch] of [['phone',390,844,1,true],['tablet-landscape',1704,1136,2,true],['tablet-portrait',1136,1704,2,true],['tablet-split',700,1136,1,true],['pc',1440,900,1,false]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:scale,hasTouch:touch});await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);await page.locator('#dmc-sidebar-button').click();await page.waitForFunction(()=>document.querySelector('.dmc-status').textContent.includes('就绪'));
  const dialog=page.getByRole('dialog');assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  const card=page.locator('.dmc-sort-list .dmc-card').first();assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  if(width>=800)assert.ok((await card.boundingBox()).height<110,'wide cards should be compact');
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-results/layout-'+name+'.png')});
  await card.getByRole('button',{name:'详情',exact:true}).click();await page.locator('.dmc-info-grid').waitFor();
  await page.evaluate(()=>DMCModInfo.render(document.querySelector('.dmc-detail-page'),{name:'示例模组',version:'1.1.0',bootJson:{author:'开发者',dependenceInfo:[{modName:'ModLoader',version:'2.101.1'}]},readme:{path:'README.md',text:'# 使用说明\n\n这是平板与手机的阅读排版检查。\n\n## 功能\n\n- 本地管理\n- 完整备份\n\n| 操作 | 说明 |\n| --- | --- |\n| 排序 | 松手保存 |\n\n```js\n// 文档示例，仅作显示\n```'}}));
  const summary=await page.locator('.dmc-info-summary').boundingBox(),reading=await page.locator('.dmc-info-reading').boundingBox();
  if(width>=800)assert.ok(reading.x>summary.x+summary.width-2);else assert.ok(reading.y>=summary.y+summary.height-2);
  assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:path.join(__dirname,'../test-results/detail-'+name+'.png')});await page.close();
 }
 console.log('PASS phone, 3408x2272 tablet landscape, portrait, split screen and PC layouts');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
