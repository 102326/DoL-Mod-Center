/* Independent picture selections use the owning addon's order, not ZIP load order. */
(function(root){
  'use strict';
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  function mount(host,{runTask,notify,openPackage,isBusy}={}){
    const api=root.DMCBeautyStorage.create(root);let snapshot,drag,dead=false;
    const button=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b;};
    async function refresh(){
      try{const next=await api.read();if(dead)return;snapshot=next;draw();}
      catch(e){if(!dead){host.replaceChildren(el('h3','美化图层 · type'),el('p',e.message,'dmc-muted'));}}
    }
    function change(order){
      const captured=snapshot;
      runTask(async()=>{try{await api.change(captured,order);notify('美化图层配置已保存；建议保存游戏后重启，使已显示的图片一并刷新。','success');}
        catch(e){notify('美化图层未完成：'+e.message,'error');}
        finally{await refresh();}});
    }
    function card(entry,enabled,index){
      const card=el('article',undefined,'dmc-card');card.dataset.beautyType=entry.type;
      const heading=el('div',undefined,'dmc-card-head');
      if(enabled){card.dataset.orderName=entry.type;heading.append(el('span',String(index+1),'dmc-order-number'));
        const handle=button('⠿',()=>{});handle.className='dmc-drag-handle';handle.setAttribute('aria-label','调整美化优先级：'+entry.type);handle.dataset.locked=!snapshot.writable || snapshot.enabled.length<2?'1':'0';handle.disabled=handle.dataset.locked==='1'||isBusy?.();heading.append(handle);
      }
      heading.append(el('strong',entry.type),el('span','来自 '+entry.modName+' · '+entry.count+' 张图片','dmc-muted'));card.append(heading);
      const actions=el('div',undefined,'dmc-actions');const toggle=button(enabled?'停用图层':'启用图层',()=>change(enabled?snapshot.enabled.filter(t=>t!==entry.type):[...snapshot.enabled,entry.type]));
      toggle.disabled=!snapshot.writable||isBusy?.();toggle.dataset.locked=snapshot.writable?'0':'1';actions.append(toggle);
      if(entry.modName && openPackage)actions.append(button('所属模组详情',()=>openPackage(entry.modName)));card.append(actions);return card;
    }
    function draw(){
      drag?.destroy();host.replaceChildren(el('h3','美化图层 · type'));
      host.append(el('p','这里调整图片覆盖优先级：越靠前越优先。它与模组的前置加载顺序不同，不参与上方自动排序。','dmc-muted'));
      host.append(el('p','图层可以独立启停；文件属于来源模组，删除或导出请操作所属模组。切换不会删除图包或缓存。若刚调整过模组启停，请重启后再核对图层。','dmc-muted'));
      if(snapshot.reason)host.append(el('p',snapshot.reason,'dmc-error'));
      const list=el('div',undefined,'dmc-sort-list dmc-beauty-sort');host.append(el('h4','已启用图层'),list);
      const map=new Map(snapshot.entries.map(e=>[e.type,e]));snapshot.enabled.forEach((type,i)=>list.append(card(map.get(type),true,i)));
      if(!snapshot.enabled.length)list.append(el('p','没有已启用图层。','dmc-muted'));
      host.append(el('h4','已停用图层'));snapshot.disabled.forEach(type=>host.append(card(map.get(type),false,-1)));
      if(!snapshot.entries.length)host.append(el('p','尚未注册图层。进入游戏后刷新可查看动态注册的图包。','dmc-muted'));
      drag=root.DMCDrag.bind(list,{onDrop(type,index){const order=[...snapshot.enabled];order.splice(order.indexOf(type),1);order.splice(index,0,type);change(order);},onAnnounce:text=>notify(text)});
    }
    host.append(el('p','正在读取美化图层…','dmc-muted'));refresh();
    return {destroy(){dead=true;drag?.destroy();}};
  }
  root.DMCBeautyUI={mount};
})(window);
