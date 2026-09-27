<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from 'vue';
import {runtime} from './bridge';

const props=defineProps<{text:string;url:string}>();
const host=ref<HTMLElement|null>(null);
const address=ref('');
const notice=ref('');
const copied=ref(false);

function safeUrl(value:string):string|null{
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value))return null;
  try{
    const url=new URL(value);
    if((url.protocol!=='http:'&&url.protocol!=='https:')||url.username||url.password)return null;
    return url.href;
  }catch{return null;}
}

const sourceUrl=computed(()=>safeUrl(props.url));

function renderReadme(){
  const target=host.value;
  if(!target)return;
  address.value='';
  notice.value='';
  copied.value=false;
  if(typeof runtime.DMCMarkdown?.render==='function'){
    try{
      runtime.DMCMarkdown.render(target,props.text);
      return;
    }catch(_){
      // A renderer failure still gets a safe, readable representation below.
    }
  }
  target.textContent=String(props.text??'');
}

function showAddress(value:string,message='当前 APK 没有可用的外部浏览器接口，请复制地址到浏览器打开。'){
  address.value=value;
  notice.value=message;
  copied.value=false;
  void nextTick(()=>{
    const input=host.value?.parentElement?.querySelector<HTMLInputElement>('.dmc-readme-address');
    input?.focus();
    input?.select();
  });
}

function openExternal(value:string){
  const safe=safeUrl(value);
  if(!safe){
    notice.value='此 README 链接不是受支持的 HTTP(S) 地址。';
    address.value='';
    return;
  }
  const open=runtime.cordova?.InAppBrowser?.open;
  if(typeof open==='function'){
    try{
      open.call(runtime.cordova.InAppBrowser,safe,'_system');
      return;
    }catch(_){
      // Show a copyable address when the bridge rejects the request.
    }
  }
  showAddress(safe);
}

function onRootClick(event:MouseEvent){
  const target=event.target;
  if(!(target instanceof Element))return;
  const link=target.closest('a');
  if(!link)return;
  const safe=safeUrl(link.getAttribute('href')||'');
  if(safe&&!runtime.cordova)return;
  event.preventDefault();
  event.stopPropagation();
  openExternal(link.getAttribute('href')||'');
}

async function copyAddress(){
  if(!address.value)return;
  try{
    await navigator.clipboard.writeText(address.value);
    copied.value=true;
    notice.value='地址已复制，可粘贴到外部浏览器打开。';
  }catch(_){
    const input=host.value?.parentElement?.querySelector<HTMLInputElement>('.dmc-readme-address');
    input?.focus();
    input?.select();
    notice.value='请长按或使用系统复制按钮复制地址。';
  }
}

onMounted(renderReadme);
watch(()=>props.text,renderReadme);
</script>

<template>
 <section class="dmc-repository-readme" @click.capture="onRootClick">
  <p class="dmc-readme-source">
   <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">查看 GitHub README</a>
   <span v-else>GitHub README 地址不可用</span>
   <span class="dmc-readme-source-note">README 中的相对资源请查看源页。</span>
  </p>
  <p v-if="notice" class="dmc-readme-notice" role="status">{{notice}}</p>
  <div ref="host" class="dmc-readme-content" aria-label="GitHub README 内容"></div>
  <div v-if="address" class="dmc-readme-fallback">
   <input class="dmc-readme-address" :value="address" readonly aria-label="可复制的 README 地址">
   <button type="button" @click="copyAddress">{{copied?'已复制':'复制地址'}}</button>
  </div>
 </section>
</template>

<style scoped>
.dmc-repository-readme{min-width:0;max-width:100%;overflow-wrap:anywhere;color:#e4e4e9;background:#19191f;border:1px solid #363640;border-radius:16px;padding:16px;color-scheme:dark}
.dmc-readme-source{margin:0 0 12px;font-size:13px}.dmc-readme-source a{color:#b7c8ff}.dmc-readme-source-note{display:block;margin-top:5px;color:#92929f;font-size:12px}.dmc-readme-notice{margin:0 0 12px;color:#d5c99b;font-size:12px;overflow-wrap:anywhere}
.dmc-readme-content{min-width:0;max-width:100%;overflow-wrap:anywhere}.dmc-readme-content :deep(pre){max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#121217;border-radius:10px;padding:12px}.dmc-readme-content :deep(code){overflow-wrap:anywhere}.dmc-readme-content :deep(table){display:block;max-width:100%;overflow:auto;border-collapse:collapse}.dmc-readme-content :deep(th),.dmc-readme-content :deep(td){border:1px solid #3c3c48;padding:7px;text-align:left}.dmc-readme-content :deep(blockquote){margin-left:0;padding-left:12px;border-left:3px solid #c4c7f5;color:#bdbdca}.dmc-readme-content :deep(img){max-width:100%;height:auto}.dmc-readme-content :deep(.dmc-md-image-load){max-width:100%;white-space:normal}
.dmc-readme-fallback{display:flex;gap:8px;align-items:stretch;margin-top:12px;min-width:0}.dmc-readme-address{flex:1;min-width:0;max-width:100%;border:1px solid #3c3c48;border-radius:10px;background:#121217;color:#d5d5df;padding:9px}.dmc-readme-fallback button{border:1px solid #3c3c48;border-radius:10px;background:#292930;color:#e4e4e9;padding:9px 12px;cursor:pointer;white-space:nowrap}
@media(max-width:600px){.dmc-repository-readme{padding:12px}.dmc-readme-fallback{flex-direction:column}.dmc-readme-fallback button{width:100%;min-height:40px}}
</style>
