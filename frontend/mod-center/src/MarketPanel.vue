<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,shallowRef,watch} from 'vue';
import WikiDirectory from './WikiDirectory.vue';
import {loadSources,saveSources,parseRepository,fetchReleases,fetchReadme,displayMarketDate,type RepoSource,type RepoRelease,type ReleaseAsset,type RepositoryReadme} from './market';
import {snapshotMarketSelections,type MarketSelection} from './market-batch';
import {runtime,type ModInfo} from './bridge';
const props=defineProps<{active:boolean;busy:boolean;writable:boolean;installed:ModInfo[];install:(source:RepoSource,release:RepoRelease,asset:ReleaseAsset)=>Promise<void>;installBatch:(items:MarketSelection[])=>Promise<void>}>();
const emit=defineEmits<{import:[];manual:[source:RepoSource,release:RepoRelease,asset:ReleaseAsset];'binding-repaired':[key:string]}>();
const sources=shallowRef<RepoSource[]>([]),address=ref(''),message=ref(''),failure=ref(false),querying=ref(''),preview=ref(false),configBroken=ref(false);
const pendingBindings=shallowRef<Record<string,{key:string;modName:string}>>({});
const results=shallowRef<Record<string,RepoRelease[]>>({}),selected=ref<Record<string,number>>({}),assets=ref<Record<string,number>>({}),checked=ref<Record<string,string>>({});
const queued=ref<Record<string,boolean>>({}),batching=ref(false);
const externalUrl=ref('');
const queryErrors=ref<Record<string,string>>({});
const readmes=shallowRef<Record<string,RepositoryReadme>>({}),readmeErrors=ref<Record<string,string>>({});
const currentGameVersion=computed(()=>{void props.active;return runtime.DMCAssistant?.gameVersion(runtime) as string|undefined});
const locked=computed(()=>props.busy||!!querying.value||configBroken.value||batching.value);
let controller:AbortController|undefined;
try{sources.value=loadSources()}catch(e){message.value='仓库配置无法读取：'+String(e);failure.value=true;configBroken.value=true}
function tell(text:string,error=false){message.value=text;failure.value=error}
function commit(next:RepoSource[]){saveSources(next);sources.value=next}
function cancel(){controller?.abort()}
function openExternal(event:MouseEvent,url:string){
 if(!runtime.cordova)return;
 event.preventDefault();
 try{if(typeof runtime.cordova.InAppBrowser?.open==='function'){runtime.cordova.InAppBrowser.open(url,'_system');externalUrl.value='';return}}catch{}
 externalUrl.value=url;tell('当前 APK 无法打开外部浏览器，请复制下方地址到浏览器下载。');
}
watch(()=>props.active,active=>{if(!active)cancel()});
onBeforeUnmount(cancel);
function release(source:RepoSource){return results.value[source.key]?.find(r=>r.id===selected.value[source.key])}
function asset(source:RepoSource){return release(source)?.assets.find(a=>a.id===assets.value[source.key])}
function choose(source:RepoSource){assets.value[source.key]=release(source)?.assets[0]?.id||0}
function apply(source:RepoSource,list:RepoRelease[]){results.value={...results.value,[source.key]:list};selected.value[source.key]=list[0]?.id||0;choose(source);checked.value[source.key]=new Date().toLocaleString()}
async function request(source:RepoSource,adding=false){
 if(locked.value)return;
 querying.value=source.key;controller=new AbortController();const signal=controller.signal;
 queryErrors.value[source.key]='';
 try{
  const list=await fetchReleases(source,{signal,includePrereleases:preview.value});
  if(signal.aborted||!props.active)return;
  if(adding){commit([...sources.value,source]);address.value=''}
  apply(source,list);tell(list.length?'已读取发布版本，请核对附件与包内版本。':(adding?'已保存仓库；':'')+'最近 20 条发布中没有符合条件的版本。');
  if(adding){await nextTick();Array.from(document.querySelectorAll<HTMLElement>('.next-market [data-repository]')).find(e=>e.dataset.repository===source.key)?.scrollIntoView({block:'start'})}
 }catch(e){queryErrors.value[source.key]=signal.aborted?'已取消查询。':String(e);tell(queryErrors.value[source.key],!signal.aborted)}
 finally{querying.value='';controller=undefined}
}
async function add(){if(locked.value)return;try{const source=parseRepository(address.value);if(sources.value.some(s=>s.key===source.key))throw Error('这个仓库已经添加。');if(sources.value.length>=30)throw Error('最多添加 30 个仓库。');await request(source,true)}catch(e){tell(String(e),true)}}
async function inspect(source:RepoSource){
 if(locked.value)return;
 const needRelease=!results.value[source.key],needReadme=!readmes.value[source.key];
 if(!needRelease&&!needReadme)return;
 querying.value=source.key;controller=new AbortController();const signal=controller.signal;
 queryErrors.value[source.key]='';readmeErrors.value[source.key]='';
 try{
  const [releaseResult,readmeResult]=await Promise.allSettled([
   needRelease?fetchReleases(source,{signal,includePrereleases:preview.value}):Promise.resolve(results.value[source.key]),
   needReadme?fetchReadme(source,{signal}):Promise.resolve(readmes.value[source.key])
  ]);
  if(signal.aborted||!props.active)return;
  if(releaseResult.status==='fulfilled'){if(needRelease)apply(source,releaseResult.value)}else queryErrors.value[source.key]=String(releaseResult.reason);
  if(readmeResult.status==='fulfilled')readmes.value={...readmes.value,[source.key]:readmeResult.value};else readmeErrors.value[source.key]=String(readmeResult.reason);
 }finally{querying.value='';controller=undefined}
}
async function subscribe(source:RepoSource){if(locked.value)return;try{const checked=parseRepository(source.url);if(sources.value.some(s=>s.key===checked.key))throw Error('这个仓库已经添加，可在下方刷新版本。');if(sources.value.length>=30)throw Error('最多添加 30 个仓库。');await request(checked,true)}catch(e){tell(String(e),true)}}
function remove(source:RepoSource){if(locked.value)return;try{commit(sources.value.filter(s=>s.key!==source.key));const next={...results.value};delete next[source.key];results.value=next;removeFromQueue(source);tell('已移除仓库订阅，已安装模组保持不变。')}catch(e){tell(String(e),true)}}
function queuedSelection(source:RepoSource):MarketSelection|undefined{const r=release(source),a=asset(source);return r&&a?{source,release:r,asset:a}:undefined}
const batchSelections=computed(()=>sources.value.filter(s=>queued.value[s.key]).map(queuedSelection).filter((item):item is MarketSelection=>!!item));
const batchBytes=computed(()=>batchSelections.value.reduce((sum,item)=>sum+item.asset.size,0));
function toggleQueue(source:RepoSource){if(locked.value||!props.writable)return;queued.value={...queued.value,[source.key]:!queued.value[source.key]}}
function clearQueue(){if(locked.value)return;queued.value={}}
function removeFromQueue(source:RepoSource){if(locked.value)return;const next={...queued.value};delete next[source.key];queued.value=next}
async function installBatch(){if(locked.value||!props.writable||!batchSelections.value.length)return;try{batching.value=true;const snapshot=snapshotMarketSelections(batchSelections.value);await props.installBatch(snapshot)}catch(e){tell(String(e),true)}finally{batching.value=false}}
function queueBinding(key:string,modName:string){pendingBindings.value={...pendingBindings.value,[key]:{key,modName}}}
function bindSource(key:string,modName:string):boolean{
 try{
  const latest=loadSources(),source=latest.find(s=>s.key===key);
  if(!source)throw Error('仓库订阅不存在，未自动重新创建。');
  if(source.modName&&source.modName!==modName)throw Error('该仓库已经关联其他模组：'+source.modName+'。');
  if(latest.some(s=>s.key!==key&&s.modName===modName))throw Error('该模组已经关联其他仓库：'+modName+'。');
  saveSources(latest.map(s=>s.key===key?{...s,modName}:s));
  sources.value=loadSources();
  const next={...pendingBindings.value};delete next[key];pendingBindings.value=next;
  tell('安装已完成，重启游戏后生效。');return true;
 }catch(e){
  queueBinding(key,modName);tell('模组已安装，但仓库关联未保存：'+String(e)+'。可稍后重试关联。',true);return false;
 }
}
function retryBinding(source:RepoSource){
 const pending=pendingBindings.value[source.key];if(!pending)return;
 if(bindSource(pending.key,pending.modName)){tell('仓库关联已恢复。');emit('binding-repaired',source.key)}
}
function installed(source:RepoSource){return props.installed.find(p=>p.name===source.modName)}
function versionHint(source:RepoSource){const local=installed(source),remote=release(source);if(!local||!remote)return '';return (local.version||'').replace(/^v/,'')===remote.tag.replace(/^v/,'')?'发布标签与本地版本一致':'发布标签与本地版本不同；是否升级以包内预检为准'}
async function install(source:RepoSource){const r=release(source),a=asset(source);if(locked.value||!r||!a)return;await props.install(source,r,a)}
const size=(bytes:number)=>(bytes/1048576).toFixed(2)+' MiB';
defineExpose({bindSource,consumeSelection:(keys:string[])=>{const next={...queued.value};for(const key of keys)delete next[key];queued.value=next}});
</script>
<template>
 <section class="next-market" aria-label="GitHub 模组市场">
  <WikiDirectory :active="active" :busy="locked" :subscribed="sources.map(s=>s.key)" :releases="results" :checked="checked" :querying="querying" :query-errors="queryErrors" :readmes="readmes" :readme-errors="readmeErrors" :current-version="currentGameVersion" @subscribe="subscribe" @inspect="inspect" @cancel="cancel" />
  <h3>我的 GitHub 仓库</h3>
  <p class="next-help">从目录选择或手动添加公开 GitHub 仓库，选择 Release 中的模组 ZIP。查询和下载由你发起，下载后先预检，确认后才安装。模组会在游戏中执行代码，请选择你信任的作者；预检与摘要匹配不代表代码安全审计。</p>
  <form class="market-add" @submit.prevent="add">
   <label for="dmc-market-address">GitHub 仓库</label>
   <div class="next-toolbar"><input id="dmc-market-address" v-model="address" :disabled="locked" placeholder="https://github.com/作者/仓库 或 作者/仓库" autocomplete="off" maxlength="240"><button class="primary" type="submit" :disabled="locked||!address.trim()">添加仓库</button></div>
  </form>
  <div class="next-toolbar"><label><input v-model="preview" type="checkbox" :disabled="locked"> 包含预发布（下次查询生效）</label><button :disabled="props.busy||!!querying" @click="emit('import')">导入已下载 ZIP</button><button v-if="querying" @click="cancel">取消查询</button></div>
  <div v-if="batchSelections.length" class="market-batch-summary" aria-live="polite"><strong>批量队列：{{batchSelections.length}} 个仓库</strong><span>总大小 {{size(batchBytes)}}</span><button type="button" :disabled="locked" @click="clearQueue">清空队列</button><button type="button" class="primary" :disabled="locked||!writable" @click="installBatch">下载并预检所选</button><small>先下载全部附件并检查依赖，再一次确认安装。准备失败不会安装任何包；不自动下载依赖。</small>
   <ul class="market-queue-list"><li v-for="item in batchSelections" :key="item.source.key"><span>{{item.source.key}} · {{item.release.tag}} · {{item.asset.name}} · {{size(item.asset.size)}}</span><button :disabled="locked" :aria-label="'移出队列：'+item.source.key" @click="toggleQueue(item.source)">移出</button></li></ul>
  </div>
  <p v-if="querying||message" role="status" :class="{'next-error':failure}">{{querying?'正在查询 '+querying+'…':message}}</p>
  <label v-if="externalUrl" class="market-field">复制下载页地址<input :value="externalUrl" readonly aria-label="复制下载页地址" @focus="($event.target as HTMLInputElement).select()"></label>
  <p v-if="!sources.length" class="market-empty">还没有订阅仓库。可以填写 <code>102326/DoL-Game-UI</code> 或其他作者提供的公开仓库。添加不会自动安装。</p>
  <article v-for="source in sources" :key="source.key" class="market-repo" :data-repository="source.key">
   <div class="market-heading"><div><h3>{{source.owner}} / {{source.repo}}</h3><a :href="source.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" @click="openExternal($event,source.url)">查看作者仓库 ↗</a></div><div class="next-actions"><button :disabled="locked" @click="request(source)">刷新版本</button><button :disabled="locked" @click="remove(source)">移除订阅</button></div></div>
   <p v-if="source.modName" class="next-help">关联模组：{{source.modName}} · {{installed(source)?'本地版本 '+(installed(source)?.version||'未知'):'尚未在本地包中找到'}}</p>
   <p v-else class="next-help">首次安装时关联包内模组名称；同一订阅后续仅接受该名称的包。</p>
   <p v-if="pendingBindings[source.key]" class="next-error">模组已安装，但来源关联尚未保存（本次游戏会话保留待重试记录）。<button :disabled="locked" @click="retryBinding(source)">重试关联</button></p>
   <p v-if="!results[source.key]" class="next-help">点击“刷新版本”联网检查。{{source.modName?'已安装的模组可继续离线使用。':''}}</p>
   <template v-else-if="results[source.key].length">
    <label class="market-field">发布版本<select v-model="selected[source.key]" :disabled="locked" @change="choose(source)"><option v-for="r in results[source.key]" :key="r.id" :value="r.id">{{r.tag}} · {{r.name}}{{r.prerelease?'（预发布）':''}}</option></select></label>
    <template v-if="release(source)">
     <dl class="market-metadata"><div><dt>模组版本（发布标签）</dt><dd>{{release(source)?.tag}}</dd></div><div><dt>发布时间</dt><dd>{{displayMarketDate(release(source)?.publishedAt)}}</dd></div><div><dt>发布记录更新</dt><dd>{{displayMarketDate(release(source)?.updatedAt)}}</dd></div><div><dt>最近查询</dt><dd>{{checked[source.key]}}</dd></div></dl>
     <p class="market-compatibility"><strong>游戏适配 · 作者发布说明</strong><span>{{release(source)?.compatibilityNotes||'未提取到明确版本声明，请查看作者发布说明。'}}</span></p>
     <p class="next-help">发布标签不一定等于包内版本；发布记录更新时间也可能只是作者编辑了说明。适配声明未经实机验证，依赖以 ZIP 预检为准。</p>
     <p v-if="versionHint(source)" class="next-help">{{versionHint(source)}}</p>
     <label v-if="release(source)!.assets.length" class="market-field">安装附件<select v-model="assets[source.key]" :disabled="locked"><option v-for="a in release(source)!.assets" :key="a.id" :value="a.id">{{a.name}} · {{size(a.size)}}</option></select></label>
     <label v-if="asset(source)" class="market-queue-choice"><input type="checkbox" :checked="!!queued[source.key]" :disabled="locked||!writable" @change="toggleQueue(source)"> 加入批量安装队列（{{asset(source)?.name}}）</label>
     <p v-else class="next-help">这个版本没有可用的模组 ZIP 附件。源码压缩包不作为模组安装包。</p>
     <div class="next-toolbar"><button class="primary" :disabled="locked||!writable||!asset(source)" @click="install(source)">下载并预检</button><button :disabled="locked||!writable||!asset(source)" @click="emit('manual',source,release(source)!,asset(source)!)">导入此附件</button><a :href="release(source)!.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" @click="openExternal($event,release(source)!.url)">发布说明 / 手动下载 ↗</a></div>
     <p v-if="!writable" class="next-help">当前加载器为只读，仍可打开发布页手动下载。</p>
    </template>
   </template>
   <p v-else class="next-help">最近 20 条发布中没有符合条件的版本。可以启用预发布后重试，或查看作者仓库。</p>
  </article>
  <p class="next-help">单个附件上限 128 MiB。浏览器跨域或网络限制导致下载失败时，可从发布页手动下载，再导入 ZIP。仓库列表仅保存在本机，不包含在模组完整备份中。</p>
 </section>
</template>
<style scoped>
.market-add label{display:block;margin-bottom:8px}.market-add input{flex:1;min-width:0;width:100%}.market-repo{background:#222229;border:1px solid #3c3c48;border-radius:16px;padding:18px;margin:16px 0;overflow-wrap:anywhere}.market-heading{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}.market-heading h3{margin:0 0 5px}.market-field{display:block;margin:16px 0}.market-field select{display:block;width:100%;margin-top:6px;min-width:0}.market-empty{padding:24px;border:1px dashed #545461;border-radius:16px}.next-market .next-toolbar label{display:flex;align-items:center;gap:8px}.next-market .next-toolbar input[type=checkbox]{width:16px;height:16px;flex:none}.next-market a{overflow-wrap:anywhere}.market-repo .next-toolbar{margin-top:16px}@media(max-width:600px){.market-add .next-toolbar{display:block}.market-add button{margin-top:8px;width:100%}.market-repo{padding:12px}.market-heading .next-actions{justify-content:flex-start}}
.market-batch-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;margin:16px 0;border:1px solid #65588a;border-radius:12px;background:#272332}.market-batch-summary small{flex-basis:100%;color:#c8c1d4}.market-queue-choice{display:flex;align-items:center;gap:8px;margin:12px 0}.market-queue-choice input{width:16px;height:16px;flex:none}
.market-queue-list{width:100%;padding:0;list-style:none;margin:0}.market-queue-list li{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;overflow-wrap:anywhere}.market-queue-list span{min-width:0}.market-queue-list button{flex-shrink:0}
</style>
<style scoped>
.market-metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;background:#1c1c24;padding:14px;border-radius:12px}.market-metadata dt{font-size:12px;color:#aaa6b7}.market-metadata dd{margin:4px 0 0;overflow-wrap:anywhere}.market-compatibility{padding:12px 14px;border-left:3px solid #82739f;background:#26232f}.market-compatibility strong,.market-compatibility span{display:block}.market-compatibility span{margin-top:6px;font-size:13px;line-height:1.6}@media(max-width:600px){.market-metadata{grid-template-columns:1fr}}
</style>
