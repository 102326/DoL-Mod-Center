(function(root){
  'use strict';
  const KEY='DoLModCenter.configProfiles.v1', MAX=262144;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  function parse(value){
    if(typeof value==='string'){if(value.length>MAX)throw Error('快照超过256 KB');value=JSON.parse(value);}
    if(!value || value.schema!=='DoLModCenter.config.v1')throw Error('请选择本工具导出的配置快照JSON');
    const list=key=>{
      const a=value[key];if(!Array.isArray(a)||a.length>2000||!a.every(x=>typeof x==='string'&&x.length>0&&x.length<=512)||new Set(a).size!==a.length)throw Error('配置列表格式无效');
      return [...a];
    };
    const enabled=list('enabled'),disabled=list('disabled');
    if(enabled.some(n=>disabled.includes(n)))throw Error('快照中的启停状态重叠');
    if(typeof value.label!=='string'||value.label.length>80||typeof value.createdAt!=='string'||value.createdAt.length>64||!Number.isFinite(Date.parse(value.createdAt)))throw Error('快照说明格式无效');
    return {schema:value.schema,label:value.label,createdAt:value.createdAt,enabled,disabled};
  }
  function load(){const raw=localStorage.getItem(KEY);if(!raw)return [];if(raw.length>MAX*10)throw Error('快照库过大');const a=JSON.parse(raw);if(!Array.isArray(a)||a.length>10)throw Error('快照库异常');return a.map(parse);}
  function save(profile){const a=load();if(a.length>=10)throw Error('最多保存10份快照，请先删除不需要的快照');a.push(parse(profile));localStorage.setItem(KEY,JSON.stringify(a));}
  function mount(host,api){
    host.replaceChildren();const status=el('p');status.setAttribute('role','status');status.className='dmc-muted';
    const buttons=el('div');buttons.className='dmc-actions';const name=el('input');name.placeholder='例如 日常游玩配置';name.maxLength=80;name.setAttribute('aria-label','配置快照名称');
    const list=el('div');
    const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(e=>{status.textContent='未完成：'+e.message;});return b;};
    async function exportProfile(profile){
      const blob=new Blob([JSON.stringify(profile,null,2)],{type:'application/json'});
      if(typeof root.cordova?.plugins?.saveDialog?.saveFile==='function')await root.cordova.plugins.saveDialog.saveFile(blob,'dol-mod-config.json');
      else {const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='dol-mod-config.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
      status.textContent='已发起快照导出。';
    }
    function render(){
      list.replaceChildren();const all=load();
      if(!all.length)list.append(el('p','还没有配置快照。'));
      all.forEach((profile,index)=>{
        const card=el('article');card.className='dmc-card';card.append(el('h3',profile.label),el('p',profile.createdAt+' · 启用 '+profile.enabled.length+' / 禁用 '+profile.disabled.length));
        const actions=el('div');actions.className='dmc-actions';const output=el('div');
        actions.append(button('比较配置',async()=>{
          const now=await api.read();output.replaceChildren();const oldAll=[...profile.enabled,...profile.disabled],newAll=[...now.enabled,...now.disabled];
          const show=(label,names)=>output.append(el('p',label+'：'+(names.join('、')||'无')));
          show('当前新增',newAll.filter(n=>!oldAll.includes(n)));show('当前缺少',oldAll.filter(n=>!newAll.includes(n)));
          show('改为启用',now.enabled.filter(n=>profile.disabled.includes(n)));show('改为禁用',now.disabled.filter(n=>profile.enabled.includes(n)));
          const before=profile.enabled.filter(n=>now.enabled.includes(n)),after=now.enabled.filter(n=>profile.enabled.includes(n));
          output.append(el('p','共同启用模组顺序：'+(JSON.stringify(before)===JSON.stringify(after)?'未变':'有变化')));
        }),button('导出快照',()=>exportProfile(profile)),button('删除快照',()=>{
          output.replaceChildren(el('p','仅删除此配置快照？不会删除模组。'),button('确认删除快照',()=>{
            const fresh=load();if(JSON.stringify(fresh[index])!==JSON.stringify(profile))throw Error('快照库已变化，请重新打开本页');
            fresh.splice(index,1);localStorage.setItem(KEY,JSON.stringify(fresh));render();status.textContent='配置快照已删除。';
          }),button('取消',()=>output.replaceChildren()));
        }));card.append(actions,output);list.append(card);
      });
    }
    buttons.append(name,button('保存当前配置',async()=>{
      const current=await api.read();save({schema:'DoLModCenter.config.v1',label:name.value||'配置快照',createdAt:new Date().toISOString(),enabled:current.enabled,disabled:current.disabled});render();status.textContent='已保存重启配置名单。';
    }));
    const input=el('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','导入配置快照');
    input.onchange=async()=>{try{const file=input.files?.[0];if(!file)return;if(file.size>MAX)throw Error('快照超过256 KB');save(parse(await file.text()));render();status.textContent='已导入快照，可与当前配置比较。';}catch(e){status.textContent='导入失败：'+e.message;}finally{input.value='';}};
    host.append(el('h3','配置快照'),el('p','记录重启后生效的启用、禁用名单及顺序。不含美化图层配置、模组ZIP、包内版本或存档，不自动恢复配置。运行版本记录请查看运行诊断中的运行快照。'),buttons,el('p','导入以前导出的配置快照 JSON：'),input,status,list);
    try{render();}catch(e){status.textContent='读取失败：'+e.message+'；现有数据未覆盖。';}
  }
  root.DMCConfigProfiles={mount,parse};
})(window);
