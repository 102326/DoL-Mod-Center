const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, 'demo.html')).href);
    await page.addScriptTag({ path: path.join(__dirname, '..', 'src', 'beauty-storage.js') });
    const result = await page.evaluate(async () => {
      const key = 'test-beauty-order';
      const dbName = 'DMC_BEAUTY_TEST_' + crypto.randomUUID();
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(dbName, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('beauty');
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      const entries = [
        { type: 'hair', modRef: { name: 'A' }, imgListRef: new Map([['a', 1]]) },
        { type: 'face', modRef: { name: 'B' }, imgListRef: new Map([['b', 1], ['c', 1]]) },
        { type: 'body', modRef: { name: 'C' }, imgListRef: [] }
      ];
      const addon = {
        bootJson: { version: '2.9.0' }, BeautySelectorAddon_OrderSaveKey: key, typeOrderUsed: [entries[0], entries[1]],
        getTypeOrder: () => entries,
        async iniCustomStore() {},
        customStore(mode, callback) {
          const tx = db.transaction('beauty', mode);
          const store = tx.objectStore('beauty');
          if (this.__quota && mode === 'readwrite') return callback(new Proxy(store, { get(t, p) { if (p === 'put') return () => { throw Error('quota'); }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } }));
          return callback(store);
        }
      };
      window.addonBeautySelectorAddon = addon;
      window.modUtils = { version: '2.101.1', getAnyModByNameNoAlias: name => name === 'BeautySelectorAddon' ? { bootJson: { version: '2.9.0' } } : undefined, getMod: () => undefined };
      const api = DMCBeautyStorage.create(window);
      const checks = [];
      const eq = (actual, expected, label) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(label); };
      const fail = async (fn, re) => { try { await fn(); throw Error('unexpected success'); } catch (e) { if (!re.test(e.message)) throw e; checks.push(re.source); } };
      await addon.customStore('readwrite', store => new Promise((resolve, reject) => { store.put('keep', 'unrelated'); store.transaction.oncomplete = resolve; store.transaction.onabort = () => reject(store.transaction.error); }));
      let state = await api.read();
      eq(state.entries, [{ type: 'hair', modName: 'A', count: 1 }, { type: 'face', modName: 'B', count: 2 }, { type: 'body', modName: 'C', count: 0 }], 'entries');
      eq(state.enabled, ['hair', 'face'], 'enabled'); eq(state.disabled, ['body'], 'disabled'); if (state.writable !== true) throw Error('writable'); checks.push('read/default');
      state.entries.pop();
      const stale = state;
      const immediate = ['face']; const pending = api.change(state, immediate); immediate[0] = 'hair'; state = await pending;
      eq(state.enabled, ['face'], 'toggle enabled'); eq(state.disabled, ['hair', 'body'], 'toggle disabled'); eq(addon.typeOrderUsed.map(x => x.type), ['face'], 'used'); checks.push('toggle');
      state = await api.change(state, ['body', 'face']);
      eq((await api.read()).enabled, ['body', 'face'], 'reload'); checks.push('reorder/reload');
      await fail(() => api.change(stale, ['hair']), /快照已失效|接口已变化|配置/);
      const bad = await api.read();
      entries.push({ type: 'new', modRef: { name: 'D' }, imgListRef: [] }); await fail(() => api.change(bad, ['face']), /配置或类型目录已变化/); entries.pop();
      const replacement = { ...addon }; window.addonBeautySelectorAddon = replacement; await fail(() => api.change(bad, ['face']), /接口已变化/); window.addonBeautySelectorAddon = addon;
      await addon.customStore('readwrite', store => new Promise((resolve, reject) => { store.put('["body","body"]', key); store.transaction.oncomplete = resolve; store.transaction.onabort = () => reject(store.transaction.error); }));
      await fail(() => api.change(bad, ['face']), /配置或类型目录已变化/);
      await addon.customStore('readwrite', store => new Promise((resolve, reject) => { store.put('["unknown"]', key); store.transaction.oncomplete = resolve; store.transaction.onabort = () => reject(store.transaction.error); }));
      await fail(() => api.read(), /重复或未知/); checks.push('malformed-persisted');
      await addon.customStore('readwrite', store => new Promise((resolve, reject) => { store.put('["body"]', key); store.transaction.oncomplete = resolve; store.transaction.onabort = () => reject(store.transaction.error); }));
      const quota = await api.read();
      addon.__quota = true; await fail(() => api.change(quota, ['face']), /quota/); addon.__quota = false; eq(quota.enabled, ['body'], 'quota snapshot unchanged');
      eq((await api.read()).enabled, ['body'], 'quota unchanged'); checks.push('quota-unchanged');
      eq(await addon.customStore('readonly', store => new Promise(resolve => { const r = store.get('unrelated'); r.onsuccess = () => resolve(r.result); })), 'keep', 'unrelated key'); checks.push('unrelated-preserved');
      window.modUtils.version = 'unknown'; if ((await api.read()).writable !== false) throw Error('readonly'); const readonlyState = await api.read(); await fail(() => api.change(readonlyState, ['face']), /只读/); window.modUtils.version = '2.101.1'; checks.push('readonly-gate');
      delete window.addonBeautySelectorAddon; await fail(() => DMCBeautyStorage.create(window).read(), /未找到/); checks.push('missing-addon');
      db.close(); indexedDB.deleteDatabase(dbName);
      return checks;
    });
    assert.ok(result.length >= 9);
    console.log('PASS beauty-storage ' + result.length);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
