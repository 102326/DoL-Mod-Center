<script setup lang="ts">
import {computed,ref,shallowRef,watch} from 'vue';
import {validateFiles,validateSelection,type LibraryFile} from './local-library';

const props=defineProps<{active:boolean;busy:boolean;reading:boolean;progress:string}>();
const emit=defineEmits<{select:[files:LibraryFile[],autoSort:boolean];cancel:[]}>();
const input=ref<HTMLInputElement>();
const files=shallowRef<LibraryFile[]>([]),selected=ref<string[]>([]),query=ref(''),order=ref<'modified'|'name'|'size'>('modified'),autoSort=ref(true),notice=ref('');
const locked=computed(()=>props.busy||props.reading);
const matches=computed(()=>files.value.filter(file=>file.name.toLowerCase().includes(query.value.trim().toLowerCase())).sort((a,b)=>order.value==='name'?a.name.localeCompare(b.name):order.value==='size'?b.size-a.size||a.name.localeCompare(b.name):b.modified-a.modified||a.name.localeCompare(b.name)));
const picked=computed(()=>files.value.filter(file=>selected.value.includes(file.id)));
const total=computed(()=>files.value.reduce((sum,file)=>sum+file.size,0));
const pickedTotal=computed(()=>picked.value.reduce((sum,file)=>sum+file.size,0));
watch(()=>props.active,active=>{if(!active){query.value='';selected.value=[];notice.value=''}});
function openInput(){if(!locked.value)input.value?.click()}
function addFiles(event:Event){
 const target=event.target as HTMLInputElement;
 const incoming=[...(target.files||[])];
 target.value='';
 if(!incoming.length||locked.value||!props.active)return;
 try{
  const existing=files.value;
  const seen=new Set(existing.map(file=>`${file.name}\0${file.size}\0${file.modified}`));
  const added:LibraryFile[]=[];let skipped=0;
  for(const file of incoming){
   if(!/\.zip$/i.test(file.name))throw Error(`仅支持 ZIP：${file.name}`);
   const key=`${file.name}\0${file.size}\0${file.lastModified}`;
   if(seen.has(key)){skipped++;continue}
   seen.add(key);
   added.push({id:key,name:file.name,size:file.size,modified:file.lastModified,file});
  }
  const next=validateFiles([...existing,...added]);
  if(next.length)validateSelection(next);
  files.value=next;
  notice.value=(added.length?'已加入 '+added.length+' 个 ZIP。':'没有新增 ZIP。')+(skipped?' 已跳过 '+skipped+' 个名称、大小、修改时间都相同的文件（仅元数据去重）。':'');
 }catch(error){notice.value=String(error)}
}
function toggle(id:string){if(locked.value)return;selected.value=selected.value.includes(id)?selected.value.filter(item=>item!==id):[...selected.value,id]}
function removeSelected(){if(locked.value)return;const remove=new Set(selected.value);files.value=files.value.filter(file=>!remove.has(file.id));selected.value=[]}
function clearFiles(){if(locked.value)return;files.value=[];selected.value=[];notice.value='已清空待导入列表。'}
function submit(){if(locked.value||!props.active)return;try{validateSelection(picked.value);emit('select',picked.value,autoSort.value)}catch(error){notice.value=String(error)}}
</script>
<template>
 <section v-if="active" class="local-library" aria-label="待导入列表">
  <h3>待导入列表</h3>
  <p class="next-help">未安装的文件只在本次页面保留；确认安装后在本地模组管理。添加 ZIP 可重复选择并累积到列表。</p>
  <div class="next-toolbar"><button class="primary" :disabled="locked" @click="openInput">＋ 添加 ZIP</button><button :disabled="locked||!selected.length" @click="removeSelected">移除所选</button><button :disabled="locked||!files.length" @click="clearFiles">清空</button><input ref="input" type="file" accept=".zip,application/zip" multiple hidden @change="addFiles"></div>
  <div class="next-toolbar"><input v-model="query" :disabled="locked" type="search" aria-label="搜索待导入文件" placeholder="搜索文件名…"><select v-model="order" :disabled="locked" aria-label="文件排序"><option value="modified">最近修改优先</option><option value="name">名称</option><option value="size">大小</option></select></div>
  <p v-if="notice||props.progress" role="status">{{props.progress||notice}}</p>
  <ul v-if="matches.length"><li v-for="file in matches" :key="file.id"><label><input type="checkbox" :checked="selected.includes(file.id)" :disabled="locked" @change="toggle(file.id)"><span>{{file.name}}<small>{{(file.size/1048576).toFixed(2)}} MiB · {{file.modified?new Date(file.modified).toLocaleString():'修改时间未提供'}}</small></span></label></li></ul>
  <p v-else>{{files.length?'没有符合条件的 ZIP 文件。':'还没有选择 ZIP。'}}</p>
  <p>列表 {{files.length}} / 100 个 · {{(total/1048576).toFixed(2)}} / 256 MiB；已选 {{picked.length}} 个 · {{(pickedTotal/1048576).toFixed(2)}} MiB</p>
  <label><input v-model="autoSort" type="checkbox" :disabled="locked">预检时按前置依赖整理加载顺序</label>
  <div class="next-toolbar"><button :disabled="locked||!selected.length" @click="submit">预检所选 ZIP</button><button v-if="props.reading" @click="emit('cancel')">取消读取</button></div>
 </section>
</template>
<style scoped>
.local-library{padding:12px;border:1px solid #595164;border-radius:12px;margin:12px 0}.local-library ul{list-style:none;padding:0;max-height:45vh;overflow:auto}.local-library li{border-bottom:1px solid #595164;padding:10px 0}.local-library li label{display:flex;gap:10px;align-items:center}.local-library li span{min-width:0;overflow-wrap:anywhere}.local-library small{display:block;margin-top:4px;opacity:.75}.local-library select{max-width:100%;color:inherit;background:#27232d;padding:8px}
</style>
