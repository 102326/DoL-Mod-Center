(function(root){
 'use strict';
 let busy=false;
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 async function exportEmergency(api,status){
  if(busy)throw Error('已有紧急导出进行中。');busy=true;
  try{
   status.textContent='正在只读收集可用包体与异常清单…';
   const archive=await api.emergencyBackup();
   archive.recentChanges=root.DMCJournal?.list?.()||[];
   archive.historyWarning=root.DMCJournal?.status?.()||'';
   try{archive.diagnostics=root.DMCDiagnostics?.getReport?.()||'诊断接口暂不可用。';}catch(_){archive.diagnostics='诊断收集失败，包体导出不受影响。';}
   const blob=new Blob([JSON.stringify(archive)],{type:'application/json'}),name='DoLModCenter-emergency-'+Date.now()+'.json';
   if(typeof root.cordova?.plugins?.saveDialog?.saveFile==='function')await root.cordova.plugins.saveDialog.saveFile(blob,name);
   else{const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
   status.textContent='已发起紧急导出：捕获 '+(archive.packages||[]).filter(p=>p.capture==='complete').length+' 个可读包，记录 '+(archive.issues||[]).length+' 项异常。请确认文件保存成功并查看排除项；此文件不能直接整份恢复，也不包含游戏存档。';
   return archive;
  }finally{busy=false;}
 }
 function mount(host,api){const box=el('section'),status=el('p'),button=el('button','紧急导出可读内容');button.type='button';status.setAttribute('role','status');box.append(el('h3','紧急导出'),el('p','配置损坏、缺包或坏包时，尽量保留可读包体。导出附带异常清单、当前诊断和最近变更；不包含存档、游戏本体、预载资源或美化 type 配置。此格式不能直接导入“完整备份恢复”。'),button,status);button.onclick=async()=>{button.disabled=true;try{await exportEmergency(api,status);}catch(e){status.textContent='紧急导出未完成：'+String(e.message||e);}finally{button.disabled=false;}};host.append(box);}
 root.DMCRescue={mount,exportEmergency,isBusy:()=>busy};
})(window);
