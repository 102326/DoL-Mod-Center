(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DMCAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function text(value) { return typeof value === 'string' ? value : String(value ?? ''); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function boot(record) { return record && record.bootJson && typeof record.bootJson === 'object' ? record.bootJson : null; }
  function clean(value) { return value && value.name ? value : {name: text(value), bootJson: {}}; }
  function aliases(record) { return list(boot(record)?.alias).filter(function (x) { return typeof x === 'string' && x; }); }
  function index(records) { var result = new Map(); records.forEach(function (record) { [record.name].concat(aliases(record)).forEach(function (key) { if (!result.has(key)) result.set(key, []); result.get(key).push(record); }); }); return result; }
  function finding(id, severity, certainty, title, evidence, suggestion, names) { return {id, severity, certainty, title, evidence: evidence.map(text), suggestion, modNames: Array.from(new Set((names || []).filter(Boolean)))}; }
  function records(context) { var state = context?.state || {}, catalog = list(context?.catalog?.items || context?.catalog).map(clean), pre = list(state.preloaded).filter(function (x) { return x?.from === 'Local'; }); return catalog.concat(pre.filter(function (x) { return !catalog.some(function (c) { return c.name === x.name; }); })); }
  function dependents(name, context) {
    var state = context?.state || {}, enabled = new Set(list(state.enabled)), all = records(context), by = index(all), edges = new Map(), seen = new Set(), result = [];
    all.forEach(function (record) { list(boot(record)?.dependenceInfo).forEach(function (dependency) { (by.get(dependency?.modName) || []).forEach(function (target) { if (!edges.has(target.name)) edges.set(target.name, new Set()); edges.get(target.name).add(record.name); }); }); });
    function walk(target) { (edges.get(target) || new Set()).forEach(function (dependent) { if (seen.has(dependent) || !enabled.has(dependent) || dependent === name) return; seen.add(dependent); result.push(dependent); walk(dependent); }); }
    walk(name); return result;
  }
  // Read build metadata only, never State.variables or save data.
  function gameVersion(runtime) {
    try { var v = runtime?.StartConfig?.version; return typeof v === 'string' && /^\d+(?:\.\d+){2,}(?:[-+][\w.-]+)?$/.test(v) ? v : undefined; } catch (_) { return undefined; }
  }
  function analyze(input) {
    input = input || {}; var state = input.state || {}, enabled = list(state.enabled), disabled = new Set(list(state.disabled));
    var catalogInput = input.catalog?.items || input.catalog, incomplete = !Array.isArray(catalogInput), catalog = list(catalogInput).map(clean), trusted = list(state.preloaded).filter(function (x) { return x?.from === 'Local'; });
    var all = catalog.concat(trusted.filter(function (x) { return !catalog.some(function (c) { return c.name === x.name; }); })), by = index(all), order = new Map(enabled.map(function (name, i) { return [name, i]; })), findings = [];
    function add(item) { if (findings.length < 100) findings.push(item); }
    if (incomplete) add(finding('catalog-incomplete', 'warning', 'unknown', '模组目录不完整', ['未能完整读取本地模组资料。'], '补充完整目录后重新检查。', []));
    list(state.missing).slice(0, 100).forEach(function (name) { add(finding('missing-package:' + name, 'error', 'confirmed', '配置引用的模组包缺失', ['配置引用但未找到包体：' + name], '导入该包或移除配置引用。', [name])); });
    catalog.forEach(function (record) { if (!record.name || !boot(record) || !text(record.version || boot(record).version)) add(finding('bad-catalog:' + text(record.name), 'error', 'confirmed', '模组资料无效', ['目录项缺少有效名称、bootJson 或版本。'], '重新导入并检查包内 boot.json。', [record.name])); if (record.error) add(finding('catalog-error:' + record.name, 'error', 'confirmed', '模组目录报告错误', [text(record.error).slice(0, 500)], '查看包资料并重新导入有效版本。', [record.name])); });
    enabled.forEach(function (owner) {
      var ownerRecord = (by.get(owner) || [])[0], ownerBoot = boot(ownerRecord); if (!ownerBoot) return;
      list(ownerBoot.dependenceInfo).forEach(function (dependency) {
        if (!dependency || typeof dependency.modName !== 'string') return; var token = dependency.modName;
        if (token === 'GameVersion') {
          var ok; try { ok = input.gameVersion && typeof input.checkVersion === 'function' ? input.checkVersion(input.gameVersion, dependency.version) : undefined; } catch (_) { ok = undefined; }
          if (ok === false) add(finding('game-mismatch:' + owner, 'error', 'confirmed', '游戏版本不符合要求', [owner + ' 要求 ' + text(dependency.version), '当前游戏 ' + text(input.gameVersion)], '核对游戏与模组的支持版本后使用兼容版本。', [owner]));
          else if (ok !== true) {
            var pending = findings.find(function (f) { return f.id === 'game-version-unknown'; });
            if (!pending) { pending = finding('game-version-unknown', 'info', 'unknown', '游戏版本检查尚未完成', [], '未取得游戏构建版本或版本范围无法解析；这不表示预装模组缺失，也不表示已确认不兼容。', []); add(pending); }
            if (pending.evidence.length < 100) pending.evidence.push(owner + ' 要求 ' + text(dependency.version));
          }
          return;
        }
        if (token === 'ModLoader') { if (typeof input.checkVersion !== 'function' || !input.loaderVersion) { add(finding('loader-version:' + owner, 'warning', 'unknown', '加载器版本依赖待核对', [owner + ' 要求 ModLoader ' + text(dependency.version)], '提供加载器版本和匹配器后重新检查。', [owner])); return; } var loaderOK; try { loaderOK = input.checkVersion(input.loaderVersion, dependency.version); } catch (_) { loaderOK = undefined; } if (loaderOK === false) add(finding('loader-mismatch:' + owner, 'error', 'confirmed', '加载器版本不符合要求', [owner + ' 要求 ' + text(dependency.version), '当前 ' + text(input.loaderVersion)], '使用兼容的 ModLoader 版本。', [owner])); else if (loaderOK === undefined) add(finding('loader-unknown:' + owner, 'warning', 'unknown', '加载器版本未确认', [owner + ' 的 ModLoader 范围未被匹配器确认。'], '使用可靠匹配器后重新检查。', [owner])); return; }
        var matches = by.get(token) || []; if (matches.length > 1) { add(finding('ambiguous:' + owner + ':' + token, 'warning', 'unknown', '依赖名称存在歧义', [owner + ' 的依赖 ' + token + ' 匹配多个名称或别名。'], '消除重复名称/别名后重新检查。', [owner, token])); return; }
        if (disabled.has(token)) { add(finding('disabled:' + owner + ':' + token, 'error', 'confirmed', '依赖模组已禁用', [owner + ' 依赖 ' + token + '，但它在禁用名单中。'], '启用该依赖后重新检查。', [owner, token])); return; }
        if (!matches.length) { add(finding('missing:' + owner + ':' + token, incomplete ? 'warning' : 'error', incomplete ? 'unknown' : 'confirmed', '依赖模组缺失', [owner + ' 依赖 ' + token, incomplete ? '目录不完整，无法确认是否确实缺包。' : '目录与可信预载均未找到该名称或别名。'], '补充目录或导入依赖后重新检查。', [owner, token])); return; }
        var target = matches[0]; if (disabled.has(target.name)) { add(finding('disabled:' + owner + ':' + token, 'error', 'confirmed', '依赖模组已禁用', [owner + ' 依赖 ' + target.name + '，但它在禁用名单中。'], '启用该依赖后重新检查。', [owner, target.name])); return; }
        if (!enabled.includes(target.name) && !trusted.some(function (x) { return x.name === target.name; })) add(finding('not-enabled:' + owner + ':' + token, 'warning', 'confirmed', '依赖未列入下次启用名单', [owner + ' 依赖 ' + target.name + '。'], '确认下次启动会启用依赖。', [owner, target.name]));
        var versionOK; if (typeof input.checkVersion !== 'function') versionOK = undefined; else { try { versionOK = input.checkVersion(text(target.version || boot(target)?.version), text(dependency.version)); } catch (_) { versionOK = undefined; } }
        if (versionOK === false) add(finding('version:' + owner + ':' + token, 'error', 'confirmed', '依赖版本不符合要求', [owner + ' 要求 ' + token + ' ' + text(dependency.version), '当前 ' + text(target.version || boot(target)?.version)], '使用作者提供的兼容版本，避免仅修改版本声明绕过检查。', [owner, target.name])); else if (versionOK === undefined) add(finding('version-unknown:' + owner + ':' + token, 'warning', 'unknown', '依赖版本待核对', [owner + ' 的 ' + token + ' 版本匹配器未确认。'], '提供可靠版本匹配器后重新检查。', [owner, target.name]));
      });
    });
    enabled.forEach(function (owner, i) { list(boot((by.get(owner) || [])[0])?.dependenceInfo).forEach(function (dependency) { var target = (by.get(dependency?.modName) || [])[0], j = target && order.get(target.name); if (j !== undefined && j > i) add(finding('order:' + owner + ':' + target.name, 'warning', 'confirmed', '依赖顺序在后', [owner + ' 位于 ' + i + '，依赖 ' + target.name + ' 位于 ' + j], '按前置依赖顺序重排。', [owner, target.name])); }); });
    const logRules=[
      [/not found mod|need mod.*not find|缺少.*前置/i,'加载日志提示缺少前置','对照下次启用名单检查前置是否已安装、启用；当前日志可能来自修改前的会话。'],
      [/not satisfies|版本不符/i,'加载日志提示版本不符','核对模组声明的版本范围和当前挂载版本，安装兼容版本后重启验证。'],
      [/cannot find findString|errorCount:\[?[1-9]|补丁.*失败/i,'补丁未能应用','补丁目标可能与当前游戏或其他模组修改后的内容不同；查看失败目标及对应模组版本。'],
      [/QuotaExceeded|TransactionInactive|AbortError|indexeddb.*(?:error|fail)|存储.*(?:失败|异常)/i,'模组存储操作异常','先保留可导出的备份，核对可用空间；失败不代表操作一定未提交，请刷新检查。'],
      [/TypeError|ReferenceError|SyntaxError|errors? within widget|bad evaluation|bad conditional/i,'游戏运行时错误','代码访问了不符合预期的数据或执行失败；结合报错位置、模组版本和最近变更排查，不能仅凭此断定某个模组有错。']
    ];
    list(input.logs).slice(-100).forEach(function(log,i){if(!/^(error|warn|warning)$/i.test(text(log?.level)))return;const message=text(log.message).slice(0,1000),rule=logRules.find(r=>r[0].test(message));add(finding('log:'+i,text(log.level).toLowerCase()==='error'?'error':'warning','confirmed',rule?rule[1]:'运行日志报告错误或警告',[message+(log.count?'（'+log.count+' 次）':''),log.source?'来源：'+text(log.source).slice(0,160):''],(rule?rule[2]:'查看原始日志及发生步骤。')+' 这是已观察到的现象，不据此归责。',[]));});
    const changeLabels={installBatch:'批量导入或更新',rollbackRecovery:'恢复上次导入',dismissRecovery:'保留当前配置',install:'导入或更新',remove:'删除',toggle:'启停',move:'调整顺序',reorderCatalog:'按前置排序',restore:'恢复完整备份',disableAll:'停用旁加载模组'};
    if (findings.some(function (x) { return x.id.indexOf('log:') === 0; })) list(input.changes).slice(-20).forEach(function (change, i) { add(finding('change-correlation:' + i, 'info', 'possible', '最近配置变更（排查线索）', [text(change.time).slice(0,40)+' · '+(changeLabels[change.kind]||'配置变更') + '：' + list(change.names).join('、')], '仅将此变更作为排查线索，不能视为根因。', list(change.names))); });
    if(findings.length>=100)findings[99]=finding('truncated','warning','unknown','检查结果已截断',['最多展示 100 项；原始日志仅分析最近 100 组。'],'先处理已有问题，再重新检查。',[]);
    return findings.slice(0, 100);
  }
  return {analyze, dependents, gameVersion};
});
