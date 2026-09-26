(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DMCSort = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function text(value) { return typeof value === 'string' ? value : String(value); }

  function plan(items, options) {
    options = options || {};
    var input = Array.isArray(items) ? items : [];
    var original = input.slice();
    var originalNames = original.map(function (item) { return item && item.name; });
    var errors = [];
    var warnings = [];
    var nodes = [];
    var byName = Object.create(null);
    var byAlias = Object.create(null);
    var disabled = new Set(Array.isArray(options.disabled) ? options.disabled.filter(function (x) { return typeof x === 'string'; }) : []);
    var external = Array.isArray(options.external) ? options.external : [];
    var externalByName = Object.create(null);
    var externalByAlias = Object.create(null);

    function add(map, key, value) {
      if (!hasOwn(map, key)) map[key] = [];
      map[key].push(value);
    }
    function validName(value) { return typeof value === 'string' && value.length > 0; }
    function bootOf(item) { return item && item.bootJson && typeof item.bootJson === 'object' && !Array.isArray(item.bootJson) ? item.bootJson : null; }
    function names(list) { return list.map(function (n) { return n.name; }); }

    input.forEach(function (item, index) {
      var boot = bootOf(item);
      var node = { item: item, index: index, name: item && item.name, boot: boot, beauty: !!(item && item.beauty), deps: [], out: [], indegree: 0 };
      nodes.push(node);
      if (!validName(node.name)) errors.push('第' + index + '项模组名称格式错误');
      else add(byName, node.name, node);
      if (!boot) errors.push('模组 ' + text(node.name) + ' 的 bootJson 格式错误');
      else if (hasOwn(boot, 'alias') && !Array.isArray(boot.alias)) errors.push('模组 ' + text(node.name) + ' 的 alias 格式错误');
      else if (Array.isArray(boot.alias)) boot.alias.forEach(function (alias) {
        if (!validName(alias)) errors.push('模组 ' + text(node.name) + ' 的 alias 格式错误');
        else add(byAlias, alias, node);
      });
    });

    Object.keys(byName).forEach(function (name) {
      if (byName[name].length > 1) errors.push('模组名称重复：' + name);
    });
    Object.keys(byAlias).forEach(function (alias) {
      if (byAlias[alias].length > 1 || hasOwn(byName, alias)) errors.push('别名有歧义：' + alias);
    });

    function indexExternal(item, index) {
      var boot = bootOf(item);
      var name = item && item.name;
      if (!validName(name) || !boot) return;
      add(externalByName, name, { item: item, index: index, name: name });
      if (Array.isArray(boot.alias)) boot.alias.forEach(function (alias) {
        if (validName(alias)) add(externalByAlias, alias, { item: item, index: index, name: name });
      });
    }
    external.forEach(indexExternal);
    Object.keys(externalByName).forEach(function (name) {
      if (externalByName[name].length > 1) errors.push('当前运行时外部模组名称重复：' + name);
    });

    function candidatesFor(token, map, aliasMap) {
      var found = [];
      if (hasOwn(map, token)) found = found.concat(map[token]);
      if (hasOwn(aliasMap, token)) found = found.concat(aliasMap[token]);
      return found;
    }
    function resolve(token, owner) {
      var internal = candidatesFor(token, byName, byAlias);
      if (internal.length > 1) {
        errors.push('模组 ' + owner + ' 的依赖有歧义：' + token);
        return { kind: 'error' };
      }
      if (internal.length === 1) return { kind: 'internal', node: internal[0] };
      var outside = candidatesFor(token, externalByName, externalByAlias);
      if (outside.length > 1) {
        errors.push('模组 ' + owner + ' 的外部依赖有歧义：' + token);
        return { kind: 'error' };
      }
      if (outside.length === 1) {
        if (disabled.has(token) || disabled.has(outside[0].name)) {
          errors.push('依赖已禁用：' + token + '（模组 ' + owner + '）');
          return { kind: 'error' };
        }
        return { kind: 'external', item: outside[0].item };
      }
      if (disabled.has(token)) errors.push('依赖已禁用：' + token + '（模组 ' + owner + '）');
      else errors.push('缺少依赖：' + token + '（模组 ' + owner + '）');
      return { kind: 'error' };
    }
    function validateResolvedVersion(owner, dep, resolved) {
      var provided = resolved.kind === 'internal' ? (resolved.node.boot && resolved.node.boot.version) : (resolved.item && resolved.item.bootJson && resolved.item.bootJson.version);
      provided = provided === undefined || provided === null ? '' : text(provided);
      if (typeof options.checkVersion !== 'function') {
        warnings.push('无法校验模组 ' + owner + ' 的依赖版本：' + dep.modName);
        return;
      }
      var checked;
      try { checked = options.checkVersion(provided, dep.version); }
      catch (e) { errors.push('模组 ' + owner + ' 的依赖版本校验失败：' + dep.modName); return; }
      if (checked === false) errors.push('模组 ' + owner + ' 的依赖版本不符合要求（依赖：' + dep.modName + '，要求：' + dep.version + '，当前：' + provided + '）');
      else if (checked === undefined) warnings.push('模组 ' + owner + ' 的依赖版本未校验：' + dep.modName);
    }

    nodes.forEach(function (node) {
      var boot = node.boot;
      if (!boot) return;
      var deps = boot.dependenceInfo;
      if (deps === undefined || deps === null) deps = [];
      if (!Array.isArray(deps)) {
          errors.push('模组 ' + text(node.name) + ' 的 dependenceInfo 格式错误');
        return;
      }
      var seen = Object.create(null);
      deps.forEach(function (dep) {
        if (!dep || typeof dep !== 'object' || !validName(dep.modName) || typeof dep.version !== 'string') {
          errors.push('模组 ' + text(node.name) + ' 的依赖格式错误');
          return;
        }
        var token = dep.modName;
        if (hasOwn(seen, token)) errors.push('模组 ' + text(node.name) + ' 的依赖重复：' + token);
        seen[token] = true;
        if (token === 'GameVersion') {
          warnings.push('模组 ' + text(node.name) + ' 的 GameVersion 依赖未校验');
          return;
        }
        if (token === 'ModLoader') {
          if (typeof options.checkVersion !== 'function') warnings.push('无法校验模组 ' + text(node.name) + ' 的 ModLoader 版本');
          else {
            var checked;
            try { checked = options.checkVersion(options.loaderVersion || '', dep.version); }
            catch (e) { errors.push('模组 ' + text(node.name) + ' 的 ModLoader 版本校验失败'); return; }
            if (checked === false) errors.push('模组 ' + text(node.name) + ' 的 ModLoader 版本不符合要求（要求：' + dep.version + '，当前：' + text(options.loaderVersion || '') + '）');
            else if (checked === undefined) warnings.push('模组 ' + text(node.name) + ' 的 ModLoader 版本未校验');
          }
          return;
        }
        var resolved = resolve(token, text(node.name));
        if (resolved.kind === 'internal') {
          validateResolvedVersion(text(node.name), dep, resolved);
          if (resolved.node === node) errors.push('模组不能依赖自身：' + text(node.name));
          else {
            resolved.node.out.push(node);
            node.indegree += 1;
            node.deps.push(resolved.node);
          }
        } else if (resolved.kind === 'external') {
          validateResolvedVersion(text(node.name), dep, resolved);
          warnings.push('当前运行时外部依赖下次启动前复核：' + token + '（模组 ' + text(node.name) + '）');
        }
      });
    });

    if (errors.length) return { order: originalNames, errors: errors, warnings: warnings, changed: false };
    var available = nodes.filter(function (node) { return node.indegree === 0; });
    var sorted = [];
    function pick() {
      available.sort(function (a, b) { return (a.beauty - b.beauty) || (a.index - b.index); });
      return available.shift();
    }
    while (available.length) {
      var current = pick();
      sorted.push(current);
      current.out.forEach(function (dependent) {
        dependent.indegree -= 1;
        if (dependent.indegree === 0) available.push(dependent);
      });
    }
    if (sorted.length !== nodes.length) {
      var remaining = nodes.filter(function (node) { return sorted.indexOf(node) < 0; }).sort(function (a, b) { return a.index - b.index; });
      errors.push('依赖循环或排序受阻，涉及剩余模组：' + names(remaining).join('、'));
      return { order: originalNames, errors: errors, warnings: warnings, changed: false };
    }
    var order = sorted.map(function (node) { return node.name; });
    var changed = order.some(function (name, index) { return name !== originalNames[index]; });
    return { order: order, errors: errors, warnings: warnings, changed: changed };
  }

  return { plan: plan };
});
