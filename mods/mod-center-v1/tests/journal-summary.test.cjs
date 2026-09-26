const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const data=new Map(),root={localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}};
const context=vm.createContext({window:root,Date,WeakMap,WeakSet,Object,JSON,Number});
for(const name of ['change-journal.js','diagnostic-summary.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),context);
(async()=>{
 const result={enabled:['A']},api=root.DMCJournal.wrap({prepare:async()=>({}),inspect:async()=>({name:'A',version:'2'}),install:async()=>result,remove:async()=>{throw Error('abort');},move:async()=>result});
 const bytes=new Uint8Array([1]),token=await api.prepare({},'A');await api.inspect(bytes);assert.equal(await api.install(token,bytes),result);
 assert.equal(root.DMCJournal.list()[0].version,'2');assert.equal(root.DMCJournal.list()[0].names[0],'A');
 await assert.rejects(api.remove({},'A'));assert.equal(root.DMCJournal.list().length,1);
 root.localStorage.setItem=()=>{throw Error('quota');};assert.equal(await api.move({},'A',0),result);assert.ok(root.DMCJournal.status());assert.equal(root.DMCJournal.list().length,2);
 const summary=root.DMCSummary.summarize([{level:'error',message:'need mod X not find'},{level:'error',message:'TypeError widget'},{level:'info',message:'okCount:[85] errorCount:[0]'},{level:'error',message:'errorCount:[1]'}]);
 assert.equal(summary.dependency,1);assert.equal(summary.runtime,1);assert.equal(summary.patch,1);assert.equal(summary.other,0);
 console.log('PASS journal success/failure/quota, versions, identity and summary classification');
})().catch(e=>{console.error(e);process.exitCode=1;});
