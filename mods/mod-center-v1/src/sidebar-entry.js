(function(root){
  'use strict';
  const KEY='DoLModCenter.sidebar.v1';
  function create(open){
    let showCompact=false,disposed=false,queued=false;
    // Compact entries are retired: ignore old showCompact preferences.
    const expanded=document.createElement('button');expanded.id='dmc-sidebar-button';expanded.type='button';expanded.textContent='模组中心';expanded.addEventListener('click',open);
    const compact=document.createElement('button');compact.id='dmc-compact-button';compact.type='button';compact.textContent='模';compact.title='模组中心';compact.setAttribute('aria-label','打开模组中心');compact.addEventListener('click',open);
    const fallbackItem=document.createElement('li');fallbackItem.id='dmc-menu-item';
    const observer=new MutationObserver(()=>{if(queued||disposed)return;queued=true;queueMicrotask(()=>{queued=false;attach();});});
    function attach(){
      if(disposed)return;
      observer.disconnect();
      const menu=document.getElementById('overlayButtons') || document.getElementById('startCaption');
      const core=document.getElementById('menu-core');
      let target=menu;
      if(!target&&core){if(fallbackItem.parentElement!==core)core.append(fallbackItem);target=fallbackItem;}
      if(target){if(expanded.parentElement!==target)target.append(expanded);expanded.classList.remove('dmc-fallback');}
      else{if(expanded.parentElement!==document.body)document.body.append(expanded);expanded.classList.add('dmc-fallback');}
      if(target!==fallbackItem)fallbackItem.remove();
      const rail=document.getElementById('mobileStats');
      if(rail&&showCompact){if(compact.parentElement!==rail)rail.prepend(compact);}
      else compact.remove();
      observer.observe(document.body,{childList:true});
      const bar=document.getElementById('ui-bar');if(bar)observer.observe(bar,{childList:true,subtree:true});
    }
    function settings(){
      const box=document.createElement('details');box.className='dmc-entry-settings';
      const summary=document.createElement('summary');summary.textContent='入口显示设置';
      const status=document.createElement('p');status.textContent='已关闭收起侧栏中的额外入口，展开侧栏后可从菜单打开模组中心。';
      box.append(summary,status);return box;
    }
    attach();
    return {attach,settings,destroy(){disposed=true;observer.disconnect();expanded.remove();compact.remove();fallbackItem.remove();}};
  }
  root.DMCEntries={create};
})(window);
