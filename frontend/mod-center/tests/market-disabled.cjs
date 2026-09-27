const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = path.resolve(root, '../../mods/mod-center-v1/tests/native-loader.fixture.js');
const demo = path.join(__dirname, 'demo.html');

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  try {
    const page = await browser.newPage({viewport: {width: 1704, height: 1136}});
    const errors = [], network = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', request => {
      if (request.url().startsWith('https://api.github.com/') || request.url().includes('degreesoflewditycn.miraheze.org')) network.push(request.url());
    });
    await page.goto(pathToFileURL(demo).href);
    await page.waitForFunction(() => window.__fixtureReady);
    await page.evaluate(() => {
      window.nativeTestName = 'DMC_MARKET_DISABLED_' + crypto.randomUUID();
      window.modLoaderKeyConfigWinHookFunction = config => {
        config.config.set('ModLoader_IndexDBLoader', nativeTestName);
        config.config.set('keyval', nativeTestName);
        config.config.set('modDataIndexDBZipList', 'disabled-enabled');
        config.config.set('modDataIndexDBZipListHidden', 'disabled-hidden');
        config.config.set('modDataIndexDBZipPrefix', 'disabled-package');
      };
      localStorage.setItem('dmc.market.sources.v1', 'market-source-sentinel');
      localStorage.setItem('dmc.market.wiki.v1', 'market-wiki-sentinel');
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) { if (key.startsWith('dmc.market.')) window.__marketStorageAccess.push(['get', key]); return originalGet.call(this, key); };
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('dmc.market.')) window.__marketStorageAccess.push(['set', key, value]); return originalSet.call(this, key, value); };
      window.__marketStorageAccess = [];
      window.cordova = {exec() { throw new Error('disabled market test must not call native services'); }};
    });
    await page.addScriptTag({path: fixture});
    await page.addStyleTag({path: path.join(root, 'dist/ui.css')});
    await page.addScriptTag({path: path.join(root, 'dist/ui.js')});
    await page.locator('#dmc-sidebar-button').click();
    const ui = page.locator('.dmc-next');
    assert.equal(await ui.getByRole('button', {name: /模组市场/}).count(), 0, 'market navigation is hidden');
    assert.equal(await ui.locator('.next-market').count(), 0, 'market panel is not mounted');
    assert.equal(await page.evaluate(() => window.__marketStorageAccess.length), 0, 'market storage is untouched');
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('dmc.market.sources.v1'), localStorage.getItem('dmc.market.wiki.v1')]), ['market-source-sentinel', 'market-wiki-sentinel']);
    await page.evaluate(() => { window.__marketStorageAccess = []; });
    assert.deepEqual(network, [], 'disabled market makes no GitHub or Wiki requests');

    const nav = ui.locator('.next-nav');
    await nav.getByRole('button', {name: /诊断助手/}).click();
    await nav.getByRole('button', {name: /备份与恢复/}).click();
    await nav.getByRole('button', {name: /本地模组/}).click();
    await ui.getByRole('button', {name: '待导入列表', exact: true}).click();
    assert.equal(await ui.locator('.local-library').isVisible(), true, 'pure local import remains reachable');
    assert.equal(await page.evaluate(() => window.__marketStorageAccess.length), 0);
    assert.deepEqual(network, []);
    await page.evaluate(() => { DoLModCenter.close(); DoLModCenter.open(); });
    assert.equal(await ui.locator('.next-market').count(), 0);
    assert.equal(await page.evaluate(() => window.__marketStorageAccess.length), 0);
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    console.log('PASS disabled market: navigation/panel hidden, market storage sentinels unchanged, zero GitHub/Wiki requests, pure local import remains reachable');
    await page.evaluate(() => DoLModCenter.destroy());
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
