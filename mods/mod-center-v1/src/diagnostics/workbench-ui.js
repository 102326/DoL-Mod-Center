(function (root) {
  'use strict';
  if (root.DMCDiagnostics) return;
  const core = root.DoLWorkbenchCore;
  const diag = root.DoLWorkbenchDiagnosticsCore;
  const sources = root.DoLWorkbenchDiagnosticsSources;
  if (!core || !diag || !sources) return;
  const STORE = 'DoLWorkbench.profiles.v1';
  const runtime = [], seen = new WeakMap();
  let panel, body, notice, tabs, observer, timer, mountContainer, jqueryAttached = false;
  let active = 'overview', current, lastReport = '', destroyed = false;
  const events = [], urls = new Set();
  const clean = value => diag.sanitize(typeof value === 'string' ? value : String(value ?? ''));
  function node(tag, text, cls) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function listen(target, event, fn, options) {
    target.addEventListener(event, fn, options); events.push(() => target.removeEventListener(event, fn, options));
  }
  function button(text, action, cls) {
    const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', action); return b;
  }
  function say(text) { if (notice) notice.textContent = text; }
  function record(message, source) {
    runtime.push({level: 'error', message: diag.sanitize(message), source, time: new Date().toISOString()});
    if (runtime.length > 300) runtime.shift();
  }
  function scan() {
    const passages = document.getElementById('passages');
    if (!passages) return;
    passages.querySelectorAll('.error-view > .error').forEach(e => {
      if (seen.get(e) !== e.textContent) { seen.set(e, e.textContent); record(e.textContent, '页面报错'); }
    });
  }
  function attachObserver() {
    if (observer || destroyed) return;
    const passages = document.getElementById('passages');
    if (!passages || !root.MutationObserver) return;
    observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 200); });
    observer.observe(passages, {childList: true, subtree: true, characterData: true}); scan();
  }
  function decodeLog(value) {
    return value.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => {
      const n = parseInt(hex || dec, hex ? 16 : 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function snapshot() {
    attachObserver(); scan();
    const mods = [], notes = [];
    let logs = [], incomplete = false;
    try {
      const utils = root.modUtils;
      if (typeof utils?.getModListNameNoAlias !== 'function' || typeof utils?.getMod !== 'function') throw Error('unavailable');
      const names = utils.getModListNameNoAlias();
      if (!Array.isArray(names)) throw Error('invalid list');
      if (names.length > 300) { incomplete = true; notes.push('模组超过 300 个，仅分析前 300 个。'); }
      for (const name of names.slice(0, 300)) {
        try {
          const mod = typeof utils.getAnyModByNameNoAlias === 'function' ? utils.getAnyModByNameNoAlias(name) : utils.getMod(name);
          if (!mod?.bootJson) { incomplete = true; continue; }
          mods.push({name: String(name), version: String(mod.bootJson.version ?? ''), bootJson: mod.bootJson});
        } catch (_) { incomplete = true; }
      }
    } catch (_) { incomplete = true; }
    if (incomplete) notes.push('模组清单不完整；无法据此断言某个依赖缺失。');
    try {
      const get = root.modLoaderGui_LoadingProgress?.getLoadLog;
      if (typeof get !== 'function') throw Error('unavailable');
      const lines = root.modLoaderGui_LoadingProgress.getLoadLog();
      if (!Array.isArray(lines)) throw Error('invalid logs');
      logs = sources.parseLogs(lines.filter(x => typeof x === 'string').slice(-1000).map(decodeLog));
    } catch (_) { notes.push('加载日志不可用；没有读到错误不等于没有错误。'); }
    const groups = diag.group(logs.concat(runtime));
    let versionCheck;
    try {
      const api = root.modSC2DataManager?.getDependenceChecker?.().getInfiniteSemVerApi?.();
      if (typeof api?.parseVersion !== 'function' || typeof api?.parseRange !== 'function' || typeof api?.satisfies !== 'function') throw Error('unavailable');
      versionCheck = (actual, required) => {
        try { return api.satisfies(api.parseVersion(actual).version, api.parseRange(required)); }
        catch (_) { return undefined; }
      };
    } catch (_) { notes.push('加载器版本比较接口不可用；版本范围检查显示为待核对。'); }
    const result = core.analyze(mods, groups, notes, {incomplete, versionCheck});
    const conflicts = sources.overlaps(mods);
    const safeNotes = Array.from(new Set([...notes, ...(result.notes || []),
      '显示当前运行环境的模组名单；不代表 IndexedDB 中全部已导入/禁用的模组。',
      '同目标修改仅为排查线索；不等于冲突。版本范围未核验不等于兼容。',
      '游戏本体与加载器版本依赖依靠加载日志判断，不单独读取游戏变量。',
      '只收集模组元数据与错误摘要，不读取存档变量；诊断导出前请查看内容。']));
    const report = diag.makeReport({groups, conflicts, mods, notes: safeNotes});
    const advice = result.issues.map(i => [clean(i.title), '证据：' + clean(i.evidence), '建议：' + clean(i.advice)].join('\n')).join('\n\n');
    lastReport = ('DoL 模组中心 1.3.0\n\n' + advice + '\n\n' + report).slice(0, 80000);
    return {mods, groups, conflicts, notes: safeNotes, issues: result.issues, incomplete};
  }
  function issueCard(issue) {
    const card = node('article', undefined, 'dwb-card dwb-' + (issue.severity === 'error' ? 'error' : 'warning'));
    card.append(node('span', issue.certainty === 'confirmed' ? '已确认' : '待核对', 'dwb-badge'), node('h3', clean(issue.title)),
      node('p', clean(issue.evidence), 'dwb-evidence'), node('p', clean(issue.advice)));
    return card;
  }
  function notes() {
    const details = node('details', undefined, 'dwb-card'); details.append(node('summary', '检查范围与限制'));
    for (const note of current.notes) details.append(node('p', clean(note), 'dwb-muted'));
    body.append(details);
  }
  function overview() {
    root.DMCSummary?.render(body,current.groups);
    const recent=node('details',undefined,'dwb-card');recent.append(node('summary','最近变更（仅本管理器）'));root.DMCJournal?.render(recent);body.append(recent);
    if (current.incomplete) body.append(node('p', '模组清单不完整：部分接口不可用，以下检查结果可能不完整。', 'dwb-card dwb-warning'));
    const stats = node('div', undefined, 'dwb-stats');
    for (const [value, label] of [[current.mods.length, '当前模组'], [current.issues.length, '待处理提示'], [current.conflicts.length, '修改重叠线索']]) {
      const item = node('div', undefined, 'dwb-stat'); item.append(node('strong', value), node('span', label)); stats.append(item);
    }
    body.append(node('p', '看清当前组合，再决定怎么处理。', 'dwb-lead'), stats);
    const heading = node('div', undefined, 'dwb-section-heading');
    heading.append(node('h3', '优先检查'), button('查看全部诊断', () => select('errors'))); body.append(heading);
    if (!current.issues.length) body.append(node('p', current.incomplete ? '部分接口不可用，暂时无法完成检查。' : '当前检查范围内没有发现明确问题；仍需以实际游玩为准。', 'dwb-card'));
    current.issues.slice(0, 3).forEach(i => body.append(issueCard(i)));
    const guide = node('article', undefined, 'dwb-card');
    guide.append(node('h3', '更换模组前，留下一个环境快照'), node('p', '记录当前名单和版本，之后能看出少了谁、谁升级了。快照不包含存档或模组文件。'), button('保存当前快照', () => select('profiles')));
    body.append(guide); notes();
  }
  function modsView() {
    const label = node('label', '搜索模组名称或版本', 'dwb-label');
    const input = node('input'); input.type = 'search'; input.placeholder = '例如 maplebirch、猫咖…'; input.setAttribute('aria-label', '搜索模组'); label.append(input);
    const list = node('div', undefined, 'dwb-mod-list');
    const render = () => {
      list.replaceChildren(); const query = input.value.toLowerCase();
      const mods = current.mods.filter(m => (m.name + ' ' + m.version).toLowerCase().includes(query));
      if (!mods.length) list.append(node('p', '没有匹配的模组。', 'dwb-muted'));
      mods.forEach(m => {
        const card = node('details', undefined, 'dwb-card');
        const summary = node('summary'); summary.append(node('span', clean(m.name)), node('span', clean(m.version), 'dwb-version')); card.append(summary);
        const deps = Array.isArray(m.bootJson.dependenceInfo) ? m.bootJson.dependenceInfo : [];
        card.append(node('p', deps.length ? '声明的依赖（展开信息不代表验证通过）：' : '未声明依赖。', 'dwb-muted'));
        deps.slice(0, 100).forEach(d => { if (d && typeof d === 'object') card.append(node('p', clean(d.modName) + ' · ' + clean(d.version))); });
        list.append(card);
      });
    };
    input.addEventListener('input', render); body.append(label, node('p', '此处展示运行时名单；启停、导入和排序请切换到模组管理页。', 'dwb-muted'), list); render();
  }
  function errorsView() {
    if (!current.issues.length) body.append(node('p', '当前没有已识别的问题。检查范围见页面底部。', 'dwb-card'));
    current.issues.forEach(i => body.append(issueCard(i)));
    const raw = node('details', undefined, 'dwb-card'); raw.append(node('summary', '原始错误与补丁摘要（' + current.groups.length + '）'));
    current.groups.forEach(g => raw.append(node('pre', '[' + clean(g.level) + ' · ' + g.count + ' 次] ' + clean(g.message)))); body.append(raw);
    const overlaps = node('details', undefined, 'dwb-card'); overlaps.append(node('summary', '同目标修改（' + current.conflicts.length + '）'));
    overlaps.append(node('p', '这里只列修改重叠，不据此判断冲突或归责。', 'dwb-muted'));
    current.conflicts.forEach(c => overlaps.append(node('p', clean(c.target) + '：' + c.mods.map(clean).join('、')))); body.append(overlaps); notes();
  }
  function readProfiles() {
    try {
      const raw = root.localStorage.getItem(STORE);
      if (!raw) return [];
      if (raw.length > 2621440) throw Error('快照库过大');
      const all = JSON.parse(raw);
      if (!Array.isArray(all) || all.length > 10) throw Error('快照库格式无效');
      return all.map(p => core.parseProfile(JSON.stringify(p)));
    } catch (_) { say('快照读取失败；请先导出可用信息。现有数据未覆盖。'); return null; }
  }
  function saveProfile(profile) {
    const all = readProfiles(); if (!all) return false;
    if (all.length >= 10) { say('最多保存 10 份快照，请先手动删除不需要的快照。'); return false; }
    try { root.localStorage.setItem(STORE, JSON.stringify([...all, profile])); say('已保存环境快照；没有改变模组或存档。'); return true; }
    catch (_) { say('无法写入快照，可能是存储权限或空间不足。'); return false; }
  }
  function compare(profile, target) {
    const diff = core.compareProfile(profile, current.mods); target.replaceChildren();
    target.append(node('h4', '与当前环境比较'));
    for (const [key, label] of [['missing', '当前缺少'], ['added', '当前新增']]) {
      const names = diff[key].map(m => clean(typeof m === 'string' ? m : m.name));
      target.append(node('p', label + '：' + (names.join('、') || '无')));
    }
    diff.changed.forEach(m => target.append(node('p', clean(m.name) + '：' + clean(m.before) + ' → ' + clean(m.after))));
    target.append(node('p', '共同模组顺序：' + (diff.orderChanged ? '有变化' : '未变'), 'dwb-muted'));
  }
  function profilesView() {
    body.append(node('p', '环境快照保存名单和版本，供比较与排查；不会恢复启停状态、加载顺序或存档。', 'dwb-muted'));
    const row = node('div', undefined, 'dwb-actions'); const name = node('input'); name.placeholder = '快照名称，例如 日常游玩'; name.maxLength = 80; name.setAttribute('aria-label', '快照名称');
    row.append(name, button('保存当前', () => {
      if (current.incomplete || !current.mods.length) { say('当前名单不完整，暂不保存快照。'); return; }
      try { if (saveProfile(core.makeProfile(current.mods, name.value || '环境快照'))) render(); }
      catch (_) { say('当前模组信息无法保存为快照。'); }
    })); body.append(row);
    const upload = node('input'); upload.type = 'file'; upload.accept = '.json,application/json'; upload.setAttribute('aria-label', '导入环境快照 JSON');
    upload.addEventListener('change', async () => {
      const file = upload.files?.[0]; if (!file) return;
      try { if (file.size > 262144) throw Error('too large'); const p = core.parseProfile(await file.text()); if (saveProfile(p)) render(); }
      catch (_) { say('导入失败：请选择模组中心导出的快照 JSON（最大 256 KB），不是存档或模组 ZIP。'); }
    }); const label = node('label', '导入快照 JSON', 'dwb-label'); label.append(upload); body.append(label);
    const all = readProfiles(); if (!all) return;
    if (!all.length) body.append(node('p', '还没有快照。更换模组前保存一份，就能对照检查。', 'dwb-card'));
    all.forEach((p, index) => {
      const card = node('article', undefined, 'dwb-card'), actions = node('div', undefined, 'dwb-actions'), comparison = node('div');
      card.append(node('h3', clean(p.label)), node('p', p.mods.length + ' 个模组 · ' + clean(p.createdAt), 'dwb-muted'));
      actions.append(button('比较', () => compare(p, comparison)), button('导出', () => exportFile(JSON.stringify(p, null, 2), 'dol-workbench-profile.json', 'application/json')),
        button('删除', () => {
          const confirmation = node('div', undefined, 'dwb-actions'); confirmation.append(node('span', '仅删除这份快照？'), button('确认删除', () => {
            const fresh = readProfiles(); if (!fresh || JSON.stringify(fresh[index]) !== JSON.stringify(p)) { say('快照已变化，请刷新后重试。'); return; }
            try { fresh.splice(index, 1); root.localStorage.setItem(STORE, JSON.stringify(fresh)); say('快照已删除。'); render(); }
            catch (_) { say('删除失败；存储可能不可写。'); }
          }), button('取消', () => confirmation.remove())); comparison.replaceChildren(confirmation);
        })); card.append(actions, comparison); body.append(card);
    });
  }
  async function exportFile(text, filename, mime = 'text/plain;charset=utf-8') {
    try {
      const blob = new Blob([text], {type: mime});
      if (typeof root.cordova?.plugins?.saveDialog?.saveFile === 'function') {
        await root.cordova.plugins.saveDialog.saveFile(blob, filename); say('文件已交给系统保存。');
      } else {
        const url = URL.createObjectURL(blob); urls.add(url); const a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
        setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000); say('已发起下载；若没有保存，请使用复制报告。');
      }
    } catch (_) { say('导出未完成或已取消；可使用复制报告。'); }
  }
  async function copyReport() {
    current = snapshot();
    try { await navigator.clipboard.writeText(lastReport); say('诊断报告已复制。'); }
    catch (_) {
      const old = panel.querySelector('.dwb-copy'); old?.remove();
      const area = node('textarea', undefined, 'dwb-copy'); area.value = lastReport; area.readOnly = true; area.setAttribute('aria-label', '手动复制诊断报告'); body.prepend(area); area.focus(); area.select(); say('请长按选中内容复制；电脑可按 Ctrl+C。');
    }
  }
  function render() {
    body.replaceChildren();
    for (const b of tabs.children) { b.setAttribute('aria-pressed', String(b.dataset.tab === active)); }
    ({overview, mods: modsView, errors: errorsView, profiles: profilesView}[active])();
  }
  function select(tab) { active = tab; render(); }
  function mount(container) {
    if (destroyed || !container || typeof container.append !== 'function') return null;
    mountContainer = container;
    panel = node('section'); panel.id = 'dwb-panel'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', 'dwb-title');
    const header = node('header', undefined, 'dwb-header'), title = node('div'), h = node('h2', '诊断与环境'); h.id = 'dwb-title';
    title.append(node('span', 'DOL MOD CENTER · 1.0', 'dwb-eyebrow'), h); header.append(title);
    const actions = node('div', undefined, 'dwb-toolbar'); actions.append(button('刷新检查', () => { current = snapshot(); render(); say('检查已刷新。'); }), button('复制报告', copyReport), button('导出报告', () => { current = snapshot(); exportFile(lastReport, 'dol-workbench-report.txt'); }));
    tabs = node('nav', undefined, 'dwb-tabs'); tabs.setAttribute('aria-label', '诊断页面');
    for (const [id, label] of [['overview', '概览'], ['mods', '运行模组'], ['errors', '诊断'], ['profiles', '运行快照']]) { const b = button(label, () => select(id)); b.dataset.tab = id; tabs.append(b); }
    notice = node('p', '此页检查与记录环境；模组启停请切换到模组管理。', 'dwb-status'); notice.setAttribute('role', 'status');
    body = node('div', undefined, 'dwb-body'); panel.append(header, actions, tabs, notice, body);
    container.replaceChildren(panel); attachObserver();
    if (root.jQuery && !jqueryAttached) { root.jQuery(document).on(':passageend.dolWorkbench', attachObserver); jqueryAttached = true; }
    return panel;
  }
  function startCollectors() {
    attachObserver();
    if (root.jQuery && !jqueryAttached) { root.jQuery(document).on(':passageend.dolWorkbench', attachObserver); jqueryAttached = true; }
  }
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', startCollectors, {once: true}); else startCollectors();
  listen(root, 'error', e => record(e.message || '脚本错误', '运行时'));
  listen(root, 'unhandledrejection', e => record(e.reason, '异步运行时'));
  root.dmcMountDiagnostics = function (container = document.getElementById('dmc-diagnostics-host')) {
    if (destroyed || !container || typeof container.append !== 'function') return null;
    if (!panel || !panel.isConnected || panel.parentElement !== container) mount(container);
    current = snapshot(); render();
    return panel;
  };
  root.DMCDiagnostics = {getReport(){snapshot();return lastReport+'\n\n最近变更（不代表报错原因）：\n'+JSON.stringify(root.DMCJournal?.list?.()||[])+'\n'+(root.DMCJournal?.status?.()||'');},mount: root.dmcMountDiagnostics, refresh() { current = snapshot(); if (panel?.isConnected) render(); }, destroy() {
    destroyed = true; observer?.disconnect(); clearTimeout(timer); events.forEach(off => off());
    if (root.jQuery && jqueryAttached) root.jQuery(document).off('.dolWorkbench');
    urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); panel?.remove(); panel = null; mountContainer = null; delete root.DMCDiagnostics; delete root.dmcMountDiagnostics;
  }};
})(window);
