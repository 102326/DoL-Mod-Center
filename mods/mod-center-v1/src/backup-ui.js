(function(root){
 'use strict';
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 function mount(host,api){
  root.DMCRescue?.mount(host,api);
  const heading=el('h3','完整备份与恢复'),note=el('p','包含加载器包存储中全部模组包（含未登记包）与启停、顺序；不包含美化选择器的 type 配置、图片缓存、内嵌模组、游戏本体或存档。预载引用会记录名称和版本，恢复需要目标游戏提供相同版本；启动前无法确认来源时请进游戏后导出。最多 256 MiB 包体。');
  const status=el('p'),review=el('div'),exportButton=el('button','导出当前完整备份'),input=el('input'),check=el('input'),label=el('label'),restoreButton=el('button','恢复这份备份');
  input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','选择完整备份');check.type='checkbox';label.append(check,document.createTextNode('已保存刚导出的当前备份，理解恢复会替换全部旁加载包和配置（包括管理器本身）。'));
  let busy=false,exported=false,token,exportedFingerprint;
  function controls(){exportButton.disabled=busy;input.disabled=busy||!exported;restoreButton.disabled=busy||!token||!check.checked;check.disabled=busy;for(const n of [exportButton,input,restoreButton,check])n.dataset.locked=n.disabled?'1':'0';}
  async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){status.textContent='失败：'+e.message;}finally{busy=false;controls();}}
  exportButton.onclick=()=>run(async()=>{
   status.textContent='正在生成完整备份…';const backup=await api.backup(),blob=new Blob([JSON.stringify(backup)],{type:'application/json'}),name='DoLModCenter-full-'+Date.now()+'.json';
   if(typeof root.cordova?.plugins?.saveDialog?.saveFile==='function')await root.cordova.plugins.saveDialog.saveFile(blob,name);
   else{const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
   exported=true;exportedFingerprint=backup.fingerprint;token=null;check.checked=false;review.replaceChildren();status.textContent='已发起备份导出。请确认文件保存成功，再选择要恢复的备份。';
  });
  input.onchange=()=>run(async()=>{
   token=null;check.checked=false;review.replaceChildren();const file=input.files?.[0];input.value='';if(!file)return;
   if(file.size>360*1024*1024)throw Error('备份文件过大。');status.textContent='正在逐包校验备份…';
   token=await api.prepareRestore(JSON.parse(await file.text()));
   if(token.fingerprint!==exportedFingerprint){token=null;exported=false;throw Error('当前配置已变化，请先重新导出当前完整备份。');}
   review.append(el('p','将替换当前 '+token.previousPackages+' 个包；恢复 '+token.names.length+' 个包，启用 '+token.enabled.length+'，禁用 '+token.disabled.length+'，共 '+token.bytes+' 字节。'));
   review.append(el('p','其中未登记包 '+token.orphans+' 个；当前配置校验摘要：'+token.fingerprint));
   if(token.preloaded?.length)review.append(el('p','依赖目标游戏提供的预载模组：'+token.preloaded.map(p=>p.name+' '+p.version).join('、')));
   const details=el('details'),summary=el('summary','查看恢复名单'),pre=el('pre',token.names.join('\n'));pre.className='dmc-json';details.append(summary,pre);review.append(details);
   status.textContent='校验通过。确认后整体替换；生效需要重启。';
  });
  check.onchange=controls;restoreButton.onclick=()=>run(async()=>{await api.restore(token);token=null;exported=false;status.textContent='恢复已提交并回读核验。请重启游戏，当前会话仍是恢复前的模组。';review.replaceChildren();});
  host.append(heading,note,exportButton,status,input,review,label,restoreButton);host.classList.add('dmc-backups');controls();
 }
 root.DMCBackupUI={mount};
})(window);
