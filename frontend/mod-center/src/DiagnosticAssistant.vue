<script setup lang="ts">
import {computed,ref} from 'vue';
import {runtime,type State,type Catalog} from './bridge';
const props=defineProps<{state:State;catalog?:Catalog;busy:boolean}>();
const emit=defineEmits<{inspect:[name:string];refresh:[];recovery:[]}>();
const findings=ref<any[]>([]),notes=ref<string[]>([]),checked=ref(false),query=ref(''),level=ref('all');
const visible=computed(()=>findings.value.filter(f=>(level.value==='all'||f.severity===level.value)&&[f.title,...f.evidence,...f.modNames].join(' ').toLowerCase().includes(query.value.toLowerCase())));
function check(){
 const snapshot=runtime.DMCDiagnostics?.snapshot?.();
 const gameVersion=runtime.DMCAssistant.gameVersion(runtime);
 notes.value=snapshot?.notes?.filter((n:string)=>!n.includes('游戏本体与加载器版本依赖依靠加载日志判断'))||['运行日志尚未就绪；未发现错误不代表没有错误。'];
 notes.value=[...notes.value,gameVersion?`游戏构建版本：${gameVersion}（StartConfig.version）；仅读取版本元数据。`:'未能读取游戏构建版本；游戏版本兼容性仍待核对。'];
 findings.value=runtime.DMCAssistant.analyze({state:props.state,catalog:props.catalog,logs:snapshot?.groups||[],changes:runtime.DMCJournal?.list?.()||[],gameVersion,loaderVersion:runtime.modUtils?.version,checkVersion:(v:string,r:string)=>{try{const a=runtime.modSC2DataManager?.getDependenceChecker?.().getInfiniteSemVerApi?.();return a?.satisfies(a.parseVersion(v).version,a.parseRange(r))}catch{return undefined}}});
 checked.value=true;
}
function exportReport(){
 const text='DoL Mod Center 2.1 本地诊断\n'+JSON.stringify({checkedAt:new Date().toISOString(),findings:findings.value,notes:notes.value},null,2);
 void import('./bridge').then(({download})=>download(new TextEncoder().encode(text),'dol-mod-center-diagnosis.txt')).catch(e=>{notes.value=[String(e),...notes.value]});
}
defineExpose({check});
</script>
<template>
 <section class="next-assistant">
  <div class="next-toolbar"><button class="primary" :disabled="busy" @click="emit('refresh')">开始检查</button><button :disabled="!checked||busy" @click="exportReport">导出检查结果</button><button :disabled="busy" @click="emit('recovery')">备份与恢复</button></div>
  <p class="next-help">本地规则分析，无需联网。配置检查面向下次启动；日志反映当前会话，最近操作仅作为排查线索。</p>
  <div v-if="checked" class="next-toolbar"><input v-model="query" type="search" aria-label="搜索诊断" placeholder="搜索问题或模组…"><select v-model="level" aria-label="诊断级别"><option value="all">全部级别</option><option value="error">错误</option><option value="warning">警告</option><option value="info">信息</option></select></div>
  <p v-if="checked&&!findings.length">在本次可检查范围内未发现问题。</p>
  <article v-for="f in visible" :key="f.id" class="next-card next-finding" :class="{'next-error':f.severity==='error'}">
   <div><span class="next-tag">{{f.certainty==='confirmed'?'已确认问题':f.certainty==='possible'?'排查线索':'信息不足'}}</span><h3>{{f.title}}</h3><p v-for="(e,i) in f.evidence" :key="i">{{e}}</p><p>{{f.suggestion}}</p><div class="next-actions"><button v-for="name in f.modNames.filter((n:string)=>state.packages.includes(n)||state.loaded.some(p=>p.name===n))" :key="name" :disabled="busy" @click="emit('inspect',name)">查看 {{name}}</button></div></div>
  </article>
  <details v-if="checked" class="next-card"><summary>检查范围与限制</summary><p v-for="n in notes" :key="n">{{n}}</p></details>
 </section>
</template>
