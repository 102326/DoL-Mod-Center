<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,shallowRef,watch} from 'vue';
import LegacyPanel from './LegacyPanel.vue';
import DiagnosticAssistant from './DiagnosticAssistant.vue';
import StartupRecovery from './StartupRecovery.vue';
import MarketPanel from './MarketPanel.vue';
import InstallReview from './InstallReview.vue';
import LocalLibrary from './LocalLibrary.vue';
import {readLibraryFiles,type LibraryFile} from './local-library';
import {verifyAssetBytes,type RepoSource,type RepoRelease,type ReleaseAsset} from './market';
import {downloadMarketBatch,type MarketSelection} from './market-batch';
import {createInstallPlan,commitPreparedInstall,type InstallPlan,type InstallOutcome} from './install-plan';
import {runtime,storage,emptyState,download,type State,type ModInfo,type Catalog,type BatchOrderContext} from './bridge';
import {MARKET_ENABLED} from './internal-features';
const api=storage(),state=shallowRef<State>(emptyState()),catalog=shallowRef<Catalog>();
const opened=ref(false),tab=ref('local'),query=ref(''),busy=ref(false),message=ref(''),error=ref(false),changed=ref(false),preloads=ref(false);
const lastInstall=shallowRef<InstallOutcome>();
const pendingBindingKeys=ref<string[]>([]);
const panel=ref<HTMLElement>(),list=ref<HTMLElement>(),file=ref<HTMLInputElement>(),detailHost=ref<HTMLElement>();
const detail=ref<{name:string;loaded:boolean}>();const pending=shallowRef<{text:string;action:()=>Promise<unknown>;plan?:InstallPlan}>();
const recoveryPanel=ref<InstanceType<typeof StartupRecovery>>();
const marketPanel=ref<InstanceType<typeof MarketPanel>>(),downloading=ref(false),downloadProgress=ref('');
const libraryOpen=ref(false),libraryReading=ref(false),libraryProgress=ref('');
const libraryPanel=ref<InstanceType<typeof LocalLibrary>>();
let libraryController:AbortController|undefined;
let downloadController:AbortController|undefined;
let manualImport:{source:RepoSource;release:RepoRelease;asset:ReleaseAsset}|undefined;
const assistant=ref<InstanceType<typeof DiagnosticAssistant>>(), localPage=ref('mods'), rawLogs=ref(false);
const tabs=[{id:'local',icon:'▦',name:'本地模组',sub:'模组与美化图层'},{id:'market',icon:'⊞',name:'模组市场',sub:'自定义 GitHub 仓库'},{id:'diagnostics',icon:'◎',name:'诊断助手',sub:'检查问题与排查线索'},{id:'backups',icon:'◇',name:'备份与恢复',sub:'启动恢复与配置快照'}].filter(t=>MARKET_ENABLED||t.id!=='market');
const dragMessage=ref('');
const undoOrder=shallowRef<{token:Catalog;order:string[]}>();let undoTimer:ReturnType<typeof setTimeout>|undefined;
function clearUndo(){undoOrder.value=undefined;if(undoTimer)clearTimeout(undoTimer);undoTimer=undefined}
async function undoSort(){if(busy.value||pending.value)return;const saved=undoOrder.value;if(!saved)return;clearUndo();await run(()=>api.reorderCatalog(saved.token,saved.order),true)}
const activeTitle=computed(()=>tab.value==='details'?'模组详情':tabs.find(t=>t.id===tab.value)?.name);
const isPreload=(name:string)=>!state.value.packages.includes(name)&&state.value.preloaded.some(p=>p.name===name);
const managed=computed(()=>state.value.enabled.filter(n=>!isPreload(n)));
const infoIndex=computed(()=>new Map([...state.value.loaded,...(catalog.value?.items||[])].map(p=>[p.name,p])));
const info=(name:string):ModInfo=>infoIndex.value.get(name)||{name};
const matches=(p:ModInfo)=>(p.name+' '+(p.version||'')).toLowerCase().includes(query.value.toLowerCase());
const enabled=computed(()=>managed.value.map(info).filter(matches));
const other=computed(()=>[...new Set([...state.value.disabled,...state.value.orphans,...state.value.loaded.map(p=>p.name)])].filter(n=>!state.value.enabled.includes(n)&&!isPreload(n)).map(info).filter(matches));
const builtins=computed(()=>state.value.preloaded.filter(p=>isPreload(p.name)).filter(matches));
const protectedMod=(name:string)=>name==='DoLModCenter'&&!runtime.__DMC_BUILTIN;
const writable=(name:string)=>state.value.writable&&!busy.value&&!pending.value&&!protectedMod(name);
function notify(text:string,failed=false){message.value=text;error.value=failed;}
function bindingRepaired(key:string){
 const previous=pendingBindingKeys.value.includes(key);pendingBindingKeys.value=pendingBindingKeys.value.filter(k=>k!==key);
 const result=lastInstall.value;
 if(result?.items.some(item=>item.sourceKey===key&&item.binding==='pending')){
  const items=result.items.map(item=>item.sourceKey===key?{...item,binding:'saved' as const}:item);
  lastInstall.value={...result,items,...(result.status==='binding-pending'&&!items.some(item=>item.binding==='pending')?{status:'committed' as const,message:'整批模组已安装，仓库关联已恢复。'}:{})};
 }
 if(previous&&error.value&&message.value.includes('仓库关联未保存'))notify(pendingBindingKeys.value.length?'模组已安装，还有 '+pendingBindingKeys.value.length+' 个仓库关联未保存。':'仓库关联已恢复。',pendingBindingKeys.value.length>0);
}
async function checkDiagnosis(){await run(async()=>{await refresh();await nextTick();assistant.value?.check()})}
async function refresh(strict=false){let s:State;try{s=await api.read()}catch(e){state.value=emptyState();catalog.value=undefined;throw e}state.value=s;try{catalog.value=await api.catalog(s)}catch(e){catalog.value=undefined;notify('包资料读取失败：'+String(e),true);if(strict)throw e}}
async function run(fn:()=>Promise<unknown>,mutate=false){if(busy.value||runtime.DMCStorage.isBusy())return;if(mutate)clearUndo();busy.value=true;try{await fn();if(mutate){changed.value=true;await refresh();notify('配置已保存，重启游戏后生效。')}}catch(e){notify(String(e),true)}finally{busy.value=false;await bindDrag()}}
function confirm(text:string,action:()=>Promise<unknown>,plan?:InstallPlan){pending.value={text,action,plan};}
function cancelPending(){if(pending.value?.plan)lastInstall.value={kind:'install',status:'not-committed',items:pending.value.plan.items,message:'已取消安装计划，未写入模组。'};pending.value=undefined}
async function accept(){
 if(busy.value||runtime.DMCStorage.isBusy())return;
 const p=pending.value;pending.value=undefined;if(!p)return;
 if(!p.plan){await run(p.action,true);return}
 busy.value=true;clearUndo();
 try{
  const result=await p.action() as InstallOutcome;lastInstall.value=result;
  pendingBindingKeys.value=result.items.filter(item=>item.binding==='pending').map(item=>item.sourceKey!);
  if(result.status!=='not-committed'){
   changed.value=true;marketPanel.value?.consumeSelection(result.items.flatMap(item=>item.sourceKey?[item.sourceKey]:[]));
  }
  try{await refresh(true)}catch(e){if(result.status!=='not-committed')lastInstall.value={...result,status:'unverified',message:result.message+' 本地状态刷新失败：'+String(e)}}
  const final=lastInstall.value!;notify(final.status==='unverified'?'模组安装已提交，但结果未完全核验；请检查恢复点后再继续。':final.message,final.status!=='committed');
 }finally{busy.value=false;await bindDrag()}
}
function toggle(p:ModInfo){const s=state.value,on=!s.enabled.includes(p.name);const affected=on?[]:runtime.DMCAssistant?.dependents(p.name,{state:s,catalog:catalog.value})||[];confirm((on?'启用':'禁用')+'“'+p.name+'”？'+(affected.length?'\n以下已启用模组依赖它：'+affected.join('、')+'。这些模组不会被自动停用。':''),()=>api.toggle(s,p.name,on))}
async function remove(p:ModInfo){await run(async()=>{const token=await api.prepare(state.value,p.name);confirm('删除“'+p.name+'”？建议先导出 ZIP。',()=>api.remove(token,p.name))})}
async function importFile(e:Event){
 const input=e.target as HTMLInputElement,files=[...(input.files||[])],manual=manualImport;manualImport=undefined;input.value='';if(!files.length)return;
 if(pending.value||!opened.value)return;
 await run(async()=>{
  if(!manual)throw Error('请通过待导入列表选择 ZIP。');
  if(manual&&(files.length!==1||files[0].size!==manual.asset.size))throw Error('请只选择与当前 Release 附件大小一致的一个 ZIP。');
  const bytes=[];for(const f of files)bytes.push(new Uint8Array(await f.arrayBuffer()));
  if(manual)await verifyAssetBytes(manual.asset,bytes[0]);
  await refresh();await prepareBytes(bytes,'手动选择附件：'+files[0].name+'\n'+(manual.asset.digest?'附件摘要已匹配 Release。':'Release 未提供摘要，无法验证手动文件来自该仓库，请核对作者来源。')+'\n',[manual]);
 });
}
function batchOrder(context:BatchOrderContext):{order:string[];warnings:string[]}{
 const fixed=new Set(context.fixedNames),names=context.enabled.filter(n=>!fixed.has(n));
 const items=names.map(name=>{const info=context.items.find(p=>p.name===name);if(!info||info.error)throw Error('无法读取前置：'+name);return {...info,beauty:runtime.DMCPackage.describe(info.bootJson).beauty}});
 const external=[...context.preloaded,...state.value.loaded.filter(p=>!context.enabled.includes(p.name)&&!context.disabled.includes(p.name)&&!context.preloaded.some(x=>x.name===p.name))].filter(p=>!names.includes(p.name));
 const result=runtime.DMCSort.plan(items,{external,disabled:context.disabled,loaderVersion:runtime.modUtils?.version||'',checkVersion:(v:string,r:string)=>{try{const sv=runtime.modSC2DataManager?.getDependenceChecker?.().getInfiniteSemVerApi();return sv?.satisfies(sv.parseVersion(v).version,sv.parseRange(r))}catch{return undefined}}});
 if(result.errors.length)throw Error('无法自动排序：'+result.errors.join('；')+'。请补齐依赖，或取消自动排序后检查安装提示。');
 let index=0;return {order:context.enabled.map(n=>fixed.has(n)?n:result.order[index++]),warnings:result.warnings};
}
async function importLibrary(files:LibraryFile[],autoSort:boolean){
 if(pending.value||!state.value.writable)return;
 await run(async()=>{
  libraryController=new AbortController();libraryReading.value=true;libraryProgress.value='';
  try{if(await api.readRecovery())throw Error('请先处理上次导入的启动恢复点。');
   const bytes=await readLibraryFiles(files,{signal:libraryController.signal,progress:text=>libraryProgress.value=text});
   await refresh();await prepareBytes(bytes,'从待导入列表读取 '+files.length+' 个包。\n',[],libraryController.signal,autoSort);
  }finally{libraryReading.value=false;libraryController=undefined;libraryProgress.value=''}
 });
}
async function prepareBytes(bytes:Uint8Array[],origin='',selections:MarketSelection[]=[],signal?:AbortSignal,autoSort=false){
  let sorted:{order:string[];warnings:string[]}|undefined;
  const token=await api.prepareInstallBatch(state.value,bytes,autoSort?{order:context=>{sorted=batchOrder(context);return sorted.order}}:undefined),current=await api.catalog(state.value);
  const replacement=new Set(token.names),nextCatalog={...current,items:current.items.filter(p=>!replacement.has(p.name)).concat(token.items)};
  const findings=runtime.DMCAssistant.analyze({state:{...state.value,enabled:token.enabled,disabled:token.disabled,missing:state.value.missing.filter(n=>!replacement.has(n)),packages:[...new Set([...state.value.packages,...token.names])]},catalog:nextCatalog,gameVersion:runtime.DMCAssistant.gameVersion(runtime),loaderVersion:runtime.modUtils?.version,checkVersion:(v:string,r:string)=>{try{const a=runtime.modSC2DataManager?.getDependenceChecker?.().getInfiniteSemVerApi?.();return a?.satisfies(a.parseVersion(v).version,a.parseRange(r))}catch{return undefined}}});
  const plan=createInstallPlan(token.items,current.items,token.disabled,selections,findings);
  if(sorted){plan.loadOrder=[...token.enabled];plan.sortWarnings=sorted.warnings}
  if(signal?.aborted)throw Error('已取消下载与预检，未安装模组。');
  lastInstall.value=undefined;
  confirm(origin+(selections.length?'模组会执行代码；确认安装即表示你信任这些作者，摘要匹配仅验证附件一致性。\n':'')+'确认后整批写入，同时保存一个启动恢复点。更新包可恢复旧内容；新增包恢复时保留并停用，存档不在恢复范围。',()=>commitPreparedInstall(plan,()=>api.installBatch(token),(key,name)=>marketPanel.value?.bindSource(key,name)??false),plan);
}
async function marketInstall(source:RepoSource,release:RepoRelease,asset:ReleaseAsset){
 if(!MARKET_ENABLED)return;
 await marketInstallBatch([{source,release,asset}]);
}
async function marketInstallBatch(selections:MarketSelection[]){
 if(!MARKET_ENABLED)return;
 if(pending.value||!state.value.writable)return;
 await run(async()=>{
  downloadController=new AbortController();downloading.value=true;downloadProgress.value='';
  try{
   if(await api.readRecovery())throw Error('存在未处理的启动恢复点，请先在备份与恢复中确认保留或撤销上次导入。');
   const batch=await downloadMarketBatch(selections,{signal:downloadController.signal,onProgress:(index,count,received,total)=>{downloadProgress.value=(index+1)+' / '+count+' 包 · '+(received/1048576).toFixed(1)+' / '+(total/1048576).toFixed(1)+' MiB'}});
   await refresh();
   await prepareBytes(batch.inputs,'已下载 '+batch.inputs.length+' 个附件。'+(batch.selections.every(item=>!!item.asset.digest)?'附件摘要已校验。':'部分发布未提供摘要，仅完成下载与包结构检查。')+'\n',batch.selections,downloadController.signal);
  }catch(e){const text=downloadController.signal.aborted?'已取消下载与预检，未安装模组。':String(e);lastInstall.value={kind:'install',status:'not-committed',items:[],message:text};throw Error(text)}
  finally{downloading.value=false;downloadController=undefined;downloadProgress.value=''}
 });
}
function cancelDownload(){downloadController?.abort()}
async function openImport(source?:RepoSource,release?:RepoRelease,asset?:ReleaseAsset){if(busy.value||pending.value)return;if(source&&release&&asset&&!MARKET_ENABLED)return;if(source&&release&&asset){manualImport={source,release,asset};file.value?.click();return}libraryOpen.value=true;tab.value='local';localPage.value='mods';await nextTick();libraryPanel.value?.openInput()}
async function exportZip(p:ModInfo){await run(async()=>{await download(await api.exportZip(p.name),p.name.replace(/[\\/:*?"<>|]/g,'_')+'.zip');notify('已发起 ZIP 导出，请确认系统保存结果。')})}
async function details(p:ModInfo,loaded=!state.value.packages.includes(p.name)){detail.value={name:p.name,loaded};tab.value='details';await nextTick();if(!detailHost.value)return;detailHost.value.textContent='正在读取…';await run(async()=>{const i=await(loaded?api.loadedDetails(p.name):api.details(p.name));if(detailHost.value)runtime.DMCModInfo.render(detailHost.value,i)})}
async function sort(){await run(async()=>{const token=await api.catalog(state.value),fixed=new Set(token.preloaded.filter(p=>!token.items.some(i=>i.name===p.name)).map(p=>p.name)),names=token.enabled.filter(n=>!fixed.has(n));
 const items=names.map(n=>{const p=token.items.find(i=>i.name===n);if(!p||p.error)throw Error('无法读取前置：'+n);return {...p,beauty:runtime.DMCPackage.describe(p.bootJson).beauty}});
 const external=[...token.preloaded,...state.value.loaded.filter(p=>!token.enabled.includes(p.name)&&!token.disabled.includes(p.name)&&!token.preloaded.some(x=>x.name===p.name))].filter(p=>!names.includes(p.name));
 const plan=runtime.DMCSort.plan(items,{external,disabled:token.disabled.filter(n=>!fixed.has(n)),loaderVersion:runtime.modUtils?.version||'',checkVersion:(v:string,r:string)=>{try{const sv=runtime.modSC2DataManager?.getDependenceChecker?.().getInfiniteSemVerApi();return sv?.satisfies(sv.parseVersion(v).version,sv.parseRange(r))}catch{return undefined}}});
 if(plan.errors.length)throw Error(plan.errors.join('；'));if(!plan.changed){notify('当前顺序已符合规则。'+plan.warnings.join('；'));return}let i=0;const order=token.enabled.map(n=>fixed.has(n)?n:plan.order[i++]);confirm('建议顺序：\n'+order.join(' → ')+'\n'+plan.warnings.join('；'),()=>api.reorderCatalog(token,order));
})}
let drag:{destroy():void;cancel?():boolean}|undefined;
async function bindDrag(){drag?.destroy();drag=undefined;await nextTick();if(!list.value||tab.value!=='local'||localPage.value!=='mods'||busy.value||query.value||pending.value)return;const s=state.value,order=[...managed.value];drag=runtime.DMCDrag.bind(list.value,{onDrop:(name:string,index:number)=>run(async()=>{const result=await api.move(s,name,s.enabled.indexOf(order[index]));try{const token=await api.catalog(result);undoOrder.value={token,order:[...s.enabled]};undoTimer=setTimeout(clearUndo,12000)}catch{notify('顺序已保存，撤销记录未能建立，请刷新核对。',true)}},true),onAnnounce:(text:string)=>{dragMessage.value=text}})}
watch([tab,query,pending,localPage],()=>bindDrag());
let previous:Element|null=null,oldOverflow='';
async function open(){if(opened.value)return;previous=document.activeElement;oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';opened.value=true;await nextTick();panel.value?.focus();await run(refresh)}
function release(){if(!opened.value)return;clearUndo();opened.value=false;cancelPending();drag?.destroy();document.body.style.overflow=oldOverflow;(previous as HTMLElement)?.focus?.()}
function close(){if(recoveryPanel.value?.isWorking()||busy.value||runtime.DMCStorage.isBusy()||runtime.DMCRescue?.isBusy?.()){notify('请等待当前操作完成。');return}release()}
function key(e:KeyboardEvent){if(!opened.value)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(libraryReading.value){libraryController?.abort();return}if(downloading.value){cancelDownload();return}if(drag?.cancel?.())return;if(recoveryPanel.value?.cancelPending())return;if(pending.value)cancelPending();else if(tab.value==='details')tab.value='local';else close()}if(e.key==='Tab'){const nodes=[...panel.value!.querySelectorAll<HTMLElement>('button,input,a[href],select,textarea,summary')].filter(n=>!n.hasAttribute('disabled')&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.value)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}
function back(e:Event){if(opened.value){e.preventDefault();e.stopImmediatePropagation();if(libraryReading.value){libraryController?.abort();return}if(downloading.value){cancelDownload();return}if(drag?.cancel?.())return;if(recoveryPanel.value?.cancelPending())return;if(pending.value)cancelPending();else if(tab.value==='details')tab.value='local';else close()}}
onMounted(()=>{runtime.DMCNext={open,close,fail:release};document.addEventListener('backbutton',back,true);document.addEventListener('keydown',key,true)});
onBeforeUnmount(()=>{cancelDownload();clearUndo();drag?.destroy();document.removeEventListener('backbutton',back,true);document.removeEventListener('keydown',key,true);if(opened.value)document.body.style.overflow=oldOverflow;delete runtime.DMCNext});
</script>
<template>
<div v-show="opened" class="dmc-next">
 <span role="status" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">{{dragMessage}}</span>
 <section ref="panel" class="next-window" role="dialog" aria-modal="true" aria-labelledby="next-title" tabindex="-1">
   <aside class="next-nav"><div class="next-brand"><span class="next-logo">◈</span><div><strong>MOD CENTER</strong><small>模组中心 · 2.3.2</small></div></div>
   <nav aria-label="新版模组中心"><button v-for="t in tabs" :key="t.id" :class="{selected:tab===t.id}" :disabled="busy||!!pending" @click="tab=t.id"><span>{{t.icon}}</span><div>{{t.name}}<small>{{t.sub}}</small></div></button></nav>
  </aside>
  <div class="next-main"><header><div><small class="next-eyebrow">WORKSPACE / {{ tab.toUpperCase() }}</small><h2 id="next-title">{{activeTitle}}</h2></div><button aria-label="关闭模组中心" class="next-close" @click="close">×</button></header>
   <div v-if="busy||message||changed" class="next-notice" role="status" :class="{failure:error}">{{busy?'正在处理，请稍候…':message}}<span v-if="changed">{{busy||message?' · ':''}}更改需重启</span></div>
   <div v-if="downloading" class="next-notice" role="status">正在下载 {{downloadProgress}} <button @click="cancelDownload">取消下载</button></div>
   <div v-if="pending" class="next-confirm" role="alertdialog" aria-label="确认配置修改"><div class="next-confirm-content"><InstallReview v-if="pending.plan" :plan="pending.plan" /><p>{{pending.text}}</p></div><div class="next-confirm-actions"><button @click="accept">确认</button><button @click="cancelPending">取消</button></div></div>
   <main class="next-scroll dmc-content">
    <section v-if="lastInstall" class="install-result" aria-label="本次安装结果" role="status">
     <h3>{{lastInstall.status==='not-committed'?'整批未提交':lastInstall.status==='unverified'?'已提交 · 待核对':lastInstall.status==='binding-pending'?'已安装 · 关联待修复':'整批安装完成'}}</h3>
     <p>{{lastInstall.message}}</p>
     <ul v-if="lastInstall.items.length"><li v-for="item in lastInstall.items" :key="item.name">{{item.name}} · {{item.version}}<span v-if="item.binding"> · {{item.sourceKey}}：{{item.binding==='saved'?'关联已保存':'关联待修复'}}</span></li></ul>
     <div class="next-toolbar"><button v-if="lastInstall.status!=='not-committed'" :disabled="busy||!!pending" @click="tab='backups'">查看启动恢复点</button><button v-if="MARKET_ENABLED&&lastInstall.items.some(item=>item.binding==='pending')" :disabled="busy||!!pending" @click="tab='market'">处理来源关联</button><button :disabled="busy||!!pending" @click="lastInstall=undefined">收起结果</button></div>
     <p class="next-help">这是本次操作结果，后续其他操作可能改变当前配置；来源关联与模组恢复点分别保存。</p>
    </section>
    <section v-show="tab==='local'"><div class="next-toolbar"><button :aria-pressed="localPage==='mods'" @click="localPage='mods'">模组列表</button><button :aria-pressed="localPage==='beauty'" @click="localPage='beauty'">美化图层</button></div><LegacyPanel kind="beauty" :api="api" :active="tab==='local'&&localPage==='beauty'&&opened" /><section v-show="localPage==='mods'">
     <div class="next-overview"><div><small>本地包</small><strong>{{state.packages.length}}</strong></div><div><small>下次启用</small><strong>{{state.enabled.length}}</strong></div><div><small>当前挂载</small><strong>{{state.loaded.length}}</strong></div><div><small>缺失引用</small><strong :class="{danger:state.missing.length}">{{state.missing.length}}</strong></div></div>
     <div class="next-toolbar mc:flex mc:flex-wrap mc:gap-2"><input v-model="query" type="search" aria-label="搜索模组" placeholder="搜索模组名称或版本…"><button class="primary" :disabled="busy||!!pending||!state.writable" @click="openImport()">＋ 添加 ZIP</button><button :disabled="busy||!!pending" @click="run(refresh)">刷新</button><button :disabled="busy||!!pending||!state.writable" @click="sort">按前置排序</button><button :disabled="busy||!!pending" @click="confirm('已保存游戏？确认重启游戏？',async()=>{runtime.location.reload()})">重启</button><input ref="file" type="file" accept=".zip" hidden @change="importFile" @cancel="manualImport=undefined"></div>
     <div class="next-toolbar"><button :disabled="busy||!!pending" :aria-expanded="libraryOpen" @click="libraryOpen=!libraryOpen">待导入列表</button></div>
     <LocalLibrary ref="libraryPanel" :active="libraryOpen&&opened&&tab==='local'&&localPage==='mods'" :busy="busy||!!pending" :reading="libraryReading" :progress="libraryProgress" @select="importLibrary" @cancel="libraryController?.abort()" />
     <p class="next-help">拖动手柄，松手保存顺序。启用状态用于下次启动，挂载状态代表当前会话。</p>
     <p v-if="state.reason" class="next-error">{{state.reason}}</p><p v-if="state.missing.length" class="next-error">缺少包体：{{state.missing.join('、')}}</p>
     <h3>额外模组 <span>{{enabled.length+other.length}}</span></h3>
     <div ref="list" class="next-list"><article v-for="(p,index) in enabled" :key="p.name" class="dmc-card next-card" :data-order-name="p.name" :data-mod-name="p.name">
      <button class="dmc-drag-handle" :aria-label="'调整顺序：'+p.name" :disabled="!writable(p.name)||!!query||enabled.length<2">⠿</button><span class="next-index">{{index+1}}</span><div class="next-card-info"><button class="next-name" @click="details(p)" :disabled="busy">{{p.name}}</button><div class="next-tags"><span>{{p.version||'版本未知'}}</span><span class="next-tag enabled">已启用</span><span v-if="state.loaded.some(x=>x.name===p.name)" class="next-tag">已挂载</span><span v-else class="next-tag">未挂载</span><span v-if="p.bootJson">{{runtime.DMCPackage.describe(p.bootJson).label}}</span></div><p v-if="p.error" class="next-error">{{p.error}}</p></div>
      <div class="next-actions"><button :disabled="!writable(p.name)" @click="toggle(p)">禁用</button><button :disabled="busy||!!pending" @click="exportZip(p)">导出</button><button :disabled="!writable(p.name)" @click="remove(p)">删除</button></div>
     </article></div>
     <article v-for="p in other" :key="p.name" class="next-card"><div class="next-card-info"><button class="next-name" :disabled="busy" @click="details(p)">{{p.name}}</button><div class="next-tags"><span>{{p.version}}</span><span class="next-tag">{{state.disabled.includes(p.name)?'已禁用':state.packages.includes(p.name)?'未登记':'只读'}}</span><span v-if="state.loaded.some(x=>x.name===p.name)" class="next-tag">已挂载</span></div></div><div class="next-actions"><button v-if="state.disabled.includes(p.name)" :disabled="!writable(p.name)" @click="toggle(p)">启用</button><button v-if="state.packages.includes(p.name)" :disabled="busy||!!pending" @click="exportZip(p)">导出</button><button v-if="state.disabled.includes(p.name)" :disabled="!writable(p.name)" @click="remove(p)">删除</button></div></article>
     <p v-if="!enabled.length&&!other.length" class="next-empty">没有匹配的模组。</p>
     <button class="next-preload" @click="preloads=!preloads" :aria-expanded="preloads">{{preloads?'▾':'▸'}} 游戏预载 · {{builtins.length}} <span>只读</span></button><div v-if="preloads"><article class="next-card" v-for="p in builtins" :key="p.name"><div class="next-card-info"><strong>{{p.name}}</strong><small>{{p.version}}</small></div><button :disabled="busy" @click="details(p,true)">详情</button></article></div>
    </section>
    </section>
    <MarketPanel v-if="MARKET_ENABLED" v-show="tab==='market'" ref="marketPanel" :active="opened&&tab==='market'" :busy="busy||!!pending" :writable="state.writable" :installed="catalog?.items||[]" :install="marketInstall" :install-batch="marketInstallBatch" @import="openImport()" @manual="openImport" @binding-repaired="bindingRepaired" />
    <section v-if="tab==='details'"><div class="next-toolbar mc:flex mc:flex-wrap mc:gap-2"><button @click="tab='local'">← 返回列表</button><button v-if="detail&&state.packages.includes(detail.name)&&state.loaded.some(p=>p.name===detail!.name)" :disabled="busy" @click="details({name:detail!.name},!detail!.loaded)">{{detail.loaded?'查看本地包':'查看已挂载包'}}</button></div><p class="next-help">{{detail?.loaded?'本次运行包资料':'本地包资料，下次启动使用'}}</p><article ref="detailHost" class="next-detail" /></section>
    <section v-if="tab==='diagnostics'"><DiagnosticAssistant ref="assistant" :state="state" :catalog="catalog" :busy="busy" @refresh="checkDiagnosis" @inspect="name=>details(info(name))" @recovery="tab='backups'" /><details @toggle="rawLogs=($event.target as HTMLDetailsElement).open"><summary>原始日志与运行环境</summary><LegacyPanel kind="diagnostics" :api="api" :active="rawLogs&&opened" /></details></section>
    <section v-if="tab==='backups'"><p class="next-help">导入更新靠启动恢复，大改前导出完整备份，保存常用搭配用配置快照。游戏进度仍需单独导出存档。</p><LegacyPanel kind="backups" :api="api" :active="tab==='backups'&&opened" /><StartupRecovery ref="recoveryPanel" :api="api" :busy="busy" @changed="run(refresh)" /><details><summary>配置快照（保存常用搭配）</summary><LegacyPanel kind="profiles" :api="api" :active="tab==='backups'&&opened" /></details></section>
   </main>
   <div v-if="undoOrder" class="next-sort-toast" role="status"><span>顺序已保存</span><button :disabled="busy||!!pending" @click="undoSort">撤销排序</button><button aria-label="关闭排序提示" @click="clearUndo">×</button></div>
   <footer><span>本地管理 · 离线工作台</span><span>配置与恢复工作台</span></footer>
  </div>
 </section>
</div>
</template>
<style scoped>
.install-result{border:1px solid #65588a;border-radius:14px;background:#272332;padding:14px 18px;margin-bottom:18px;overflow-wrap:anywhere}.install-result h3{margin-top:0}.install-result ul{padding-left:20px}.install-result li{margin:6px 0}
</style>
