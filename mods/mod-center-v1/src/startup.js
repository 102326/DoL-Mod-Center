/* Built-in distribution only: gate before any third-party mod startInit/preload. */
(function(root){
 'use strict';
 let resolveStart,gate,message,api,started=false,failed=false,confirming=false;
 const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const button=(text,fn)=>{const e=node('button',text);e.type='button';e.onclick=fn;return e;};
 function show(){gate.hidden=false;}
 function wait(){
  if(gate)return new Promise(()=>{});
  api=root.DMCJournal?.wrap(root.DMCStorage.create())||root.DMCStorage.create();gate=node('section');gate.id='dmc-startup';
  root.modModLoadController.addLifeTimeCircleHook('DoLModCenterBuiltIn',{canLoadThisMod:boot=>!['DoLModCenter','DoLWorkbench','DoLDiagnostics','ModHub'].includes(boot?.name)});
  // Retain old loader logs, but route its visible entry to the unified manager.
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#startBannerModLoaderGui,#gameVersionDisplay')){event.preventDefault();event.stopImmediatePropagation();root.DoLModCenter?.open();}
  },true);
  for(const name of ['overwriteModIndexDBModList','overwriteModIndexDBHiddenModList','addModIndexDB','removeModIndexDB']){
    if(typeof root.modModLoadController?.[name]==='function')root.modModLoadController[name]=async()=>{throw Error('此内置版已统一存储入口，请通过模组中心管理。');};
  }
  const box=node('div');box.append(node('h1','DoL · 启动与救援'),node('p','模组尚未执行。可以先管理本地模组、导出完整备份，或停用旁加载模组排查启动故障。救援不删除包体或存档，也不会停用 HTML 内嵌模组。'),node('p','管理与诊断已内置：本次启动跳过独立 DoLModCenter、DoLWorkbench、DoLDiagnostics、ModHub，保留其包体和配置。'));
  root.DMCRescue?.mount(box,api);
  message=node('p','准备就绪。');message.setAttribute('role','status');box.append(message);
  const actions=node('div');actions.className='dmc-start-actions';
  actions.append(button('启动游戏',()=>{
   if(failed){message.textContent='加载已经失败，请刷新后重新启动。';return;}
   if(confirming||(root.DMCStorage.isBusy()||root.DMCBeautyStorage?.isBusy?.()||root.DMCRescue?.isBusy?.())){message.textContent='请先完成或取消当前存储操作。';return;}
   started=true;root.DoLModCenter?.close();gate.hidden=true;resolveStart();
  }),button('打开模组中心',()=>root.DoLModCenter?.open()),button('停用全部旁加载模组',async()=>{
   if(started&&!failed){message.textContent='加载进行中，请刷新后在启动前救援。';return;}
   if(confirming)return;
   try{
    const snapshot=await api.read();confirming=true;const confirmation=node('div');
    confirmation.append(node('p','确认停用 '+snapshot.enabled.length+' 个旁加载模组？包体全部保留；内嵌模组不受影响。'));
    confirmation.append(button('确认停用',async()=>{try{await api.disableAll(snapshot);message.textContent='停用已提交。若此前加载失败，请刷新后启动；可在模组中心逐个重新启用。';}catch(e){message.textContent=e.message;}finally{confirming=false;confirmation.remove();}}),button('取消',()=>{confirming=false;confirmation.remove();}));box.append(confirmation);
   }catch(e){message.textContent='救援不可用：'+e.message;}
  }),button('刷新页面',()=>root.location.reload()));box.append(actions);gate.append(box);document.body.append(gate);
  const rescue=button('启动救援',show);rescue.id='dmc-rescue-entry';document.body.append(rescue);
  return new Promise(resolve=>{resolveStart=resolve;});
 }
 function failure(error){failed=true;started=false;message.textContent='模组加载或游戏启动失败：'+String(error?.message||error).slice(0,1000);show();}
 root.DMCStartup={wait,failure};
})(window);
