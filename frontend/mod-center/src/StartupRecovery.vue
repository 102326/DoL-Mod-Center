<script setup lang="ts">
import {onMounted,ref,shallowRef} from 'vue';
import {type Storage} from './bridge';
const props=defineProps<{api:Storage;busy:boolean}>(),emit=defineEmits<{changed:[]}>();
const recovery=ref<any>(),message=ref(''),working=ref(false),token=shallowRef<object>(),dismiss=ref(false);
async function refresh(){recovery.value=await props.api.readRecovery();}
async function run(fn:()=>Promise<void>){if(working.value||props.busy)return;working.value=true;try{await fn()}catch(e){message.value=String(e)}finally{working.value=false}}
onMounted(()=>run(refresh));
function cancelPending(){if(working.value)return true;if(token.value||dismiss.value){token.value=undefined;dismiss.value=false;return true}return false}
defineExpose({cancelPending,isWorking:()=>working.value});
</script>
<template>
 <section v-if="recovery||message||working" class="next-card next-recovery"><div><h3>启动恢复</h3><p>保存最近一次导入前的旧包体与配置。不包含存档、游戏本体或美化图层设置。</p><p>普通模组版需管理器成功加载才能使用；无法覆盖管理器自身加载失败、WebView 崩溃或早期白屏。</p>
 <p role="status">{{message}}</p><p v-if="!recovery">暂无待处理的恢复点。</p>
 <template v-else><p>{{recovery.createdAt}} · {{recovery.names.join('、')}}</p><p>{{recovery.pendingRestart?'等待重启验证。':'上次导入后已重新打开游戏。若看起来正常，可以保留当前配置；这不是完整兼容性验证。'}}</p>
 <div class="next-toolbar"><button :disabled="busy||working" @click="run(async()=>{token=await api.prepareRecovery();dismiss=false;message=''})">检查并撤销上次导入</button><button :disabled="busy||working" @click="dismiss=true;token=undefined">保留当前配置</button></div>
 <div v-if="token" role="alertdialog" aria-label="确认启动恢复"><p>将恢复更新前的包和启停顺序。新增包保留但停用，存档不变；完成后需重启。</p><button :disabled="busy||working" @click="run(async()=>{await api.rollbackRecovery(token!);token=undefined;await refresh();message='模组配置已恢复，请重启游戏。';emit('changed')})">确认恢复模组配置</button><button :disabled="working" @click="token=undefined">取消</button></div>
 <div v-if="dismiss" role="alertdialog" aria-label="确认保留当前配置"><p>确认保留当前配置？这会释放旧包恢复点，之后无法通过此入口撤销本次导入。</p><button :disabled="busy||working" @click="run(async()=>{await api.dismissRecovery(recovery.id);dismiss=false;await refresh();message='已保留当前配置。'})">确认保留</button><button :disabled="working" @click="dismiss=false">取消</button></div>
 </template></div></section>
</template>
