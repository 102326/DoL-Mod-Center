<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,shallowRef,watch} from 'vue';
import LegacyPanel from './LegacyPanel.vue';
import {runtime,storage,emptyState,download,type State,type ModInfo,type Catalog} from './bridge';
const api=storage(),state=shallowRef<State>(emptyState()),catalog=shallowRef<Catalog>();
const opened=ref(false),tab=ref('local'),query=ref(''),busy=ref(false),message=ref(''),error=ref(false),changed=ref(false),preloads=ref(false);
const panel=ref<HTMLElement>(),list=ref<HTMLElement>(),file=ref<HTMLInputElement>(),detailHost=ref<HTMLElement>();
const detail=ref<{name:string;loaded:boolean}>();const pending=shallowRef<{text:string;action:()=>Promise<unknown>}>();
const tabs=[{id:'local',icon:'▦',name:'本地模组',sub:'安装与加载顺序'},{id:'diagnostics',icon:'◎',name:'运行诊断',sub:'错误与变更记录'},{id:'backups',icon:'◇',name:'备份与恢复',sub:'保护当前配置'},{id:'profiles',icon:'▤',name:'配置快照',sub:'保存名单与顺序'},{id:'beauty',icon:'◈',name:'美化图层',sub:'图片包与 type'}];
const activeTitle=computed(()=>tab.value==='details'?'模组详情':tabs.find(t=>t.id===tab.value)?.name);
const isPreload=(name:string)=>!state.value.packages.includes(name)&&state.value.preloaded.some(p=>p.name===name);
const managed=computed(()=>state.value.enabled.filter(n=>!isPreload(n)));
const info=(name:string):ModInfo=>catalog.value?.items.find(p=>p.name===name)||state.value.loaded.find(p=>p.name===name)||{name};
const matches=(p:ModInfo)=>(p.name+' '+(p.version||'')).toLowerCase().includes(query.value.toLowerCase());
const enabled=computed(()=>managed.value.map(info).filter(matches));
const other=computed(()=>[...new Set([...state.value.disabled,...state.value.orphans,...state.value.loaded.map(p=>p.name)])].filter(n=>!state.value.enabled.includes(n)&&!isPreload(n)).map(info).filter(matches));
const builtins=computed(()=>state.value.preloaded.filter(p=>isPreload(p.name)).filter(matches));
const protectedMod=(name:string)=>name==='DoLModCenter'&&!runtime.__DMC_BUILTIN;
const writable=(name:string)=>state.value.writable&&!busy.value&&!pending.value&&!protectedMod(name);
function notify(text:string,failed=false){message.value=text;error.value=failed;}
async function refresh(){let s:State;try{s=await api.read()}catch(e){state.value=emptyState();catalog.value=undefined;throw e}state.value=s;try{catalog.value=await api.catalog(s)}catch(e){catalog.value=undefined;notify('包资料读取失败：'+String(e),true)}}
async function run(fn:()=>Promise<unknown>,mutate=false){if(busy.value||runtime.DMCStorage.isBusy())return;busy.value=true;try{await fn();if(mutate){changed.value=true;await refresh();notify('配置已保存，重启游戏后生效。')}}catch(e){notify(String(e),true)}finally{busy.value=false;await bindDrag()}}
function confirm(text:string,action:()=>Promise<unknown>){pending.value={text,action};}
async function accept(){const p=pending.value;pending.value=undefined;if(p)await run(p.action,true)}
function toggle(p:ModInfo){const s=state.value,on=!s.enabled.includes(p.name);confirm((on?'启用':'禁用')+'“'+p.name+'”？',()=>api.toggle(s,p.name,on))}
async function remove(p:ModInfo){await run(async()=>{const token=await api.prepare(state.value,p.name);confirm('删除“'+p.name+'”？建议先导出 ZIP。',()=>api.remove(token,p.name))})}
async function importFile(e:Event){const input=e.target as HTMLInputElement,f=input.files?.[0];input.value='';if(!f)return;await run(async()=>{if(f.size>268435456)throw Error('文件超过 256 MiB');const bytes=new Uint8Array(await f.arrayBuffer()),i=await api.inspect(bytes),token=await api.prepare(state.value,i.name);confirm('导入“'+i.name+'” '+i.version+'？'+(state.value.packages.includes(i.name)?' 将替换同名本地包。':''),()=>api.install(token,bytes))})}
async function exportZip(p:ModInfo){await run(async()=>{await download(await api.exportZip(p.name),p.name.replace(/[\\/:*?"<>|]/g,'_')+'.zip');notify('已发起 ZIP 导出，请确认系统保存结果。')})}
async function details(p:ModInfo,loaded=!state.value.packages.includes(p.name)){detail.value={name:p.name,loaded};tab.value='details';await nextTick();if(!detailHost.value)return;detailHost.value.textContent='正在读取…';await run(async()=>{const i=await(loaded?api.loadedDetails(p.name):api.details(p.name));if(detailHost.value)runtime.DMCModInfo.render(detailHost.value,i)})}
async function sort(){await run(async()=>{const token=await api.catalog(state.value),fixed=new Set(token.preloaded.filter(p=>!token.items.some(i=>i.name===p.name)).map(p=>p.name)),names=token.enabled.filter(n=>!fixed.has(n));
 const items=names.map(n=>{const p=token.items.find(i=>i.name===n);if(!p||p.error)throw Error('无法读取前置：'+n);return {...p,beauty:runtime.DMCPackage.describe(p.bootJson).beauty}});
 const external=[...token.preloaded,...state.value.loaded.filter(p=>!token.enabled.includes(p.name)&&!token.disabled.includes(p.name)&&!token.preloaded.some(x=>x.name===p.name))].filter(p=>!names.includes(p.name));
 const plan=runtime.DMCSort.plan(items,{external,disabled:token.disabled.filter(n=>!fixed.has(n)),loaderVersion:runtime.modUtils?.version||'',checkVersion:(v:string,r:string)=>{try{const sv=runtime.modSC2DataManager?.getDependenceChecker?.().getInfiniteSemVerApi();return sv?.satisfies(sv.parseVersion(v).version,sv.parseRange(r))}catch{return undefined}}});
 if(plan.errors.length)throw Error(plan.errors.join('；'));if(!plan.changed){notify('当前顺序已符合规则。'+plan.warnings.join('；'));return}let i=0;const order=token.enabled.map(n=>fixed.has(n)?n:plan.order[i++]);confirm('建议顺序：\n'+order.join(' → ')+'\n'+plan.warnings.join('；'),()=>api.reorderCatalog(token,order));
})}
let drag:{destroy():void}|undefined;
async function bindDrag(){drag?.destroy();drag=undefined;await nextTick();if(!list.value||tab.value!=='local'||busy.value||query.value||pending.value)return;const s=state.value,order=[...managed.value];drag=runtime.DMCDrag.bind(list.value,{onDrop:(name:string,index:number)=>run(()=>api.move(s,name,s.enabled.indexOf(order[index])),true),onAnnounce:(text:string)=>notify(text)})}
watch([tab,query,pending],()=>bindDrag());
let previous:Element|null=null,oldOverflow='';
async function open(){if(opened.value)return;previous=document.activeElement;oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';opened.value=true;await nextTick();panel.value?.focus();await run(refresh)}
function release(){if(!opened.value)return;opened.value=false;pending.value=undefined;drag?.destroy();document.body.style.overflow=oldOverflow;(previous as HTMLElement)?.focus?.()}
function close(){if(busy.value||runtime.DMCStorage.isBusy()||runtime.DMCRescue?.isBusy?.()){notify('请等待当前操作完成。');return}release()}
function key(e:KeyboardEvent){if(!opened.value)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(pending.value)pending.value=undefined;else if(tab.value==='details')tab.value='local';else close()}if(e.key==='Tab'){const nodes=[...panel.value!.querySelectorAll<HTMLElement>('button,input,a[href],select,textarea,summary')].filter(n=>!n.hasAttribute('disabled')&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.value)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}
function back(e:Event){if(opened.value){e.preventDefault();e.stopImmediatePropagation();if(pending.value)pending.value=undefined;else if(tab.value==='details')tab.value='local';else close()}}
onMounted(()=>{runtime.DMCNext={open,close,fail:release};document.addEventListener('backbutton',back,true)});
onBeforeUnmount(()=>{drag?.destroy();document.removeEventListener('backbutton',back,true);if(opened.value)document.body.style.overflow=oldOverflow;delete runtime.DMCNext});
</script>
<template>
<div v-show="opened" class="dmc-next" @keydown="key">
 <section ref="panel" class="next-window" role="dialog" aria-modal="true" aria-labelledby="next-title" tabindex="-1">
  <aside class="next-nav"><div class="next-brand"><span class="next-logo">◈</span><div><strong>MOD CENTER</strong><small>新版工作台 · 2.0 Preview</small></div></div>
   <nav aria-label="新版模组中心"><button v-for="t in tabs" :key="t.id" :class="{selected:tab===t.id}" :disabled="busy||!!pending" @click="tab=t.id"><span>{{t.icon}}</span><div>{{t.name}}<small>{{t.sub}}</small></div></button></nav>
   <div class="next-nav-foot"><span class="next-dot" /> 本地运行 · 无需联网</div>
  </aside>
  <div class="next-main"><header><div><small class="next-eyebrow">WORKSPACE / {{ tab.toUpperCase() }}</small><h2 id="next-title">{{activeTitle}}</h2></div><button aria-label="关闭模组中心" class="next-close" @click="close">×</button></header>
   <div class="next-notice" role="status" :class="{failure:error}">{{busy?'正在处理，请稍候…':message||'你的模组，你的配置。'}}<span v-if="changed"> · 更改需重启</span></div>
   <div v-if="pending" class="next-confirm" role="alertdialog" aria-label="确认配置修改"><p>{{pending.text}}</p><button @click="accept">确认</button><button @click="pending=undefined">取消</button></div>
   <main class="next-scroll dmc-content">
    <section v-if="tab==='local'">
     <div class="next-overview"><div><small>本地包</small><strong>{{state.packages.length}}</strong></div><div><small>下次启用</small><strong>{{state.enabled.length}}</strong></div><div><small>当前挂载</small><strong>{{state.loaded.length}}</strong></div><div><small>缺失引用</small><strong :class="{danger:state.missing.length}">{{state.missing.length}}</strong></div></div>
     <div class="next-toolbar mc:flex mc:flex-wrap mc:gap-2"><input v-model="query" type="search" aria-label="搜索模组" placeholder="搜索模组名称或版本…"><button class="primary" :disabled="busy||!!pending||!state.writable" @click="file?.click()">＋ 导入 ZIP</button><button :disabled="busy||!!pending" @click="run(refresh)">刷新</button><button :disabled="busy||!!pending||!state.writable" @click="sort">按前置排序</button><button :disabled="busy||!!pending" @click="confirm('已保存游戏？确认重启游戏？',async()=>{runtime.location.reload()})">重启</button><input ref="file" type="file" accept=".zip" hidden @change="importFile"></div>
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
    <section v-if="tab==='details'"><div class="next-toolbar mc:flex mc:flex-wrap mc:gap-2"><button @click="tab='local'">← 返回列表</button><button v-if="detail&&state.packages.includes(detail.name)&&state.loaded.some(p=>p.name===detail!.name)" :disabled="busy" @click="details({name:detail!.name},!detail!.loaded)">{{detail.loaded?'查看本地包':'查看已挂载包'}}</button></div><p class="next-help">{{detail?.loaded?'本次运行包资料':'本地包资料，下次启动使用'}}</p><article ref="detailHost" class="next-detail" /></section>
    <LegacyPanel v-for="kind in ['diagnostics','backups','profiles','beauty']" :key="kind" :kind="kind" :api="api" :active="tab===kind&&opened" />
   </main>
   <footer><span>离线模组管理</span><span>本地配置工作台</span></footer>
  </div>
 </section>
</div>
</template>
