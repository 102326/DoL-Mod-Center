(function (root) {
  'use strict';
  function parseLogs(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.slice(-1000).filter(x => typeof x === 'string').map(line => {
      const match = line.match(/^\[([^\]]+)\]\[([^\]]+)\]\s*([\s\S]*)$/);
      const message = match ? match[3] : line;
      const kind = match ? match[2].toLowerCase() : 'info';
      return { time: match ? match[1] : '', level: /error/.test(kind) ? 'error' : /warn/.test(kind) ? 'warn' : 'info',
        message, source: '模组加载器' };
    });
  }
  function overlaps(mods) {
    const targets = new Map();
    function add(target, name) {
      if (typeof target !== 'string' || !target || typeof name !== 'string') return;
      if (!targets.has(target)) targets.set(target, new Set());
      targets.get(target).add(name);
    }
    for (const mod of (Array.isArray(mods) ? mods : []).slice(0, 300)) {
      if (!mod || typeof mod !== 'object') continue;
      const boot = mod.bootJson || {};
      for (const addon of Array.isArray(boot.addonPlugin) ? boot.addonPlugin : []) {
        if (!addon || typeof addon !== 'object') continue;
        // Only interpret known patch formats; unknown addon schemas are not evidence.
        if (['TweeReplacer', 'I18nTweeReplacer', 'TweePrefixPostfixAddon'].includes(addon.modName) && Array.isArray(addon.params)) {
          for (const rule of addon.params) if (rule && typeof rule.passage === 'string') add('段落：' + rule.passage, mod.name);
        }
        if (addon.modName === 'ReplacePatcher' && addon.params && typeof addon.params === 'object') {
          for (const kind of ['js', 'css']) {
            for (const rule of Array.isArray(addon.params[kind]) ? addon.params[kind] : []) {
              if (rule && typeof rule.fileName === 'string') add(kind + ' 文件：' + rule.fileName, mod.name);
            }
          }
        }
      }
    }
    return Array.from(targets, ([target, names]) => ({ target, mods: Array.from(names) })).filter(x => x.mods.length > 1).slice(0, 150);
  }
  const api = { parseLogs, overlaps };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DoLWorkbenchDiagnosticsSources = api;
})(typeof window !== 'undefined' ? window : globalThis);
