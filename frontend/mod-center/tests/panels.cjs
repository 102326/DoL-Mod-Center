const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1704,height:1136}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
 await page.evaluate(()=>{
  __loaded.push({name:'BeautySelectorAddon',version:'2.9.0',bootJson:{name:'BeautySelectorAddon',version:'2.9.0'}});
  const all=['示例立绘','示例界面','可选衣饰'].map((type,i)=>({type,modRef:{name:'A'},imgListRef:new Map([['img/'+i,{}]])}));
  window.addonBeautySelectorAddon={getTypeOrder:()=>all,typeOrderUsed:all.slice(0,2),BeautySelectorAddon_OrderSaveKey:'fixture-beauty-custom',async iniCustomStore(){if(!this.customStore)this.customStore=__fixture.loader.customStore.bind(__fixture.loader);}};
 });
 await page.addStyleTag({path:path.join(__dirname,'../dist/ui.css')});await page.addScriptTag({path:path.join(__dirname,'../dist/ui.js')});
 await page.locator('#dmc-sidebar-button').click();await page.waitForFunction(()=>!document.querySelector('.next-toolbar .primary').disabled);
 const ui=page.locator('.dmc-next');assert.equal(await ui.getByText('你的模组，你的配置。',{exact:true}).count(),0);assert.equal(await ui.locator('.next-nav-foot').count(),0);
 await ui.getByRole('button',{name:/美化图层/}).click();
 await ui.getByRole('button',{name:'启用图层',exact:true}).click();await page.waitForFunction(()=>addonBeautySelectorAddon.typeOrderUsed.length===3);
 await ui.getByRole('button',{name:'停用图层',exact:true}).first().click();await page.waitForFunction(()=>addonBeautySelectorAddon.typeOrderUsed.length===2);
 fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
 for(const [view,width,height] of [['tablet',1704,1136],['phone',390,844]]){
  await page.setViewportSize({width,height});
  for(const [id,label] of [['beauty','美化图层'],['diagnostics','运行诊断']]){
   await ui.getByRole('button',{name:new RegExp(label)}).first().click();
   if(id==='diagnostics'){await ui.getByRole('button',{name:'刷新检查',exact:true}).click();await ui.locator('#dwb-panel').waitFor();}
   await page.screenshot({path:path.join(__dirname,'artifacts',id+'-'+view+'.png')});
   const m=await ui.locator('.next-scroll').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(m.scroll<=m.width+2,id+' '+view+' overflow');
  }
 }
 assert.deepEqual(errors,[]);await page.evaluate(()=>{DoLModCenter.destroy();return __fixture.cleanup()});
 console.log('PASS shared panels: populated beauty toggle, diagnostics refresh, removed slogans, tablet/phone geometry; no page errors');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
