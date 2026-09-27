'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, 'demo.html')).href);
    await page.waitForFunction(() => window.__fixtureReady);
    const checks = await page.evaluate(async () => {
      const api = DMCStorage.create();
      const f = __fixture;
      const checks = [];
      const same = (actual, expected, label) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(label + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
      };
      const equal = (actual, expected, label) => {
        same(actual, expected, label);
        checks.push(label);
      };
      const rejects = async (fn, pattern, label) => {
        try { await fn(); throw Error('unexpected success: ' + label); }
        catch (error) { if (!pattern.test(error.message)) throw error; checks.push(label); }
      };
      const readRaw = async key => f.loader.customStore('readonly', store => new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }));

      // A Local preload is referenced by the enabled list but has no ZIP record.
      const originalGetModLoader = modUtils.getModLoader;
      modUtils.getModLoader = () => {
        const loader = originalGetModLoader();
        loader.getModCacheOneArray = () => [{
          name: 'Preload', from: 'Local', mod: {bootJson: {name: 'Preload', version: '9.0.0'}}
        }];
        return loader;
      };
      await f.seed([
        ['enabled-custom', JSON.stringify(['Preload', 'A', 'B'])],
        ['disabled-custom', JSON.stringify(['C'])],
        ['fixture-package:A', f.pack('A')],
        ['fixture-package:B', f.pack('B')],
        ['fixture-package:C', f.pack('C')]
      ]);

      const before = await api.read();
      let seen;
      const plan = await api.prepareInstallBatch(before, [f.pack('B', '2.0.0'), f.pack('D')], {
        order: context => {
          seen = JSON.parse(JSON.stringify(context));
          same(Object.keys(context).sort(), ['disabled', 'enabled', 'fixedNames', 'items', 'preloaded']);
          same(context.enabled, ['Preload', 'A', 'B', 'D']);
          same(context.disabled, ['C']);
          same(context.items.map(item => item.name), ['A', 'B', 'C', 'D']);
          same(context.preloaded.map(item => item.name), ['Preload']);
          same(context.fixedNames, ['Preload']);
          // The callback receives an isolated copy and must not mutate the plan.
          context.enabled[0] = 'Changed by callback';
          context.items[0].name = 'Changed by callback';
          return ['Preload', 'D', 'B', 'A'];
        }
      });
      if (seen.enabled[0] !== 'Preload') throw Error('callback snapshot was not isolated');
      equal(await api.read(), before, 'prepare callback leaves persisted state unchanged');
      equal(plan.enabled, ['Preload', 'D', 'B', 'A'], 'sorted enabled order prepared');
      await api.installBatch(plan);
      equal((await api.read()).enabled, ['Preload', 'D', 'B', 'A'], 'one transaction commits sorted order');
      equal((await api.read()).disabled, ['C'], 'disabled list preserved');
      equal((await api.readRecovery()).names, ['B', 'D'], 'recovery names cover changed packages');
      equal((await readRaw('DoLModCenter.recovery.v1')).enabled, ['Preload', 'A', 'B'], 'recovery record keeps original order');
      if (!(await readRaw('DoLModCenter.recovery.v1')).expected) throw Error('recovery expected fingerprint');

      const recovery = await api.prepareRecovery();
      await api.rollbackRecovery(recovery);
      equal((await api.read()).enabled, ['Preload', 'A', 'B'], 'rollback restores original enabled order');
      equal((await api.read()).disabled, ['C', 'D'], 'rollback retains new package disabled');

      const invalidOrders = [
        ['Preload', 'A', 'A', 'E'],
        ['Preload', 'A', 'B'],
        ['Preload', 'A', 'B', 'E', 'Extra']
      ];
      for (const order of invalidOrders) {
        const snapshot = await api.read();
        await rejects(
          () => api.prepareInstallBatch(snapshot, [f.pack('E')], {order: () => order}),
          /完整排列/,
          'invalid order rejected: ' + order.join(',')
        );
        equal(await api.readRecovery(), null, 'invalid order leaves no recovery');
      }

      const callbackBefore = await api.read();
      await rejects(
        () => api.prepareInstallBatch(callbackBefore, [f.pack('E')], {order: () => { throw Error('synthetic order failure'); }}),
        /synthetic order failure/,
        'order callback failure propagated'
      );
      equal(await api.read(), callbackBefore, 'callback failure leaves state unchanged');
      equal(await api.readRecovery(), null, 'callback failure leaves no recovery');

      const fixedBefore = await api.read();
      await rejects(
        () => api.prepareInstallBatch(fixedBefore, [f.pack('E')], {order: () => ['A', 'Preload', 'B', 'E']}),
        /固定位置/,
        'preloaded fixed position enforced'
      );
      equal(await api.read(), fixedBefore, 'fixed position rejection leaves state unchanged');

      const token = await api.prepareInstallBatch(fixedBefore, [f.pack('E')], {
        order: () => ['Preload', 'A', 'B', 'E']
      });
      token.enabled.reverse();
      token.disabled.push('Tampered');
      await api.installBatch(token);
      equal((await api.read()).enabled, ['Preload', 'A', 'B', 'E'], 'token field tampering cannot alter prepared order');
      equal((await api.read()).disabled, ['C', 'D'], 'token field tampering cannot alter disabled list');
      await api.dismissRecovery((await api.readRecovery()).id);

      await f.cleanup();
      return checks;
    });
    assert.ok(checks.length >= 18, 'expected batch order assertions');
    console.log('PASS ' + checks.length + ' batch-order assertions\n' + checks.join('\n'));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
