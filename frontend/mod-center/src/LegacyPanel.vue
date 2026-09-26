<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {runtime,type Storage} from './bridge';
const props=defineProps<{kind:string;api:Storage;active:boolean}>();
const host=ref<HTMLElement>();let mounted=false,view:{destroy():void}|undefined;
function activate(){if(!props.active||!host.value)return;
 if(props.kind==='diagnostics'){runtime.DMCDiagnostics.mount(host.value);return;}
 if(mounted)return;mounted=true;
 if(props.kind==='backups')runtime.DMCBackupUI.mount(host.value,props.api);
 if(props.kind==='profiles')runtime.DMCConfigProfiles.mount(host.value,props.api);
 if(props.kind==='beauty')view=runtime.DMCBeautyUI.mount(host.value,{notify:(s:string)=>{notice.value=s},isBusy:()=>runtime.DMCStorage.isBusy(),runTask:async(fn:()=>Promise<void>)=>{try{await fn()}catch(e){notice.value=String(e)}},openPackage:(name:string)=>{notice.value='请在本地模组中查看“'+name+'”详情。'}});
}
const notice=ref('');onMounted(activate);watch(()=>props.active,activate);onBeforeUnmount(()=>view?.destroy());
</script>
<template><section v-show="active" class="next-legacy"><p v-if="notice" role="status">{{notice}}</p><div ref="host" /></section></template>
