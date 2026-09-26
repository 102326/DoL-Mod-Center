import {createApp, type App as VueApp} from 'vue';
import App from './App.vue';
import {runtime} from './bridge';
import './style.css';

type EntryHandle={attach?:()=>void;destroy?:()=>void};
let app:VueApp<Element>|undefined;
let host:HTMLDivElement|undefined;
let errorPanel:HTMLDivElement|undefined;
let entries:EntryHandle|undefined;
let destroyed=false;
let starting=false;

function releaseShell(){runtime.DMCNext?.fail?.();if(host)host.style.display='none';}
function clearError(){errorPanel?.remove();errorPanel=undefined;}
function showError(){
 if(errorPanel)return;
 releaseShell();
 errorPanel=document.createElement('div');errorPanel.className='dmc-next-error';errorPanel.setAttribute('role','alert');
 const title=document.createElement('strong');title.textContent='模组中心暂时无法显示';
 const message=document.createElement('p');message.textContent='界面暂时不可用，可以重试或稍后再打开。';
 const close=document.createElement('button');close.type='button';close.textContent='关闭';close.onclick=clearError;
 const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=()=>{
  if(destroyed)return;
  if(runtime.DMCStorage?.isBusy?.()||runtime.DMCRescue?.isBusy?.()){message.textContent='配置操作仍在处理中，请完成后再重试。';return;}
  clearError();
  if(!host)start();
  else {app?.unmount();app=undefined;host.replaceChildren();mount();if(app&&!entries){entries=runtime.DMCEntries.create(open);entries?.attach?.();}}
  if(host&&runtime.DMCNext){host.style.display='';runtime.DMCNext.open();}
 };
 errorPanel.append(title,message,close,retry);document.body.append(errorPanel);
}
function mount(){
 if(!host||destroyed||app)return;
 app=createApp(App);app.config.errorHandler=(error)=>{console.error('[DoLModCenter Vue]',error);showError();};
 try{app.mount(host);}catch(error){console.error('[DoLModCenter Vue startup]',error);app=undefined;showError();}
}
function open(){
 if(destroyed)return;
 clearError();if(!app)mount();
 if(!runtime.DMCNext){showError();return;}
 if(host)host.style.display='';return runtime.DMCNext.open();
}
function close(){runtime.DMCNext?.close?.();}
function destroy(){
 if(destroyed)return;destroyed=true;document.removeEventListener('DOMContentLoaded',start);
 if(runtime.jQuery)runtime.jQuery(document).off('.dmcNextShell');
 entries?.destroy?.();entries=undefined;runtime.DMCDiagnostics?.destroy?.();runtime.DMCNext?.fail?.();
 app?.unmount();app=undefined;host?.remove();host=undefined;clearError();
 if(runtime.DoLModCenter?.destroy===destroy)delete runtime.DoLModCenter;
 delete runtime.__DMC_NEXT_SHELL__;
}
function start(){
 if(destroyed||starting)return;
 if(runtime.DMCNext){entries?.attach?.();return;}
 if(!runtime.DMCStorage||!runtime.DMCEntries?.create)return;
 starting=true;
 try{host=document.createElement('div');host.id='dmc-next-root';host.style.display='none';document.body.append(host);runtime.DoLModCenter={open,close,destroy};mount();if(app){entries=runtime.DMCEntries.create(open);entries?.attach?.();}}
 catch(error){console.error('[DoLModCenter Vue startup]',error);app?.unmount();app=undefined;entries?.destroy?.();entries=undefined;host?.remove();host=undefined;delete runtime.DoLModCenter;showError();}
 finally{starting=false;}
}
const shellKey='__DMC_NEXT_SHELL__';
if(!runtime[shellKey]){runtime[shellKey]=true;if(runtime.jQuery)runtime.jQuery(document).on(':passageend.dmcNextShell :storyready.dmcNextShell',start);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();}
