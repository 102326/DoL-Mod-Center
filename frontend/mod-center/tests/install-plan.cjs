const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/install-plan.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const compiled={exports:{}};new Function('exports',js)(compiled.exports);
const {createInstallPlan,commitPreparedInstall}=compiled.exports;
const items=[{name:'A',version:'2',bootJson:{dependenceInfo:[{modName:'B',version:'^1'}]}},{name:'B',version:'1'},{name:'C',version:'3'}];
const selections=items.map((item,i)=>({source:{key:'owner/'+i,url:'https://github.com/owner/'+i,modName:item.name},release:{tag:'v'+item.version},asset:{name:item.name+'.zip'}}));
const plan=createInstallPlan(items,[{name:'A',version:'1'}],['A'],selections,[]);
assert.deepEqual(plan.items.map(p=>[p.name,p.sourceKey]),[['A','owner/0'],['B','owner/1'],['C','owner/2']]);
assert.equal(plan.items[0].enabled,false);assert.equal(plan.items[0].previous,'1');assert.equal(plan.items[1].previous,undefined);
assert.deepEqual(plan.items[0].dependencies,[{name:'B',version:'^1'}]);
assert.throws(()=>createInstallPlan(items,[],[],selections.slice(0,1),[]),/数量/);
assert.throws(()=>createInstallPlan(items,[],[],[selections[1],selections[0],selections[2]],[]),/名称与仓库关联不符/);
(async()=>{
 let commits=0,bindings=[];
 const outcome=await commitPreparedInstall(plan,async()=>{commits++},async(key,name)=>{bindings.push([key,name]);if(name==='A')return false;if(name==='B')throw Error('quota');return true});
 assert.equal(commits,1);assert.equal(outcome.status,'binding-pending');assert.deepEqual(bindings,[['owner/0','A'],['owner/1','B'],['owner/2','C']]);
 assert.deepEqual(outcome.items.map(p=>p.binding),['pending','pending','saved']);
 assert.equal(plan.items[0].binding,undefined,'result must not mutate the confirmed plan');
 for(const committed of [false,true]){
  let bound=false;
  const result=await commitPreparedInstall(plan,async()=>{throw Object.assign(Error('write or readback failure'),{committed})},()=>{bound=true;return true});
  assert.equal(result.status,committed?'unverified':'not-committed');assert.equal(bound,false,'never associate packages whose commit was not verified');
 }
 const localPlan=createInstallPlan(items,[],[],[],[]);let localCommits=0;
 const local=await commitPreparedInstall(localPlan,async()=>{localCommits++},()=>{throw Error('local import has no source')});
 assert.equal(local.status,'committed');assert.equal(localCommits,1);
 console.log('install-plan: passed (mapping, disabled update, single commit, all binding attempts, pre/post-commit failures)');
})().catch(error=>{console.error(error);process.exitCode=1});
