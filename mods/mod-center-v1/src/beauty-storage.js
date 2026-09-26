(function (root) {
  'use strict';
  var active = 0;
  var KEY = 'BeautySelectorAddon_OrderSaveKey';
  var LOADER = '2.101.1';
  var BEAUTY = '2.9.0';

  function fail(message) { throw Error(message); }
  function loaderVersion(env) { return String(env.modUtils && env.modUtils.version || ''); }
  function runtimeAddon(env) {
    var utils = env.modUtils;
    return utils && ((utils.getAnyModByNameNoAlias && utils.getAnyModByNameNoAlias('BeautySelectorAddon')) || (utils.getMod && utils.getMod('BeautySelectorAddon')));
  }
  function gate(env, addon) {
    var runtime = runtimeAddon(env), boot = runtime && runtime.bootJson;
    var ok = loaderVersion(env) === LOADER && !!boot && String(boot.version || '') === BEAUTY;
    return { writable: ok, reason: ok ? '' : '当前加载器或 BeautySelectorAddon 版本未经过验证，只读。' };
  }
  function validType(value) { return typeof value === 'string' && value.length > 0; }
  function registry(addon) {
    var all = addon.getTypeOrder();
    if (!Array.isArray(all)) all = Array.from(all || []);
    if (!all.every(function (entry) { return entry && validType(entry.type) && entry.modRef && typeof entry.modRef.name === 'string'; })) fail('BeautySelectorAddon 类型目录格式异常。');
    var seen = new Set();
    all.forEach(function (entry) { if (seen.has(entry.type)) fail('BeautySelectorAddon 类型重复：' + entry.type); seen.add(entry.type); });
    var used = Array.isArray(addon.typeOrderUsed) ? addon.typeOrderUsed.slice() : [];
    if (!used.every(function (entry) { return entry && validType(entry.type); })) fail('BeautySelectorAddon 已启用类型格式异常。');
    var allNames = new Set(all.map(function (entry) { return entry.type; }));
    if (used.some(function (entry) { return !allNames.has(entry.type); })) fail('BeautySelectorAddon 已启用类型包含未知项。');
    var usedTypes = used.map(function (entry) { return entry.type; });
    if (new Set(usedTypes).size !== usedTypes.length) fail('BeautySelectorAddon 已启用类型重复。');
    return { all: all.slice(), used: used, usedTypes: usedTypes, names: all.map(function (entry) { return entry.type; }) };
  }
  function readRaw(addon) {
    return addon.customStore('readonly', function (store) {
      return new Promise(function (resolve, reject) {
        var tx = store.transaction, request;
        tx.oncomplete = function () { resolve(request && request.result); };
        tx.onabort = function () { reject(tx.error || Error('读取美化配置失败。')); };
        tx.onerror = function () {};
        try { request = store.get(addon[KEY]); request.onerror = function () { reject(request.error || Error('读取美化配置失败。')); }; }
        catch (error) { reject(error); }
      });
    });
  }
  function parseOrder(raw, types, usedTypes) {
    var order;
    if (raw === undefined) order = usedTypes.slice();
    else {
      try { order = JSON.parse(raw); } catch (_) { fail('美化配置格式异常，已停止写入。'); }
      if (!Array.isArray(order)) fail('美化配置格式异常，已停止写入。');
    }
    if (new Set(order).size !== order.length || order.some(function (type) { return !validType(type) || !types.has(type); })) fail('美化配置含有重复或未知类型，已停止写入。');
    return order;
  }
  function snapshot(addon, raw, info, writable, reason) {
    var enabled = parseOrder(raw, new Set(info.names), info.usedTypes);
    var enabledSet = new Set(enabled);
    return { entries: info.all.map(function (entry) {
      var images = entry.imgListRef;
      var count = images instanceof Map ? images.size : Array.isArray(images) ? images.length : 0;
      return { type: entry.type, modName: entry.modRef.name, count: count };
    }), enabled: enabled, disabled: info.names.filter(function (type) { return !enabledSet.has(type); }), writable: writable, reason: reason };
  }
  function sameRegistry(before, current) {
    if (before.all.length !== current.all.length || before.usedTypes.length !== current.usedTypes.length) return false;
    for (var i = 0; i < before.all.length; i++) if (before.all[i] !== current.all[i] || before.names[i] !== current.names[i]) return false;
    for (var j = 0; j < before.usedTypes.length; j++) if (before.usedTypes[j] !== current.usedTypes[j]) return false;
    return true;
  }
  function transaction(addon, operation) {
    return addon.customStore('readwrite', function (store) {
      return new Promise(function (resolve, reject) {
        var tx = store.transaction, request, result, settled = false;
        function rejectOnce(error) { if (!settled) { settled = true; reject(error); try { tx.abort(); } catch (_) {} } }
        tx.oncomplete = function () { if (!settled) { settled = true; resolve(result); } };
        tx.onabort = function () { rejectOnce(tx.error || Error('美化配置事务未提交。')); };
        tx.onerror = function () {};
        try {
          request = store.get(addon[KEY]);
          request.onerror = function () { rejectOnce(request.error || Error('读取美化配置失败。')); };
          request.onsuccess = function () {
            try { result = operation(store, request.result); }
            catch (error) { rejectOnce(error); }
          };
        } catch (error) { rejectOnce(error); }
      });
    });
  }
  function create(env) {
    env = env || root;
    var records = new WeakMap(), busy = false;
    function addonOrFail() {
      var addon = env.addonBeautySelectorAddon;
      if (!addon || typeof addon.iniCustomStore !== 'function' || typeof addon.getTypeOrder !== 'function') fail('未找到可用的 BeautySelectorAddon 美化存储接口。');
      return addon;
    }
    async function init(addon) { await addon.iniCustomStore(); }
    async function read() {
      var addon = addonOrFail(); await init(addon);
      if (typeof addon.customStore !== 'function' || typeof addon[KEY] !== 'string') fail('BeautySelectorAddon 美化存储接口初始化失败。');
      var info = registry(addon), raw = await readRaw(addon), g = gate(env, addon);
      var view = snapshot(addon, raw, info, g.writable, g.reason);
      records.set(view, { raw: raw, info: info, enabled: view.enabled.slice(), addon: addon, key: addon[KEY], customStore: addon.customStore });
      return view;
    }
    async function change(view, nextOrder) {
      var requested = Array.isArray(nextOrder) ? nextOrder.slice() : nextOrder;
      var addon = addonOrFail(); await init(addon);
      if (typeof addon.customStore !== 'function' || typeof addon[KEY] !== 'string') fail('BeautySelectorAddon 美化存储接口初始化失败。');
      if (busy || active) fail('已有美化配置操作进行中。');
      var saved = records.get(view); if (!saved) fail('美化配置快照已失效，请重新读取。');
      var g = gate(env, addon); if (!g.writable) fail(g.reason || '美化配置只读。');
      if (!Array.isArray(requested) || new Set(requested).size !== requested.length || requested.some(function (type) { return !saved.info.names.includes(type); })) fail('美化顺序必须是当前类型的不重复子集。');
      if (env.addonBeautySelectorAddon !== saved.addon || addon[KEY] !== saved.key || addon.customStore !== saved.customStore) fail('BeautySelectorAddon 接口已变化，请重新读取。');
      busy = true; active++;
      try {
        await transaction(addon, function (store, raw) {
          if (env.addonBeautySelectorAddon !== saved.addon || addon[KEY] !== saved.key || addon.customStore !== saved.customStore) fail('BeautySelectorAddon 接口已变化，请重新读取。');
          var current = registry(addon);
          if (raw !== saved.raw || !sameRegistry(saved.info, current)) fail('美化配置或类型目录已变化，请重新读取。');
          store.put(JSON.stringify(requested), addon[KEY]);
          return { info: current, raw: raw };
        });
        records.delete(view);
        var afterInfo = registry(addon);
        if (!sameRegistry(saved.info, afterInfo)) fail('美化配置已保存，但类型目录发生变化，请重新载入。');
        var afterRaw = await readRaw(addon);
        if (afterRaw !== JSON.stringify(requested)) fail('美化配置已保存，但回读发现配置变化，请重新载入。');
        if (env.addonBeautySelectorAddon !== saved.addon || addon[KEY] !== saved.key || addon.customStore !== saved.customStore) fail('美化配置已保存，但 BeautySelectorAddon 接口发生变化，请重新载入。');
        afterInfo = registry(addon);
        if (!sameRegistry(saved.info, afterInfo)) fail('美化配置已保存，但类型目录发生变化，请重新载入。');
        var byType = new Map(afterInfo.all.map(function (entry) { return [entry.type, entry]; }));
        addon.typeOrderUsed = requested.map(function (type) { return byType.get(type); });
        var resultInfo = registry(addon);
        var result = snapshot(addon, afterRaw, resultInfo, true, '');
        records.set(result, { raw: afterRaw, info: resultInfo, enabled: requested.slice(), addon: addon, key: addon[KEY], customStore: addon.customStore });
        return result;
      } finally { busy = false; active--; }
    }
    return { read: read, change: change, isBusy: function () { return busy; } };
  }
  root.DMCBeautyStorage = { create: create, isBusy: function () { return active > 0; } };
})(typeof window === 'undefined' ? globalThis : window);
