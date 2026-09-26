import {createApp} from 'vue';
import App from './App.vue';
import {runtime} from './bridge';
import './style.css';
function start(){
 if(runtime.DMCNext||!runtime.DoLModCenter||!runtime.DMCStorage)return;
 const host=document.createElement('div');host.id='dmc-next-root';document.body.append(host);
 const classicOpen=runtime.DoLModCenter.open.bind(runtime.DoLModCenter);
 runtime.DMCClassicOpen=classicOpen;
 const app=createApp(App);
 app.config.errorHandler=(error)=>{console.error('[DoLModCenter Vue]',error);runtime.DMCNext?.fail();host.style.display='none';classicOpen()};
 try{app.mount(host)}catch(e){console.error('[DoLModCenter Vue startup]',e);host.remove();return;}
 if(!runtime.DMCNext){app.unmount();host.remove();return;}
 runtime.DoLModCenter.open=()=>{host.style.display='';return runtime.DMCNext?.open()||classicOpen()};
 const intercept=(e:MouseEvent)=>{if((e.target as Element)?.closest?.('#dmc-sidebar-button')){e.preventDefault();e.stopImmediatePropagation();host.style.display='';runtime.DMCNext.open()}};
 document.addEventListener('click',intercept,true);
 const button=document.createElement('button');button.textContent='打开新版界面';button.type='button';button.onclick=()=>{host.style.display='';runtime.DMCNext.open()};document.querySelector('.dmc-header')?.append(button);
 const destroy=runtime.DoLModCenter.destroy.bind(runtime.DoLModCenter);
 runtime.DoLModCenter.destroy=()=>{document.removeEventListener('click',intercept,true);app.unmount();host.remove();button.remove();delete runtime.DMCClassicOpen;destroy()};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
