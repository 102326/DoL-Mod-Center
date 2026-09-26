const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),JSZip=require('jszip');
const root=path.resolve(__dirname,'..'),old=path.resolve(root,'../../mods/mod-center-v1');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1704,height:1136}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});
 await page.goto(pathToFileURL(path.join(old,'tests/demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
 await page.evaluate(()=>{window.nativeTestName='DMC_VUE_'+crypto.randomUUID();window.modLoaderKeyConfigWinHookFunction=c=>{c.config.set('ModLoader_IndexDBLoader',nativeTestName);c.config.set('keyval',nativeTestName);c.config.set('modDataIndexDBZipList','test-enabled');c.config.set('modDataIndexDBZipListHidden','test-disabled');c.config.set('modDataIndexDBZipPrefix','test-package')}});
 await page.addScriptTag({path:path.join(old,'tests/native-loader.fixture.js')});
 const packages={};for(const name of ['Alpha Content','Beta Theme','Gamma Disabled','Delta Import']){const z=new JSZip();z.file('boot.json',JSON.stringify({name,version:'1.0.0',scriptFileList:[],styleFileList:[],tweeFileList:[],imgFileList:[],additionFile:['README.md']}));z.file('README.md','# '+name+'\n\n**Offline** package readme.');packages[name]=Array.from(await z.generateAsync({type:'uint8array',compression:'DEFLATE'}))}
 await page.evaluate(async packages=>{const api=DMCStorage.create();for(const name of Object.keys(packages).slice(0,3))await api.install(await api.prepare(await api.read(),name),new Uint8Array(packages[name]));await api.toggle(await api.read(),'Gamma Disabled',false)},packages);
 await page.addStyleTag({path:path.join(root,'dist/ui.css')});await page.addScriptTag({path:path.join(root,'dist/ui.js')});
 await page.locator('#dmc-sidebar-button').click();const ui=page.locator('.dmc-next');await ui.getByRole('button',{name:'Alpha Content',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);
 assert.equal(await page.locator('.dmc-panel').isVisible(),false);
 // Keyboard drag writes immediately, and Vue does not duplicate DOM after imperative reorder.
 const handle=ui.getByRole('button',{name:'调整顺序：Alpha Content',exact:true});await handle.focus();await handle.press('Space');await handle.press('ArrowDown');await handle.press('Enter');
 await page.waitForFunction(async()=>JSON.stringify((await DMCStorage.create().read()).enabled)==='["Beta Theme","Alpha Content"]');
 await page.waitForFunction(()=>document.querySelector('.next-list .next-name').textContent==='Beta Theme');assert.equal(await ui.locator('.next-list article').count(),2);
 // Touch pointer reorder follows the same no-confirm path.
 await page.evaluate(()=>{const h=document.querySelector('.next-list .dmc-drag-handle'),cards=document.querySelectorAll('.next-list article'),a=h.getBoundingClientRect(),b=cards[1].getBoundingClientRect();const opts={bubbles:true,pointerId:42,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:a.x+15,clientY:a.y+15};h.dispatchEvent(new PointerEvent('pointerdown',opts));h.dispatchEvent(new PointerEvent('pointermove',{...opts,clientY:b.bottom-5}));h.dispatchEvent(new PointerEvent('pointerup',{...opts,buttons:0,clientY:b.bottom-5}))});
 await page.waitForFunction(async()=>JSON.stringify((await DMCStorage.create().read()).enabled)==='["Alpha Content","Beta Theme"]');
 await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);
 const alpha=ui.locator('article[data-mod-name="Alpha Content"]');await alpha.getByRole('button',{name:'禁用',exact:true}).click();await ui.getByRole('button',{name:'确认',exact:true}).click();await page.waitForFunction(async()=>!(await DMCStorage.create().read()).enabled.includes('Alpha Content'));
 await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);
 await ui.getByRole('button',{name:'Alpha Content',exact:true}).click();await ui.getByText('Offline',{exact:false}).first().waitFor();await ui.getByRole('button',{name:'← 返回列表',exact:true}).click();
 await ui.locator('input[type=file]').first().setInputFiles({name:'Delta.zip',mimeType:'application/zip',buffer:Buffer.from(packages['Delta Import'])});await ui.getByRole('button',{name:'确认',exact:true}).click();await page.waitForFunction(async()=>(await DMCStorage.create().read()).packages.includes('Delta Import'));await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);
 const delta=ui.locator('article[data-mod-name="Delta Import"]');await delta.getByRole('button',{name:'删除',exact:true}).click();await ui.getByRole('button',{name:'确认',exact:true}).click();await page.waitForFunction(async()=>!(await DMCStorage.create().read()).packages.includes('Delta Import'));await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);
 // Native ZIP download/restore via reused backup flow inside Vue.
 await ui.getByRole('button',{name:/备份与恢复/}).click();const wait=page.waitForEvent('download');await ui.getByRole('button',{name:'导出当前完整备份',exact:true}).click();const saved=await(await wait).path();assert.equal(JSON.parse(fs.readFileSync(saved,'utf8')).schema,'DoLModCenter.full.v2');
 await ui.getByLabel('选择完整备份').setInputFiles(saved);await ui.getByText('校验通过。确认后整体替换；生效需要重启。',{exact:true}).waitFor();await ui.getByLabel('已保存刚导出的当前备份',{exact:false}).check();await ui.getByRole('button',{name:'恢复这份备份',exact:true}).click();await ui.getByText('恢复已提交并回读核验。请重启游戏，当前会话仍是恢复前的模组。',{exact:true}).waitFor();
 for(const name of [/运行诊断/,/配置快照/,/美化图层/]){await ui.getByRole('button',{name}).first().click();assert.ok(await ui.isVisible())}
 await ui.getByRole('button',{name:/本地模组/}).click();await ui.getByRole('button',{name:'刷新',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);
 // Responsive and reduced-motion acceptance, CSS viewport includes tablet at DPR 2.
 fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
 for(const [name,width,height]of [['tablet',1704,1136],['tablet-portrait',1136,1704],['phone',390,844],['phone-landscape',844,390],['desktop',1440,900]]){
  await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:'reduce'});await page.screenshot({path:path.join(__dirname,'artifacts',name+'.png')});
  const geometry=await ui.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.querySelector('.next-window').getBoundingClientRect(),s=el.querySelector('.next-scroll');return{fits:p.left>=0&&p.right<=innerWidth+1&&p.top>=0&&p.bottom<=innerHeight+1,overflow:s.scrollWidth>s.clientWidth+2,height:s.clientHeight}});assert.ok(geometry.fits,name+' window');assert.ok(!geometry.overflow,name+' horizontal overflow');assert.ok(geometry.height>60,name+' content visible');
 }
 await page.setViewportSize({width:390,height:844});
 for(const id of ['diagnostics','backups','profiles','beauty']){await page.evaluate(id=>{const buttons=[...document.querySelectorAll('.next-nav button')];buttons[['local','diagnostics','backups','profiles','beauty'].indexOf(id)].click()},id);const metrics=await ui.locator('.next-scroll').evaluate(e=>[e.scrollWidth,e.clientWidth]);assert.ok(metrics[0]<=metrics[1]+2,id+' mobile overflow');}
 await ui.getByRole('button',{name:/本地模组/}).click();
 await ui.getByRole('button',{name:'经典界面',exact:true}).click();assert.equal(await ui.isVisible(),false);assert.equal(await page.locator('.dmc-panel').isVisible(),true);await page.getByRole('button',{name:'打开新版界面',exact:true}).click();assert.equal(await ui.isVisible(),true);
 await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);await page.keyboard.press('Escape');assert.equal(await ui.isVisible(),false);await page.locator('#dmc-sidebar-button').click();await page.waitForFunction(()=>!document.querySelector('.dmc-next .next-toolbar .primary').disabled);await page.evaluate(()=>document.dispatchEvent(new Event('backbutton',{cancelable:true})));assert.equal(await ui.isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS Vue UI + native ZIP import/delete/toggle, keyboard/touch reorder, details, full backup restore, 5 viewports, classic fallback, Escape/Android back event; no page errors');
 await page.evaluate(()=>__fixture.cleanup());
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
