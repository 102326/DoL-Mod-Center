/* Independent of Vue: available only after this mod's scripts have loaded. */
(function(root){
 'use strict';
 let host,api,record,working=false,token,notice,observedError=false,destroyed=false;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const button=(text,action)=>{const n=el('button',text);n.type='button';n.onclick=action;return n;};
 async function run(action){if(working)return;working=true;try{await action();}catch(e){notice.textContent=String(e.message||e);}finally{working=false;}}
 function render(){
  host.replaceChildren();notice=el('p',observedError?'本次会话检测到错误。它不一定由上次导入造成，可检查恢复点。':'上次模组导入尚待验证。游戏正常时，可在备份与恢复中确认保留配置。');host.append(notice);
  host.append(button('检查启动恢复',()=>run(async()=>{
   token=await api.prepareRecovery();host.replaceChildren();notice=el('p','恢复更新前的模组包与配置？新增包保留并停用，不恢复存档。之后需手动重启。');host.append(notice);
   host.append(button('确认恢复模组配置',()=>run(async()=>{await api.rollbackRecovery(token);token=undefined;host.replaceChildren(el('p','模组配置已恢复，请手动重启游戏。'),button('关闭',()=>host.remove()));})),button('取消',()=>{if(!working){token=undefined;render();}}));
  })),button('稍后处理',()=>{if(!working)host.remove();}));
 }
 async function start(){
  if(destroyed||host||!root.DMCStorage)return;
  api=root.DMCJournal?.wrap(root.DMCStorage.create())||root.DMCStorage.create();
  try{record=await api.readRecovery();}catch(_){return;}
  if(destroyed||!record||record.pendingRestart)return;
  host=el('section');host.id='dmc-startup-recovery';host.setAttribute('role','region');host.setAttribute('aria-label','启动恢复提示');
  const style=el('style');style.textContent='#dmc-startup-recovery{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:100070;max-width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:16px;border:1px solid #77738d;border-radius:16px;background:#202027;color:#eee;font:14px/1.5 system-ui;box-shadow:0 8px 30px #0008}#dmc-startup-recovery p{margin:0 0 10px}#dmc-startup-recovery button{min-height:44px;margin:4px;padding:8px 12px;border:1px solid #656174;border-radius:12px;background:#35333f;color:#eee}';document.head.append(style);
  host._style=style;render();document.body.append(host);
 }
 function error(){observedError=true;if(host?.isConnected&&!working&&!token)render();}
 root.addEventListener('error',error);root.addEventListener('unhandledrejection',error);
 document.addEventListener('DOMContentLoaded',start,{once:true});if(document.readyState!=='loading')void start();
 root.DMCStartupRecovery={start,destroy(){destroyed=true;document.removeEventListener('DOMContentLoaded',start);root.removeEventListener('error',error);root.removeEventListener('unhandledrejection',error);host?._style?.remove();host?.remove();}};
})(window);
