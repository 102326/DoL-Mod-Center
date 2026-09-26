(function (root) {
  'use strict';
  if (root.DoLModCenter) return;
  const storage = root.DMCStorage && root.DMCStorage.create ? root.DMCJournal?.wrap(root.DMCStorage.create(root)) || root.DMCStorage.create(root) : null;
  const STORE = storage;
  let shell, panel, content, status, sidebarButton, fallbackButton, fileInput, diagHost, configHost, entries, backupHost;
  let state = {enabled: [], disabled: [], loaded: [], revision: ''};
  let active = 'local', query = '', busy = false, destroyed = false, mountedHost, readError = false, restartNotice = false, focusBefore, backHandler, keyHandler, sidebarObserver;
  let operation = Promise.resolve();
  let detailPage, reorder, catalogInfo, catalogError='', sortPreview;
  let readGeneration=0, beautyView, preloadedOpen=false;
  const urls = new Set();
  const clean = value => String(value ?? '');
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const btn = (text, fn, cls) => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };
  function setStatus(text, kind) { if (!status) return; status.textContent = text; status.className = 'dmc-status' + (kind ? ' dmc-' + kind : ''); }
  function setBusy(value) {
    busy=value;
    if(panel)panel.querySelectorAll('button,input').forEach(n=>{
      if(!n.matches('[data-close]'))n.disabled=value || n.dataset.locked==='1' || (n.dataset.write==='1' && (!state.revision || state.writable!==true));
    });
  }
  function metadata(value) { const pre = el('pre', undefined, 'dmc-json'); pre.textContent = JSON.stringify(value || {}, null, 2); return pre; }
  function confirmInline(message, action) {
    const box = el('div', undefined, 'dmc-confirm'); box.append(el('p', message), btn('确认', () => { box.remove(); action(); }), btn('取消', () => box.remove())); return box;
  }
  function snapshotReadError(error) {
    readError = true;
    setStatus('无法读取本地模组状态：' + clean(error && error.message || error), 'error');
    state = {enabled: [], disabled: [], loaded: [], revision: ''};
    try {
      const u = root.modUtils, names = u && u.getModListNameNoAlias && u.getModListNameNoAlias();
      if (!Array.isArray(names)) return;
      state.loaded = names.map(name => { const m = u.getAnyModByNameNoAlias?.(name) || u.getMod?.(name); return {name: clean(name), version: clean(m?.bootJson?.version), bootJson: m?.bootJson || {}}; });
    } catch (_) {}
  }
  async function reread(scan=true) {
    const generation=++readGeneration;
    try {
      if(!STORE?.read)throw Error('本地模组存储接口不可用');
      const next=await STORE.read();let catalog,warning='';
      try{
        if(!scan && catalogInfo && JSON.stringify(catalogInfo.items.map(x=>x.name).sort())===JSON.stringify(next.packages)){catalog=catalogInfo;warning=catalogError;}
        else catalog=await STORE.catalog(next);
      }catch(e){warning=e.message;}
      if(generation!==readGeneration)return false;
      state=next;catalogInfo=catalog;catalogError=warning;readError=false;return true;
    }catch(e){if(generation===readGeneration){catalogInfo=null;snapshotReadError(e);}return false;}
  }
  function isPreloaded(name){return !state.packages?.includes(name) && state.preloaded?.some(x=>x.name===name);}
  function storedItem(name){return catalogInfo?.items.find(x=>x.name===name)||{name};}
  function ensurePanel() { if (!panel || !panel.isConnected) return false; return true; }
  async function loadDetails(name, target, loaded) {
    target.textContent = '正在读取包内资料…';
    try {
      const method = loaded ? STORE?.loadedDetails : STORE?.details;
      if (!method) throw Error('详细信息接口不可用');
      const info = await method(name);
      if (target.isConnected) root.DMCModInfo.render(target, info);
    } catch (e) { target.textContent = '读取详情失败：' + clean(e.message || e); }
  }
  function openDetails(item, loaded) {
    detailPage={name:item.name,loaded,scroll:content.scrollTop};active='details';render();content.scrollTop=0;
    content.querySelector('.dmc-back')?.focus();
  }
  function backToList() {
    const previous=detailPage;active='local';render();
    if(previous){content.scrollTop=previous.scroll;[...content.querySelectorAll('.dmc-card')].find(c=>c.dataset.modName===previous.name)?.querySelector('.dmc-detail-open')?.focus({preventScroll:true});}
  }
  function detailView() {
    content.append(btn('返回模组列表',backToList,'dmc-back'));
    content.append(el('p',detailPage.loaded?'当前运行包资料（本次已加载版本）':'本地存储包资料（下次加载使用）','dmc-muted'));
    if(state.packages?.includes(detailPage.name) && state.loaded.some(x=>x.name===detailPage.name)){
      const switcher=btn(detailPage.loaded?'查看本地包资料':'查看本次挂载资料',()=>{detailPage.loaded=!detailPage.loaded;render();content.scrollTop=0;});content.append(switcher);
    }
    const page=el('article',undefined,'dmc-details dmc-detail-page');content.append(page);loadDetails(detailPage.name,page,detailPage.loaded);
  }
  function detailsCard(item, loaded, index, total) {
    const card = el('article', undefined, 'dmc-card');
    card.dataset.modName=item.name;card.dataset.loaded=String(loaded);
    const heading = el('div', undefined, 'dmc-card-head'); heading.append(el('strong', clean(item.name)), el('span', item.version ? clean(item.version) : '包内版本见详情', 'dmc-version')); card.append(heading);
    if(item.bootJson){const kind=root.DMCPackage.describe(item.bootJson);heading.append(el('span',kind.label,'dmc-package-kind'));}
    const runtime=state.loaded.find(x=>x.name===item.name),registered=state.enabled.includes(item.name)||state.disabled.includes(item.name);
    const badges=el('div',undefined,'dmc-state-badges');
    const badge=(text,kind)=>badges.append(el('span',text,'dmc-state dmc-state-'+kind));
    if(isPreloaded(item.name))badge('预载 · 只读','readonly');
    else if(state.enabled.includes(item.name))badge('已启用','enabled');
    else if(state.disabled.includes(item.name))badge('已禁用','disabled');
    else badge(loaded?'非本地配置 · 只读':'未登记','readonly');
    if(runtime)badge('已挂载','mounted');else if(state.enabled.includes(item.name) && !isPreloaded(item.name))badge('未挂载','pending');
    if(runtime && !loaded && item.version && runtime.version && item.version!==runtime.version)badge('本地 '+item.version+' / 已挂载 '+runtime.version,'pending');
    card.append(badges);
    if(item.error)card.append(el('p','包资料读取失败：'+item.error,'dmc-error'));
    const actions = el('div', undefined, 'dmc-actions');
    if (!loaded && registered) {
      const enabled = state.enabled.includes(item.name);
      actions.append(btn(enabled ? '禁用' : '启用', () => confirmMutation(enabled ? '禁用' : '启用', item.name, !enabled)));
      if (enabled) {
        card.dataset.orderName=item.name;
        const handle=btn('⠿',()=>{},'dmc-drag-handle');handle.setAttribute('aria-label','调整顺序：'+item.name);
        handle.title=query?'清空搜索后可拖拽排序':'拖拽调整顺序；也可按空格开始、方向键移动、回车确认';
        handle.dataset.write='1';handle.dataset.locked=(query || (item.name==='DoLModCenter' && !root.__DMC_BUILTIN) || total<2)?'1':'0';heading.prepend(handle);
        heading.prepend(el('span',String(index+1),'dmc-order-number'));
      }
      actions.append(btn('导出 ZIP', () => exportMod(item.name)), btn('删除', () => removeMod(item.name)));
      actions.querySelectorAll('button').forEach(b=>{if(b.textContent!=='导出 ZIP'){b.dataset.write='1';if((item.name==='DoLModCenter' && !root.__DMC_BUILTIN))b.dataset.locked='1';}});
    }
    if(!loaded && !registered)actions.append(btn('导出 ZIP',()=>exportMod(item.name)));
    actions.append(btn('详情', () => openDetails(item,loaded),'dmc-detail-open')); card.append(actions); return card;
  }
  function listView() {
    const wrap = el('div');
    if(entries)wrap.append(entries.settings());
    if(restartNotice)wrap.append(el('p','更改将在重启游戏后生效。请先保存游戏再重启。','dmc-success'));
    if(state.reason)wrap.append(el('p',state.reason,'dmc-error'));
    if(catalogError)wrap.append(el('p',catalogError,'dmc-error'));
    const sortButton=btn('按前置排序',previewSort);sortButton.dataset.write='1';sortButton.dataset.locked=!catalogInfo || state.enabled.length<2?'1':'0';wrap.append(sortButton);
    wrap.append(el('p', '独立图片包、文本包和内容模组统一管理；包内资源可在详情中查看。','dmc-muted'));
    wrap.append(el('p', '已启用 / 已禁用表示下次启动配置；已挂载表示本次加载器报告已加载。修改启停后需重启，两个状态可能同时出现。', 'dmc-muted'));
    const search = el('input'); search.type = 'search'; search.placeholder = '搜索模组名称或版本'; search.setAttribute('aria-label', '搜索模组'); search.value = query; search.addEventListener('input', () => { query = search.value; render(); }); wrap.append(search);
    const matches = item => (clean(item.name) + ' ' + clean(item.version) + ' ' + clean(findLoaded(item.name).version) + ' ' + root.DMCPackage.describe(item.bootJson||{}).label).toLowerCase().includes(query.toLowerCase());
    const editableOrder=state.enabled.filter(name=>!isPreloaded(name));
    const enabled = editableOrder.map(storedItem).filter(matches);
    const listed=new Set(state.enabled);
    const remaining=[...state.disabled,...(state.orphans||[]),...state.loaded.map(x=>x.name)].filter(name=>{if(listed.has(name)||isPreloaded(name))return false;listed.add(name);return true;});
    if (state.missing?.length) wrap.append(el('p', '配置中缺少：' + state.missing.join('、'), 'dmc-error'));
    if(state.orphans?.length)wrap.append(el('p','存在未登记包，尚未自动启用；可在对应卡片导出。','dmc-error'));
    wrap.append(el('h3', '额外模组'),el('p',query?'清空搜索后可拖拽排序。':'已启用的本地包按加载顺序排列；拖动手柄，松手直接保存。','dmc-muted'));
    const modList=el('div',undefined,'dmc-mod-list'),enabledList=el('div',undefined,'dmc-sort-list');modList.append(enabledList);wrap.append(modList);
    enabled.forEach(x=>enabledList.append(detailsCard(x,false,editableOrder.indexOf(x.name),editableOrder.length)));
    let shown=enabled.length;
    remaining.forEach(name=>{
      const local=state.disabled.includes(name)||state.orphans?.includes(name),item=local?storedItem(name):findLoaded(name);
      if(!matches(item))return;modList.append(detailsCard(item,!local,-1,0));shown++;
    });
    if(!shown)modList.append(el('p','没有匹配的模组。','dmc-muted'));
    const preload=(state.preloaded||[]).filter(x=>isPreloaded(x.name)).filter(matches);
    if(preload.length){
      const group=el('details',undefined,'dmc-preloaded');group.open=preloadedOpen;group.addEventListener('toggle',()=>{if(group.isConnected)preloadedOpen=group.open;});
      group.append(el('summary','预载模组（'+preload.length+'）'),el('p','来自游戏内嵌包，默认折叠；不参与额外包排序。','dmc-muted'));
      const list=el('div',undefined,'dmc-mod-list');preload.forEach(item=>list.append(detailsCard(item,true,-1,0)));group.append(list);wrap.append(group);
    }
    const beautyHost=el('section',undefined,'dmc-beauty-section');wrap.append(beautyHost);
    beautyView=root.DMCBeautyUI.mount(beautyHost,{notify:setStatus,isBusy:()=>busy,runTask:task=>enqueue(async()=>{setBusy(true);try{await task();}finally{setBusy(false);}}),openPackage:name=>{const local=state.packages?.includes(name);openDetails(local?storedItem(name):findLoaded(name).name?findLoaded(name):{name},!local);}});
    content.append(wrap);
    const captured=state;
    reorder=root.DMCDrag.bind(enabledList,{onDrop(name,target){move(name,captured.enabled.indexOf(editableOrder[target]),captured);},onAnnounce:text=>setStatus(text)});
  }
  function nativeVersionCheck(version,range){
    const api=root.modSC2DataManager?.getDependenceChecker?.()?.getInfiniteSemVerApi?.();
    if(!api)return undefined;
    try{return api.satisfies(api.parseVersion(version).version,api.parseRange(range));}catch(_){return undefined;}
  }
  function previewSort(){
    enqueue(async()=>{setBusy(true);try{
      const token=await STORE.catalog(state);
      const fixed=new Set((token.preloaded||[]).filter(x=>!token.items.some(y=>y.name===x.name)).map(x=>x.name));
      const managed=token.enabled.filter(name=>!fixed.has(name));
      const items=managed.map(name=>{
        const item=token.items.find(x=>x.name===name);if(!item || item.error)throw Error('无法读取“'+name+'”的前置声明：'+(item?.error||'包体缺失'));
        return {...item,beauty:root.DMCPackage.describe(item.bootJson).beauty};
      });
      const byName=new Map((token.preloaded||[]).map(x=>[x.name,x]));
      state.loaded.filter(x=>!token.enabled.includes(x.name) && !token.disabled.includes(x.name)).forEach(x=>{if(!byName.has(x.name))byName.set(x.name,x);});
      const external=[...byName.values()].filter(x=>!managed.includes(x.name));
      const plan=root.DMCSort.plan(items,{external,disabled:token.disabled.filter(name=>!fixed.has(name)),loaderVersion:root.modUtils?.version||'',checkVersion:nativeVersionCheck});
      let cursor=0;const fullOrder=token.enabled.map(name=>fixed.has(name)?name:plan.order[cursor++]);
      sortPreview={token,plan,fullOrder,managed};active='sort';content.scrollTop=0;setStatus('排序预览已生成；尚未更改配置。');
    }catch(e){setStatus('无法生成排序：'+e.message,'error');}finally{setBusy(false);render();}});
  }
  function sortView(){
    content.append(btn('返回模组列表',()=>{sortPreview=null;active='local';render();},'dmc-back'),el('h3','按前置排序'));
    content.append(el('p','明确的前置优先；可确认的纯图片、样式包在没有依赖约束时排后。其他包尽量保留原有相对顺序。','dmc-muted'));
    content.append(el('p','只调整已启用的本地包；不会启用缺失或已禁用的前置，也不会更改内置模组顺序。排序不能证明补丁兼容。','dmc-muted'));
    const {plan,token,managed}=sortPreview;
    plan.errors.forEach(x=>content.append(el('p',x,'dmc-error')));
    plan.warnings.forEach(x=>content.append(el('p',x,'dmc-muted')));
    if(plan.errors.length)content.append(el('p','请先解决以上问题，再重新生成排序。','dmc-error'));
    else if(!plan.changed)content.append(el('p','当前顺序已符合这组规则，无需更改。','dmc-success'));
    const list=el('ol',undefined,'dmc-sort-preview');
    plan.order.forEach((name,index)=>list.append(el('li',name+'　'+(managed.indexOf(name)+1)+' → '+(index+1))));content.append(list);
    if(!plan.errors.length && plan.changed){const apply=btn('应用此顺序',()=>applySort(sortPreview));apply.dataset.write='1';content.append(apply);}
  }
  function applySort(preview){
    enqueue(async()=>{setBusy(true);try{state=await STORE.reorderCatalog(preview.token,preview.fullOrder);restartNotice=true;sortPreview=null;active='local';setStatus('加载顺序已保存；重启游戏后生效。','success');}
      catch(e){sortPreview=null;active='local';setStatus('排序未完成：'+e.message,'error');}
      finally{await reread();setBusy(false);render();}});
  }
  function findLoaded(name) { return state.loaded.find(x => x.name === name) || {}; }
  function findVersion(name) { return clean(findLoaded(name).version); }
  function findBoot(name) { return findLoaded(name).bootJson || {}; }
  function diagView() { if (!diagHost) { diagHost = el('div', undefined, 'dmc-diagnostics'); mountedHost = diagHost; if (typeof root.DMCDiagnostics?.mount === 'function') root.DMCDiagnostics.mount(diagHost); else diagHost.append(el('p', '诊断模块不可用。', 'dmc-error')); } diagHost.hidden = false; content.append(diagHost); }
  function backupView(){if(!backupHost){backupHost=el('div');root.DMCBackupUI.mount(backupHost,STORE);}backupHost.hidden=false;content.append(backupHost);}
  function configView() { if (!configHost) { configHost = el('div', undefined, 'dmc-config'); if (typeof root.DMCConfigProfiles?.mount === 'function') root.DMCConfigProfiles.mount(configHost, STORE); else configHost.append(el('p', '配置快照模块不可用。', 'dmc-error')); } configHost.hidden = false; content.append(configHost); }
  function render() { if (!content) return; beautyView?.destroy();beautyView=null; reorder?.destroy();reorder=null; const keepSearch = document.activeElement?.getAttribute('aria-label') === '搜索模组'; content.replaceChildren(); if (active === 'local') listView(); else if (active === 'details') detailView(); else if(active==='sort')sortView(); else if (active === 'diagnostics') diagView(); else if(active==='backups')backupView(); else configView(); if (diagHost && active !== 'diagnostics') { diagHost.hidden = true; content.append(diagHost); } if (configHost && active !== 'profiles') { configHost.hidden = true; content.append(configHost); } if(backupHost && active!=='backups'){backupHost.hidden=true;content.append(backupHost);}panel.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === active))); if (keepSearch) { const s = content.querySelector('[aria-label="搜索模组"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } } setBusy(busy); }
  async function refresh() { const ok = await reread(); render(); if(ok)setStatus(state.reason || (restartNotice?'更改将在重启游戏后生效。':'就绪。'),state.reason?'error':''); }
  function enqueue(task) { operation = operation.then(task, task); return operation; }
  function confirmMutation(label, name, enabled) { const captured = state; showConfirm(label + '“' + name + '”？', () => mutate(label, name, enabled, captured)); }
  function showConfirm(message, action) { panel.querySelector('.dmc-inline-confirm')?.remove(); const box = el('div', undefined, 'dmc-inline-confirm'); box.append(confirmInline(message, () => { box.remove(); action(); })); content.prepend(box);box.scrollIntoView({block:'nearest'}); }
  function mutate(label, name, enabled, captured) { enqueue(async () => { if (!STORE?.toggle) return setStatus('本地存储接口不支持' + label, 'error'); setBusy(true); try { const next = await STORE.toggle(captured, name, enabled); state = next; restartNotice = true; setStatus(label + '“' + name + '”已完成；重启游戏后生效。', 'success'); } catch (e) { setStatus('操作失败：' + clean(e.message || e), 'error'); } finally { await reread(false); setBusy(false); render(); } }); }
  function confirmMove(name, delta, target) { const captured = state; showConfirm('将“' + name + '”移动到配置位置 ' + (target + 1) + '？', () => move(name, target, captured)); }
  function move(name, target, captured) { const scroll=content.scrollTop;enqueue(async () => { setBusy(true); try { if (!STORE?.move) throw Error('本地存储接口不支持移动'); state = await STORE.move(captured, name, target); restartNotice = true; setStatus('已移动“' + name + '”；重启游戏后生效。', 'success'); } catch (e) { setStatus('移动失败：' + clean(e.message || e), 'error'); } finally { await reread(false); setBusy(false); render();content.scrollTop=scroll; } }); }
  async function removeMod(name) { const captured = state; try { if (!STORE?.prepare) throw Error('本地存储接口不支持准备删除'); setBusy(true); const prepared = await STORE.prepare(captured, name); setBusy(false); showConfirm('确认删除“' + name + '”？强烈建议先导出 ZIP。', () => enqueue(async () => { setBusy(true); try { if (!STORE?.remove) throw Error('本地存储接口不支持删除'); state = await STORE.remove(prepared, name); restartNotice = true; setStatus('已删除“' + name + '”；重启游戏后生效。', 'success'); } catch (e) { setStatus('删除失败：' + clean(e.message || e), 'error'); } finally { await reread(); setBusy(false); render(); } })); } catch (e) { setBusy(false); setStatus('删除准备失败：' + clean(e.message || e), 'error'); } }
  async function exportMod(name) { try { if (!STORE?.exportZip) throw Error('本地存储接口不支持导出'); const bytes = await STORE.exportZip(name); const blob = new Blob([bytes], {type: 'application/zip'}); const filename = clean(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') + '.zip'; if (typeof root.cordova?.plugins?.saveDialog?.saveFile === 'function') { await root.cordova.plugins.saveDialog.saveFile(blob, filename); setStatus('已交给系统保存“' + name + '”。', 'success'); } else { const url = URL.createObjectURL(blob); urls.add(url); const a = el('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000); setStatus('已发起导出“' + name + '”。', 'success'); } } catch (e) { setStatus('导出失败：' + clean(e.message || e), 'error'); } }
  function importer() { if (!fileInput) return; fileInput.click(); }
  async function handleFiles() { const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return; if (file.size > 268435456) return setStatus('拒绝导入：文件超过 256 MiB。', 'error'); setBusy(true); try { if (!STORE?.inspect) throw Error('本地存储接口不支持检查导入'); const bytes = new Uint8Array(await file.arrayBuffer()); const info = await STORE.inspect(bytes); const captured = state; if (!STORE?.prepare) throw Error('本地存储接口不支持准备导入'); const prepared = await STORE.prepare(captured, info.name); const warning = state.enabled.includes(info.name) || state.disabled.includes(info.name) ? ' 将更新现有模组。' : (state.orphans?.includes(info.name) || state.packages?.includes(info.name) ? ' 存在未登记的同名包，确认将覆盖并启用；建议先导出。' : ''); setBusy(false); showConfirm('导入“' + clean(info.name) + '” v' + clean(info.version) + '？' + warning, () => enqueue(async () => { setBusy(true); try { if (!STORE?.install) throw Error('本地存储接口不支持安装'); state = await STORE.install(prepared, bytes); restartNotice = true; setStatus('已导入“' + clean(info.name) + '”；重启游戏后生效。', 'success'); } catch (e) { setStatus('导入失败：' + clean(e.message || e), 'error'); } finally { await reread(); setBusy(false); render(); } })); } catch (e) { setBusy(false); setStatus('导入检查失败：' + clean(e.message || e), 'error'); } }
  function restart() { if (busy) { setStatus('当前操作进行中，暂不能重启。', 'error'); return; } showConfirm('重启游戏前请先保存当前游戏。确认重启？', () => root.location.reload()); }
  function attachEntry(){
    if(!destroyed)entries?.attach();
  }
  function mount() { if (shell || destroyed) return; shell = el('div', undefined, 'dmc-shell'); shell.hidden = true; panel = el('section', undefined, 'dmc-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'dmc-title'); panel.hidden = true;
    const head = el('header', undefined, 'dmc-header'); const title = el('h2', '模组中心 · 1.3.1'); title.id = 'dmc-title'; const closeButton = btn('关闭', close, 'dmc-close'); closeButton.dataset.close = 'true'; head.append(title, closeButton); const tabs = el('nav', undefined, 'dmc-tabs'); tabs.setAttribute('aria-label', '模组中心页面'); tabs.append(btn('本地管理', () => { if(active==='details')backToList();else{active = 'local'; render();} }), btn('运行诊断', () => { active = 'diagnostics'; render(); }), btn('配置快照', () => { active = 'profiles'; render(); }),btn('完整备份',()=>{active='backups';render();})); tabs.querySelectorAll('button').forEach((b, i) => b.dataset.tab = ['local', 'diagnostics', 'profiles','backups'][i]);
    const toolbar = el('div', undefined, 'dmc-toolbar'); toolbar.append(btn('刷新', refresh), btn('导入单个 ZIP', importer), btn('重启游戏', restart)); fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = '.zip,application/zip'; fileInput.multiple = false; fileInput.hidden = true; fileInput.addEventListener('change', handleFiles); toolbar.append(fileInput);[...toolbar.querySelectorAll('button')].find(b=>b.textContent==='导入单个 ZIP').dataset.write='1';fileInput.dataset.write='1';
    status = el('p', '正在读取本地模组状态…', 'dmc-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); content = el('div', undefined, 'dmc-content'); panel.append(head, tabs, toolbar, status, content); shell.append(panel); document.body.append(shell);
    entries=root.DMCEntries.create(open);
    keyHandler = e => { if (!panel.hidden && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if(active==='details')backToList();else if(active==='sort'){sortPreview=null;active='local';render();}else close(); } if (!panel.hidden && e.key === 'Tab') { const f = [...panel.querySelectorAll('button,input,textarea,summary,a[href],select')].filter(x => !x.disabled && x.getClientRects().length); const first = f[0], last = f.at(-1); if (first && e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (last && !e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }; panel.addEventListener('keydown', keyHandler); backHandler = e => { if (!panel.hidden) { e.preventDefault(); e.stopImmediatePropagation(); if(active==='details')backToList();else if(active==='sort'){sortPreview=null;active='local';render();}else close(); } }; document.addEventListener('backbutton', backHandler, true);
    reread().then(ok => { if (status && !busy && ok) { setStatus(restartNotice ? '更改将在重启游戏后生效。' : '就绪。', restartNotice ? 'success' : ''); render(); } else if (status) render(); });
  }
  function open() { if(destroyed)return;if (!shell) mount(); focusBefore = document.activeElement; shell.hidden = false; panel.hidden = false; refresh(); panel.querySelector('[data-close]')?.focus(); }
  function close() { beautyView?.destroy();beautyView=null;reorder?.destroy();reorder=null;if (panel) { panel.hidden = true; shell.hidden = true; if (focusBefore?.isConnected) focusBefore.focus(); } }
  function destroy() { destroyed = true;beautyView?.destroy();reorder?.destroy();entries?.destroy();retries.forEach(clearTimeout);document.removeEventListener('DOMContentLoaded',start);root.DMCDiagnostics?.destroy(); if (backHandler) document.removeEventListener('backbutton', backHandler, true); if (keyHandler) panel?.removeEventListener('keydown', keyHandler); if (root.jQuery) root.jQuery(document).off('.dmcManager'); sidebarObserver?.disconnect(); urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); shell?.remove(); sidebarButton?.remove(); fallbackButton?.remove(); delete root.DoLModCenter; }
  root.DoLModCenter = {open, close, destroy};
  const start = () => { if (!destroyed) {mount();attachEntry();} };
  const retries=[250,1000,3000].map(ms=>setTimeout(start,ms));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
  if (root.jQuery) root.jQuery(document).on(':passageend.dmcManager :storyready.dmcManager', start);
})(window);
