'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');

(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
  const page=await browser.newPage();await page.goto(pathToFileURL(path.join(__dirname,'demo.html')).href);await page.waitForFunction(()=>window.__fixtureReady);
  const result=await page.evaluate(async()=>{
    const f=__fixture, api=DMCStorage.create(window), pack=(name,version='1.0.0')=>f.pack(name,version);
    const eq=(actual,expected,label)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(label+': '+JSON.stringify(actual));};
    const mods=new Map([
      ['Core',{name:'Core',version:'3.0.0'}],['Gone',{name:'Gone',version:'4.0.0'}],
      ['Unknown',{name:'Unknown',version:'5.0.0'}],['Actual',{name:'Actual',version:'6.0.0'}]
    ]);
    window.__loaded=[...mods].map(([name,bootJson])=>({name,bootJson}));
    const nativeLoader=modUtils.getModLoader().getIndexDBLoader();
    const nativeModLoader={getIndexDBLoader:()=>nativeLoader,getModCacheOneArray:()=>[
      {name:'Core',from:'Local',mod:{bootJson:mods.get('Core')}},
      {name:'Gone',from:'IndexDB',mod:{bootJson:mods.get('Gone')}},
      {name:'Actual',from:'Local',mod:{bootJson:mods.get('Actual')}}
    ]};
    modUtils.getModLoader=()=>nativeModLoader;
    await f.seed([
      ['enabled-custom',JSON.stringify(['Core','Gone','Unknown','Actual'])],
      ['disabled-custom',JSON.stringify([])],['fixture-package:A',undefined],['fixture-package:B',undefined],
      ['fixture-package:C',undefined],['fixture-package:Actual',pack('Actual','9.0.0')]
    ]);
    const state=await api.read();
    eq(state.preloaded.map(x=>x.name),['Core','Actual'],'Local preload names');
    eq(state.loaded.map(x=>x.from),['Local','IndexDB',undefined,'Local'],'exact cache source');
    eq(state.missing,['Gone','Unknown'],'missing excludes only Local preload');
    eq(state.preloadedReferences,['Core'],'raw Local references');
    if(state.preloaded.find(x=>x.name==='Core').version!=='3.0.0')throw Error('preloaded metadata missing');
    const catalog=await api.catalog(state);
    eq(catalog.items.map(x=>x.name),['Actual'],'catalog stored items');
    eq(catalog.preloaded.map(x=>x.name),['Core','Actual'],'catalog preload metadata');
    const after=await api.toggle(state,'Actual',false);
    eq(after.disabled,['Actual'],'toggle persisted');
    eq(after.preloadedReferences,['Core'],'toggle preload references');
    eq(after.missing,['Gone','Unknown'],'toggle missing state');
    return 'source-aware preload read/catalog/toggle';
  });
  console.log('PASS '+result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
