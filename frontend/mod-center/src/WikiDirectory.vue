<script setup lang="ts">
import {computed,onBeforeUnmount,ref,shallowRef,watch} from 'vue';
import {runtime} from './bridge';
import RepositoryReadme from './RepositoryReadme.vue';
import {displayMarketDate,type RepoSource,type RepoRelease,type RepositoryReadme as ReadmeData} from './market';
import {WIKI_URL,loadWikiCache,saveWikiCache,fetchWikiCatalog,wikiCacheNeedsRefresh,type WikiCatalog,type WikiEntry} from './wiki-source';
import {sortEntries,entryCompatibility,entryDate} from './market-order';
const props=defineProps<{active:boolean;busy:boolean;subscribed:string[];releases:Record<string,RepoRelease[]>;checked:Record<string,string>;querying:string;queryErrors:Record<string,string>;readmes:Record<string,ReadmeData>;readmeErrors:Record<string,string>;currentVersion?:string}>();
const emit=defineEmits<{subscribe:[source:RepoSource];inspect:[source:RepoSource];cancel:[]}>();
const catalog=shallowRef<WikiCatalog|null>(null),loading=ref(false),notice=ref(''),failed=ref(false),query=ref(''),page=ref(0),copyUrl=ref('');
const opened=ref(''),chosen=ref(''),frozen=shallowRef<string[]>([]);
let controller:AbortController|undefined;
try{catalog.value=loadWikiCache()}catch(e){notice.value='本地目录缓存不可用，可重新刷新：'+String(e);failed.value=true}
const repoUses=computed(()=>{const counts=new Map<string,number>();for(const entry of catalog.value?.entries||[])for(const repo of entry.repositories)counts.set(repo.key,(counts.get(repo.key)||0)+1);return counts});
const ordered=computed(()=>sortEntries(catalog.value?.entries||[],props.currentVersion,props.releases));
const filtered=computed(()=>{
 let values=ordered.value;
 if(opened.value){const ranks=new Map(frozen.value.map((id,i)=>[id,i]));values=[...values].sort((a,b)=>(ranks.get(a.id)??1e6)-(ranks.get(b.id)??1e6))}
 return values.filter(entry=>[entry.name,entry.section,entry.author,entry.wikiVersion,entry.compatibilityNotes,...entry.repositories.map(repo=>repo.key)].join(' ').toLowerCase().includes(query.value.toLowerCase().trim()));
});
const totalPages=computed(()=>Math.max(1,Math.ceil(filtered.value.length/20)));
const entries=computed(()=>filtered.value.slice(page.value*20,(page.value+1)*20));
function status(entry:WikiEntry){return entryCompatibility(entry,props.currentVersion,props.releases,repoUses.value)}
const statusLabels={supported:'声明适配当前版本',unknown:'适配未知',mismatch:'与当前版本声明不符'};
function date(entry:WikiEntry){return entryDate(entry,props.releases,repoUses.value)}
function title(entry:WikiEntry){return entry.name.replace(/\s*[→❤✈]\s*(?:下载|Github|论坛|Discord).*$/i,'').trim()||entry.name}
function close(){if(opened.value&&props.querying===chosen.value)emit('cancel');opened.value='';chosen.value=''}
function toggle(entry:WikiEntry){
 if(opened.value===entry.id){close();return}
 if(props.busy||loading.value)return;
 frozen.value=ordered.value.map(item=>item.id);opened.value=entry.id;
 const repo=entry.repositories[0];chosen.value=repo?.key||'';if(repo)emit('inspect',repo);
}
function selectRepo(repo:RepoSource){if(props.busy)return;chosen.value=repo.key;emit('inspect',repo)}
watch(query,()=>{close();page.value=0});watch(page,close);
watch(()=>props.active,value=>{if(!value){controller?.abort();close()}});
onBeforeUnmount(()=>controller?.abort());
async function refresh(){
 if(loading.value||props.busy)return;
 close();loading.value=true;failed.value=false;notice.value='';controller=new AbortController();const signal=controller.signal;
 try{const next=await fetchWikiCatalog({signal});if(signal.aborted||!props.active)return;catalog.value=next;page.value=0;
  try{saveWikiCache(next);notice.value='目录已更新；点击条目即可查看说明。'}catch(e){notice.value='目录已更新，但缓存未保存：'+String(e);failed.value=true}
 }catch(e){failed.value=true;notice.value=signal.aborted?'已取消目录刷新。':String(e)+(catalog.value?'；继续显示上次缓存。':'。可以打开 Wiki 或手动添加仓库。')}
 finally{loading.value=false;controller=undefined}
}
function external(event:MouseEvent){
 if(!runtime.cordova)return;event.preventDefault();
 try{if(typeof runtime.cordova.InAppBrowser?.open==='function'){runtime.cordova.InAppBrowser.open(WIKI_URL,'_system');copyUrl.value='';return}}catch{}
 copyUrl.value=WIKI_URL;notice.value='当前 APK 无法打开外部浏览器，请复制 Wiki 地址。';
}
</script>
<template>
 <details class="wiki-directory" open>
  <summary>默认目录 · 中文 Wiki 模组列表</summary>
  <p class="next-help">当前游戏：{{currentVersion||'未识别'}} · 按适配声明优先，同组日期从新到旧。点击条目查看适配原文、发布信息和 README。</p>
  <p class="next-help">未读取发布信息时以 Wiki 更新日期排序；适配声明不代表实机验证，共用仓库的发布信息不套用到单个模组。</p>
  <div class="next-toolbar"><button :disabled="busy||loading" @click="refresh">刷新 Wiki 目录</button><button v-if="loading" @click="controller?.abort()">取消目录刷新</button><a :href="WIKI_URL" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" @click="external">查看 Wiki 原页 ↗</a></div>
  <label v-if="copyUrl" class="wiki-copy">复制 Wiki 地址<input :value="copyUrl" readonly aria-label="复制 Wiki 地址" @focus="($event.target as HTMLInputElement).select()"></label>
  <p v-if="loading||notice" role="status" :class="{'next-error':failed}">{{loading?'正在读取 Wiki 目录…':notice}}</p>
  <p v-if="catalog&&wikiCacheNeedsRefresh(catalog)" class="next-help wiki-cache-warning" role="status">目录缓存来自旧版，可能缺少作者、版本和日期。点击“刷新 Wiki 目录”可补全；当前缓存仍可离线查看。</p>
  <p v-if="!catalog" class="next-help">默认源已配置。首次刷新读取目录；之后可离线查看缓存。</p>
  <template v-else>
   <p class="next-help">中文 Wiki · 修订 {{catalog.revision}} · 缓存 {{new Date(catalog.fetchedAt).toLocaleString()}} · {{catalog.entries.length}} 个条目</p>
   <div class="next-toolbar"><input v-model="query" type="search" aria-label="搜索 Wiki 目录" placeholder="搜索模组、作者、版本或仓库…" maxlength="160"></div>
   <ul class="wiki-entries">
    <li v-for="entry in entries" :key="entry.id" class="wiki-entry" :data-entry="entry.id">
     <button class="wiki-entry-toggle" :aria-expanded="opened===entry.id" :disabled="opened!==entry.id&&(busy||loading)" @click="toggle(entry)">
      <span class="wiki-entry-heading"><strong>{{title(entry)}}</strong><span class="wiki-badge" :class="status(entry)">{{statusLabels[status(entry)]}}</span><span class="wiki-chevron">{{opened===entry.id?'收起 ▴':'详情 ▾'}}</span></span>
      <span class="wiki-summary-meta"><span>{{entry.author||'作者未记录'}}</span><span>{{entry.wikiVersion||'Wiki 版本未声明'}}</span><span>{{date(entry).label}}{{date(entry).value?' · '+date(entry).value.slice(0,10):''}}</span></span>
     </button>
     <section v-if="opened===entry.id" class="wiki-detail" :aria-label="entry.name+'详情'">
      <p class="wiki-compatibility"><strong>游戏适配 · Wiki 原文</strong><span>{{entry.compatibilityNotes||'未提取到明确版本声明。'}}</span></p>
      <small>{{entry.section}} · Wiki 版本 {{entry.wikiVersion||'未声明'}} · Wiki 更新 {{entry.wikiUpdatedAt||'未记录'}}</small>
      <div v-if="entry.repositories.length>1" class="wiki-repo-choices"><button v-for="repo in entry.repositories" :key="repo.key" :disabled="busy" :aria-pressed="chosen===repo.key" @click="selectRepo(repo)">{{repo.owner}}/{{repo.repo}}</button></div>
      <template v-for="repo in entry.repositories" :key="repo.key">
       <div v-if="chosen===repo.key" class="wiki-repository">
        <code>{{repo.owner}}/{{repo.repo}}</code>
        <p v-if="(repoUses.get(repo.key)||0)>1" class="next-help">此仓库对应多个目录条目，发布标签与 README 可能描述其他模组，请核对附件。</p>
        <div class="next-toolbar"><button :disabled="busy||loading||subscribed.includes(repo.key)" @click="emit('subscribe',repo)">{{subscribed.includes(repo.key)?'已在我的仓库':'加入并查询发布'}}</button></div>
        <p v-if="querying===repo.key" role="status">正在读取发布信息与 README…</p>
        <p v-if="queryErrors[repo.key]" class="next-error" role="status">{{queryErrors[repo.key]}}；收起后再展开可重试。</p>
        <div v-if="releases[repo.key]" class="wiki-release-info">
         <template v-if="releases[repo.key].length">
          <dl class="wiki-metadata"><div><dt>GitHub 发布标签</dt><dd>{{releases[repo.key][0].tag}} <small>{{releases[repo.key][0].prerelease?'预发布':'正式发布'}}</small></dd></div><div><dt>发布时间</dt><dd>{{displayMarketDate(releases[repo.key][0].publishedAt)}}</dd></div><div><dt>发布记录更新</dt><dd>{{displayMarketDate(releases[repo.key][0].updatedAt)}}</dd></div></dl>
          <p class="wiki-compatibility"><strong>游戏适配 · 作者发布原文</strong><span>{{releases[repo.key][0].compatibilityNotes||'未提取到明确版本声明，请核对作者说明及安装包。'}}</span></p>
         </template>
         <p v-else class="next-help">没有符合条件的发布版本，仍可查看 README。</p>
         <small>查询 {{checked[repo.key]}} · 发布标签不等于包内版本，记录更新也可能只是编辑说明。</small>
        </div>
        <h4>README · 仓库默认分支</h4>
        <p v-if="readmeErrors[repo.key]" class="next-error">{{readmeErrors[repo.key]}}；收起后再展开可重试。</p>
        <RepositoryReadme v-if="readmes[repo.key]" :text="readmes[repo.key].text" :url="readmes[repo.key].url" />
       </div>
      </template>
      <p v-if="!entry.repositories.length" class="next-help">名称栏没有可识别的 GitHub 仓库，请查看 Wiki 原页的下载说明。</p>
     </section>
    </li>
   </ul>
   <p v-if="!entries.length" class="next-help">没有匹配的条目。</p>
   <div class="next-toolbar"><button :disabled="page===0" @click="page--">上一页</button><span>{{page+1}} / {{totalPages}} · {{filtered.length}} 条</span><button :disabled="page+1>=totalPages" @click="page++">下一页</button></div>
  </template>
 </details>
</template>
<style scoped>
.wiki-directory{border:1px solid #484353;border-radius:16px;padding:6px 16px 14px;margin-bottom:22px;background:#201f28}.wiki-directory summary{font-weight:650}.wiki-entries{list-style:none;padding:0;margin:0}.wiki-entry{border-top:1px solid #3a3744;overflow-wrap:anywhere}.wiki-entry-toggle{display:block;width:100%;border:0;border-radius:8px;background:transparent;text-align:left;padding:16px 8px;white-space:normal}.wiki-entry-toggle:hover{background:#2b2735}.wiki-entry-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.wiki-entry-heading>strong{font-size:15px}.wiki-chevron{margin-left:auto;color:#b9afca;font-size:12px}.wiki-badge{font-size:11px;padding:3px 8px;border:1px solid #494252;border-radius:12px;color:#bdb2ce}.wiki-badge.supported{color:#b2d9c3;border-color:#476356}.wiki-badge.mismatch{color:#e1b99f;border-color:#6f5346}.wiki-summary-meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;color:#aaa5b7;font-size:12px}.wiki-detail{padding:0 12px 18px;border-left:2px solid #675678;margin-bottom:12px}.wiki-metadata{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.wiki-metadata dt{font-size:11px;color:#aaa5b7}.wiki-metadata dd{margin:5px 0 0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.wiki-compatibility{padding:10px 12px;background:#292531;border-left:2px solid #8c7ca7;border-radius:0 8px 8px 0;font-size:12px;line-height:1.6}.wiki-compatibility strong,.wiki-compatibility span{display:block}.wiki-compatibility strong{color:#c9bed8;font-size:11px;margin-bottom:4px}.wiki-repository{margin-top:14px}.wiki-repository code{white-space:normal;overflow-wrap:anywhere}.wiki-repo-choices{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.wiki-release-info{background:#1a1921;border:1px solid #433c50;border-radius:10px;margin-top:12px;padding:0 12px 12px}.wiki-copy input{display:block;width:100%}@media(max-width:600px){.wiki-directory{padding:4px 10px 12px}.wiki-metadata{grid-template-columns:1fr}.wiki-entry-toggle{padding:14px 4px}.wiki-summary-meta{gap:6px 12px}.wiki-detail{padding-left:8px;padding-right:0}.wiki-repo-choices button{width:100%}}
</style>
