;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DoLWorkbenchCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_MODS = 300, MAX_NAME = 160, MAX_VERSION = 100, MAX_NOTE = 500;
  var DEP_PSEUDO = { GameVersion: true, ModLoader: true };
  var RESERVED = Object.create(null); RESERVED.__proto__ = true; RESERVED.prototype = true; RESERVED.constructor = true;

  function own(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  function cleanName(v) { return str(v, MAX_NAME).trim(); }
  function cleanVersion(v) { return str(v, MAX_VERSION).trim(); }
  function plain() { return Object.create(null); }
  function issue(id, severity, title, evidence, advice, mods, certainty) {
    return { id: id, severity: severity, title: title, evidence: str(evidence, 500),
      advice: str(advice, 500), mods: (mods || []).map(cleanName).filter(Boolean), certainty: certainty };
  }
  function modMap(mods) {
    var out = plain();
    (Array.isArray(mods) ? mods : []).slice(0, MAX_MODS).forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var n = cleanName(m.name); if (n && !own(out, n)) out[n] = m;
    });
    return out;
  }
  function asDependencyEntries(info) {
    var result = [];
    if (Array.isArray(info)) info.slice(0, MAX_MODS).forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      result.push({ name: cleanName(entry.modName || entry.name), required: cleanVersion(entry.version || entry.range || entry.required) });
    });
    else if (info && typeof info === 'object') Object.keys(info).slice(0, MAX_MODS).forEach(function (name) {
      if (RESERVED[name]) return;
      var required = info[name];
      if (typeof required === 'object' && required !== null) required = required.version || required.range || required.required || required.value || '';
      result.push({ name: cleanName(name), required: cleanVersion(required) });
    });
    return result;
  }
  function aliases(m) {
    var a = m && m.bootJson && m.bootJson.alias;
    return Array.isArray(a) ? a.map(cleanName).filter(Boolean) : [];
  }
  function findMod(map, name) {
    if (own(map, name)) return map[name];
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) if (aliases(map[keys[i]]).indexOf(name) >= 0) return map[keys[i]];
    return null;
  }
  function versionState(actual, req, checker) {
    if (typeof checker === 'function') {
      try { var checked = checker(actual, req); if (checked === true) return 'pass'; if (checked === false) return 'fail'; } catch (_) {}
    }
    return 'unknown';
  }
  function hasIncomplete(options) { return !!(options && options.incomplete); }

  function analyze(mods, groups, notes, options) {
    options = options && typeof options === 'object' ? options : {};
    var map = modMap(mods), issues = [], seen = plain(), truncated = false;
    function add(x, key) { key = key || x.id + '|' + x.title + '|' + x.evidence; if (!seen[key]) { if (issues.length >= 150) { truncated = true; return; } seen[key] = true; issues.push(x); } }
    var list = Object.keys(map).map(function (n) { var m = map[n]; return { name: n, version: cleanVersion(m.version) }; });
    (Array.isArray(mods) ? mods : []).slice(0, MAX_MODS).forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var owner = cleanName(m.name); if (!owner) return;
      var entries = asDependencyEntries(m.bootJson && m.bootJson.dependenceInfo);
      entries.forEach(function (d) {
        if (!d.name || own(DEP_PSEUDO, d.name)) return;
        var found = findMod(map, d.name);
        if (!found) {
          if (hasIncomplete(options)) return;
          add(issue('missing-dependency:' + owner + ':' + d.name, 'error', '缺少模组前置', owner + ' 需要 ' + d.name + (d.required ? ' ' + d.required : ''), '安装匹配的前置，或停用该模组；不要直接修改存档。', [owner, d.name], 'confirmed'), 'missing|' + owner + '|' + d.name);
        } else if (d.required) {
          var state = versionState(found.version, d.required, options.versionCheck);
          if (state === 'fail') add(issue('version-mismatch:' + owner + ':' + d.name, 'error', '模组前置版本不匹配', owner + ' 需要 ' + d.name + ' ' + d.required + '，当前为 ' + cleanVersion(found.version), '安装要求的版本，或使用与当前前置匹配的兼容包。', [owner, cleanName(found.name)], 'confirmed'), 'version|' + owner + '|' + d.name);
          else if (state === 'unknown') add(issue('version-unknown:' + owner + ':' + d.name, 'warning', '前置版本范围未能确认', owner + ' 声明需要 ' + d.name + ' ' + d.required + '，当前为 ' + cleanVersion(found.version), '让加载器提供版本比较器后再判定；当前不要把它当作兼容通过。', [owner, cleanName(found.name)], 'suspected'), 'unknown|' + owner + '|' + d.name);
        }
      });
    });
    (Array.isArray(groups) ? groups : []).slice(0, 1000).forEach(function (g) {
      if (!g || typeof g !== 'object') return;
      var msg = str(g.message, 700), low = msg.toLowerCase(), source = cleanName(g.source);
      if (!msg) return;
      if (/requested version.*less than (?:the )?existing version/i.test(msg)) {
        add(issue('indexeddb-version-downgrade', 'error', '检测到缓存中的版本降级冲突', msg, '先导出并备份存档，确认冲突的数据库或缓存后再清理对应条目；不要直接删除全部 IndexedDB。', source ? [source] : [], 'confirmed'), 'idb|' + msg.replace(/\s+/g, ' '));
      } else if (/dependencechecker\.check(?:for)?\(?.*?\)?\s+(?:not satisfies|not found mod)/i.test(msg) || /need mod\[.*?\]/i.test(msg)) {
        add(issue('loader-dependency-error', 'error', '模组加载器报告依赖错误', msg, '检查报告中的缺失前置、版本和加载顺序。', source ? [source] : [], 'confirmed'), 'loaderdep|' + msg.replace(/\s+/g, ' '));
      } else if (g.kind === 'patch-failure' || /tweereplacer.*(?:cannot find|errorcount:\s*[1-9])/i.test(msg)) {
        add(issue('patch-failure', 'error', '模组补丁未完整应用', msg, '确认游戏版本与补丁目标匹配，并逐个停用相关模组定位覆盖关系。', source ? [source] : [], 'confirmed'), 'patch|' + msg.replace(/\s+/g, ' '));
      } else if (/cannot read properties of undefined.*(?:pregnancy|pregnancyavoidance|\.type)/i.test(msg)) {
        add(issue('npc-runtime-undefined', 'error', '角色数据可能不完整', msg, '这是症状级判断：先导出存档并检查角色记录、模组版本和迁移顺序；不能仅凭此日志认定某个模组是唯一原因。', source ? [source] : [], 'suspected'), 'npc|' + msg.replace(/\s+/g, ' '));
      } else if (g.level === 'error' || g.level === 'warn' || g.level === 'warning') {
        add(issue('generic-' + (g.level || 'error'), g.level === 'error' ? 'error' : 'warning', g.level === 'error' ? '检测到错误记录' : '检测到警告记录', msg, '查看完整日志并结合相关模组版本定位问题。', source ? [source] : [], 'confirmed'), 'generic|' + msg.replace(/\s+/g, ' '));
      }
    });
    var outNotes = (Array.isArray(notes) ? notes : []).slice(0, 100).map(function (n) { return str(typeof n === 'string' ? n : n && n.message, MAX_NOTE); }).filter(Boolean);
    if (truncated) outNotes.push('诊断提示超过 150 条，仅显示前 150 条；完整范围需分批排查。');
    issues.sort(function (a, b) { return Number(b.severity === 'error') - Number(a.severity === 'error'); });
    return { issues: issues, mods: list, notes: outNotes };
  }

  function makeProfile(mods, label) {
    var seen = plain(), result = [];
    (Array.isArray(mods) ? mods : []).slice(0, MAX_MODS).forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var rawName = typeof m.name === 'string' ? m.name : ''; var rawVersion = typeof m.version === 'string' ? m.version : '';
      if (rawName.length > MAX_NAME || rawVersion.length > MAX_VERSION) throw new Error('profile mod field too large');
      var n = cleanName(rawName); if (!n) return;
      if (own(RESERVED, n) || seen[n]) throw new Error('duplicate or reserved profile mod');
      seen[n] = true; result.push({ name: n, version: cleanVersion(m.version) });
    });
    return { schema: 'DoLWorkbench.profile.v1', label: str(label, 80).trim(), createdAt: new Date().toISOString(), mods: result };
  }
  function parseProfile(text) {
    if (typeof text !== 'string' || text.length > 262144) throw new Error('profile text too large');
    var p; try { p = JSON.parse(text); } catch (_) { throw new Error('invalid profile JSON'); }
    if (!p || typeof p !== 'object' || Array.isArray(p) || p.schema !== 'DoLWorkbench.profile.v1' || !Array.isArray(p.mods) || p.mods.length > MAX_MODS) throw new Error('invalid profile shape');
    if (typeof p.label !== 'string' || p.label.length > 80 || typeof p.createdAt !== 'string' || p.createdAt.length > 64) throw new Error('invalid profile metadata');
    var out = { schema: p.schema, label: p.label.trim(), createdAt: p.createdAt, mods: [] }, seen = plain();
    p.mods.forEach(function (m) {
      if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.name !== 'string' || typeof m.version !== 'string') throw new Error('invalid profile mod');
      if (m.name.length > MAX_NAME || m.version.length > MAX_VERSION) throw new Error('profile mod field too large');
      var n = cleanName(m.name); if (!n || own(RESERVED, n) || seen[n]) throw new Error('duplicate or empty profile mod');
      seen[n] = true; out.mods.push({ name: n, version: cleanVersion(m.version) });
    });
    return out;
  }
  function compareProfile(profile, mods) {
    var before = plain(), current = modMap(mods), missing = [], added = [], changed = [];
    profile.mods.forEach(function (m) { before[m.name] = m.version; if (!own(current, m.name)) missing.push(m.name); else if (cleanVersion(current[m.name].version) !== m.version) changed.push({ name: m.name, before: m.version, after: cleanVersion(current[m.name].version) }); });
    Object.keys(current).forEach(function (n) { if (!own(before, n)) added.push(n); });
    var commonBefore = profile.mods.filter(function (m) { return own(current, m.name); }).map(function (m) { return m.name; });
    var commonAfter = (Array.isArray(mods) ? mods : []).map(function (m) { return cleanName(m && m.name); }).filter(function (n) { return own(before, n) && own(current, n); });
    var orderChanged = commonBefore.length === commonAfter.length && commonBefore.some(function (n, i) { return commonAfter[i] !== n; });
    return { missing: missing, added: added, changed: changed, orderChanged: orderChanged };
  }
  return { analyze: analyze, makeProfile: makeProfile, parseProfile: parseProfile, compareProfile: compareProfile };
}));
