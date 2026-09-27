const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.resolve(root, '../../mods/mod-center-v1');
const fixture = path.join(fixtureRoot, 'tests/native-loader.fixture.js');
const demo = path.join(__dirname, 'demo.html');
assert.ok(fs.existsSync(fixture), `native fixture missing: ${fixture}`);

function jsonResponse(body, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function packageBytes(name, version) {
  const zip = new JSZip();
  zip.file('boot.json', JSON.stringify({ name, version, scriptFileList: [], styleFileList: [], tweeFileList: [], imgFileList: [], additionFile: ['README.md'] }));
  zip.file('README.md', `# ${name}\n\nmarket fixture ${version}`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function reloadedExternalAddress(page, expected) {
  const input = page.locator('input[aria-label="复制下载页地址"]');
  await input.waitFor();
  assert.equal(await input.inputValue(), expected);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const contexts = [];
  const screenshots = path.join(__dirname, 'artifacts');
  fs.mkdirSync(screenshots, { recursive: true });
  try {
    const good100 = await packageBytes('Market Example', '1.0.0');
    const good200 = await packageBytes('Market Example', '2.0.0');
    const wrong = await packageBytes('Other Example', '9.0.0');
    const otherGood = await packageBytes('Other Example', '1.0.0');
    const releases = (asset100, asset200) => [
      { id: 100, name: 'Market Example 1.0.0', tag_name: 'v1.0.0', html_url: 'https://github.com/example/mod/releases/tag/v1.0.0', published_at: '2026-09-01T00:00:00Z', prerelease: false, draft: false, assets: [{ id: 1001, name: 'market-example-1.0.0.zip', size: asset100.length, browser_download_url: 'https://github.com/example/mod/releases/download/v1.0.0/market-example-1.0.0.zip' }, { id: 1002, name: 'source-code.txt', size: 4, browser_download_url: 'https://github.com/example/mod/releases/download/v1.0.0/source-code.txt' }] },
      { id: 200, name: 'Market Example 2.0.0', tag_name: 'v2.0.0', html_url: 'https://github.com/example/mod/releases/tag/v2.0.0', published_at: '2026-09-02T00:00:00Z', prerelease: false, draft: false, assets: [{ id: 2001, name: 'market-example-2.0.0.zip', size: asset200.length, browser_download_url: 'https://github.com/example/mod/releases/download/v2.0.0/market-example-2.0.0.zip' }] }
    ];
    const context = await browser.newContext({ viewport: { width: 1704, height: 1136 } });
    contexts.push(context);
    const page = await context.newPage();
    const consoleErrors = [];
    const githubRequests = [];
    let delayDownload = false;
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('request', request => { if (request.url().startsWith('https://api.github.com/') || request.url().startsWith('https://github.com/example/mod/releases/download/') || request.url().startsWith('https://github.com/example/other/releases/download/')) githubRequests.push(request.url()); });
    await page.route('https://api.github.com/repos/example/mod/releases?per_page=20', route => route.fulfill(jsonResponse(releases(good100, good200))));
    await page.route('https://github.com/example/mod/releases/download/v1.0.0/market-example-1.0.0.zip', async route => { if (delayDownload) await new Promise(resolve => setTimeout(resolve, 2000)); await route.fulfill({ status: 200, contentType: 'application/zip', body: good100 }); });
    await page.route('https://github.com/example/mod/releases/download/v2.0.0/market-example-2.0.0.zip', route => route.fulfill({ status: 200, contentType: 'application/zip', body: good200 }));
    await page.route('https://api.github.com/repos/example/other/releases?per_page=20', route => route.fulfill(jsonResponse([
      { id: 300, name: 'Other source 1.0.0', tag_name: 'v1.0.0', html_url: 'https://github.com/example/other/releases/tag/v1.0.0', published_at: '2026-09-03T00:00:00Z', prerelease: false, draft: false,
        assets: [{ id: 3001, name: 'other-example-1.0.0.zip', size: otherGood.length, browser_download_url: 'https://github.com/example/other/releases/download/v1.0.0/other-example-1.0.0.zip' }] }
    ])));
    await page.route('https://github.com/example/other/releases/download/v1.0.0/other-example-1.0.0.zip', route => route.fulfill({ status: 200, contentType: 'application/zip', body: otherGood }));
    await page.route('https://api.github.com/repos/example/conflict/releases?per_page=20', route => route.fulfill(jsonResponse([
      { id: 400, name: 'Conflict source 1.0.0', tag_name: 'v1.0.0', html_url: 'https://github.com/example/conflict/releases/tag/v1.0.0', published_at: '2026-09-04T00:00:00Z', prerelease: false, draft: false,
        assets: [{ id: 4001, name: 'other-example-1.0.0.zip', size: otherGood.length, browser_download_url: 'https://github.com/example/conflict/releases/download/v1.0.0/other-example-1.0.0.zip' }] }
    ])));
    await page.route('https://github.com/example/conflict/releases/download/v1.0.0/other-example-1.0.0.zip', route => route.fulfill({ status: 200, contentType: 'application/zip', body: otherGood }));
    await page.goto(pathToFileURL(demo).href);
    await page.waitForFunction(() => window.__fixtureReady);
    await page.evaluate(() => {
      window.nativeTestName = 'DMC_MARKET_' + crypto.randomUUID();
      window.modLoaderKeyConfigWinHookFunction = config => {
        config.config.set('ModLoader_IndexDBLoader', nativeTestName);
        config.config.set('keyval', nativeTestName);
        config.config.set('modDataIndexDBZipList', 'market-enabled');
        config.config.set('modDataIndexDBZipListHidden', 'market-disabled');
        config.config.set('modDataIndexDBZipPrefix', 'market-package');
      };
    });
    await page.addScriptTag({ path: fixture });
    await page.addStyleTag({ path: path.join(root, 'dist/ui.css') });
    await page.addScriptTag({ path: path.join(root, 'dist/ui.js') });
    await page.locator('#dmc-sidebar-button').click();
    const ui = page.locator('.dmc-next');
    await ui.getByRole('button', { name: /模组市场/ }).click();
    assert.equal(await page.locator('#dmc-market-address').isVisible(), true);
    assert.equal(githubRequests.length, 0, 'opening market must not query GitHub');

    await page.locator('#dmc-market-address').fill('https://github.com/example/mod');
    await ui.getByRole('button', { name: '添加仓库', exact: true }).click();
    await ui.locator("article[data-repository='example/mod']").waitFor();
    assert.equal(await ui.locator("article[data-repository='example/mod'] select").first().locator('option').count(), 2);
    assert.equal(await ui.locator("article[data-repository='example/mod'] select").last().locator('option').count(), 1, 'non-ZIP release asset is filtered');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('dmc.market.sources.v1'))), { schemaVersion: 1, repositories: [{ key: 'example/mod', owner: 'example', repo: 'mod', url: 'https://github.com/example/mod' }] });

    const repo = ui.locator("article[data-repository='example/mod']");
    assert.equal(await repo.locator('select').first().inputValue(), '200', 'newest published release is selected first');
    await repo.locator('select').first().selectOption('100');
    // A real in-flight download can be cancelled before the preview exists.
    delayDownload = true;
    await repo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await ui.getByRole('button', { name: '取消下载', exact: true }).waitFor();
    const beforeDownloadCancel = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery() }));
    await ui.getByRole('button', { name: '取消下载', exact: true }).click();
    await ui.getByRole('button', { name: '取消下载', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await ui.locator('.next-confirm').count(), 0, 'cancelled download must not open preview');
    const afterDownloadCancel = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery() }));
    assert.deepEqual(afterDownloadCancel.state, beforeDownloadCancel.state, 'cancelled download must not mutate native state');
    assert.deepEqual(afterDownloadCancel.recovery, beforeDownloadCancel.recovery, 'cancelled download must not create recovery');
    delayDownload = false;

    await repo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await ui.locator('.next-confirm').waitFor();
    const beforeCancel = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery() }));
    await ui.locator('.next-confirm').getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForTimeout(100);
    const afterCancel = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery() }));
    assert.deepEqual(afterCancel.state, beforeCancel.state, 'cancelled preview must not install');
    assert.deepEqual(afterCancel.recovery, beforeCancel.recovery, 'cancelled preview must not create recovery');

    await repo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await ui.locator('.next-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await page.waitForFunction(async () => (await DMCStorage.create().read()).packages.includes('Market Example'));
    const installed = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery(), source: JSON.parse(localStorage.getItem('dmc.market.sources.v1')) }));
    assert.ok(installed.recovery, 'confirmed install must create a recovery point');
    assert.equal(installed.source.repositories[0].modName, 'Market Example');
    assert.ok(installed.state.packages.includes('Market Example'));
    await page.evaluate(async () => { const api = DMCStorage.create(); const recovery = await api.readRecovery(); if (recovery) await api.dismissRecovery(recovery.id); });
    // A committed install must remain visible when source binding hits storage quota; retry only binds the source.
    await page.locator('#dmc-market-address').fill('https://github.com/example/other');
    await ui.getByRole('button', { name: '添加仓库', exact: true }).click();
    const otherRepo = ui.locator("article[data-repository='example/other']");
    await otherRepo.waitFor();
    const originalSetItem = await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = false; Storage.prototype.setItem = function(key, value) { if (fail && key === 'dmc.market.sources.v1') throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value); }; window.__failSourceBinding = value => { fail = value; }; return true; });
    assert.equal(originalSetItem, true);
    const beforeBindingFailure = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery() }));
    const downloadsBeforeBindingFailure = githubRequests.length;
    await page.evaluate(() => window.__failSourceBinding(true));
    await otherRepo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await ui.locator('.next-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await ui.locator('.next-notice.failure').waitFor();
    assert.match(await ui.locator('.next-notice.failure').textContent(), /模组已安装，但(?:部分)?仓库关联未保存/);
    const afterBindingFailure = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery(), bytes: Array.from(await DMCStorage.create().exportZip('Other Example')) }));
    assert.ok(afterBindingFailure.recovery, 'committed install keeps its recovery point when source binding fails');
    await page.evaluate(() => window.__failSourceBinding(false));
    const savedSources = await page.evaluate(() => localStorage.getItem('dmc.market.sources.v1'));
    await page.evaluate(() => { const data=JSON.parse(localStorage.getItem('dmc.market.sources.v1')); data.repositories=data.repositories.filter(s=>s.key!=='example/other'); localStorage.setItem('dmc.market.sources.v1',JSON.stringify(data)); });
    await otherRepo.getByRole('button', { name: '重试关联', exact: true }).click();
    assert.match(await ui.locator('.next-market').textContent(), /仓库订阅不存在/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dmc.market.sources.v1')).repositories.some(s=>s.key==='example/other')),false,'retry must not recreate an externally deleted source');
    await page.evaluate(raw => { const data=JSON.parse(raw); data.repositories.find(s=>s.key==='example/other').modName='Conflicting Name'; localStorage.setItem('dmc.market.sources.v1',JSON.stringify(data)); },savedSources);
    await otherRepo.getByRole('button', { name: '重试关联', exact: true }).click();
    assert.match(await ui.locator('.next-market').textContent(), /已经关联其他模组/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dmc.market.sources.v1')).repositories.find(s=>s.key==='example/other').modName),'Conflicting Name','retry must preserve an externally changed association');
    await page.evaluate(raw => { const data=JSON.parse(raw); data.repositories.push({key:'example/unrelated',owner:'example',repo:'unrelated',url:'https://github.com/example/unrelated'}); localStorage.setItem('dmc.market.sources.v1',JSON.stringify(data)); },savedSources);
    await otherRepo.getByRole('button', { name: '重试关联', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('dmc.market.sources.v1')).repositories.some(source => source.key === 'example/other' && source.modName === 'Other Example'));
    assert.match(await ui.locator('.next-notice').first().textContent(), /仓库关联已恢复/);
    assert.equal(await ui.locator('.next-notice.failure').count(),0,'successful retry must clear its global failure notice');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dmc.market.sources.v1')).repositories.some(s=>s.key==='example/unrelated')),true,'retry preserves newly added unrelated sources');
    const afterBindingRetry = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery(), bytes: Array.from(await DMCStorage.create().exportZip('Other Example')) }));
    assert.deepEqual(afterBindingRetry, afterBindingFailure, 'source retry must not rewrite package bytes, lists, or recovery');
    assert.equal(githubRequests.length, downloadsBeforeBindingFailure + 1, 'download is not repeated by binding retry');
    await page.evaluate(async () => { const api = DMCStorage.create(); const recovery = await api.readRecovery(); if (recovery) await api.dismissRecovery(recovery.id); });
    await page.locator('#dmc-market-address').fill('https://github.com/example/conflict');
    await ui.getByRole('button', { name: '添加仓库', exact: true }).click();
    const conflictRepo = ui.locator("article[data-repository='example/conflict']");
    await conflictRepo.waitFor();
    await conflictRepo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await ui.locator('.next-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await ui.locator('.next-notice.failure').waitFor();
    assert.match(await ui.locator('.next-market').textContent(), /已经关联其他仓库/);
    await conflictRepo.getByRole('button', { name: '移除订阅', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dmc.market.sources.v1')).repositories.some(source => source.key === 'example/conflict')), false, 'removing a failed source must not recreate it for retry');
    await page.evaluate(async () => { const api = DMCStorage.create(); const recovery = await api.readRecovery(); if (recovery) await api.dismissRecovery(recovery.id); });
    await otherRepo.getByRole('button', { name: '移除订阅', exact: true }).click();
    await page.evaluate(async () => { const api = DMCStorage.create(); const recovery = await api.readRecovery(); if (recovery) await api.dismissRecovery(recovery.id); });
    await page.evaluate(async () => { const api = DMCStorage.create(); await api.toggle(await api.read(), 'Market Example', false); });
    await repo.locator('select').first().selectOption('200');
    await repo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await ui.locator('.next-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await page.waitForFunction(async () => { const api = DMCStorage.create(); const state = await api.read(); const catalog = await api.catalog(state); return state.disabled.includes('Market Example') && catalog.items.some(item => item.name === 'Market Example' && item.version === '2.0.0'); });
    const exportedBytes = Buffer.from(await page.evaluate(async () => Array.from(await DMCStorage.create().exportZip('Market Example'))));
    const exportedZip = await JSZip.loadAsync(exportedBytes);
    const exportedBoot = JSON.parse(await exportedZip.file('boot.json').async('string'));
    assert.ok(exportedBytes.byteLength > 0);
    assert.deepEqual({ name: exportedBoot.name, version: exportedBoot.version }, { name: 'Market Example', version: '2.0.0' });
    const updateRecovery = await page.evaluate(async () => DMCStorage.create().readRecovery());
    assert.ok(updateRecovery, 'update must retain a recovery point');
    await page.evaluate(async recovery => { await DMCStorage.create().dismissRecovery(recovery.id); }, updateRecovery);

    // Mutating native state after preview invalidates the confirmation token.
    await repo.locator('select').first().selectOption('100');
    await repo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await ui.locator('.next-confirm').waitFor();
    await page.evaluate(async () => { const api = DMCStorage.create(); await api.toggle(await api.read(), 'Market Example', true); });
    await ui.locator('.next-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await ui.locator('.next-notice.failure').waitFor();
    assert.match(await ui.locator('.next-notice.failure').textContent(), /配置已变化|过期|状态|确认期间配置或包体已变化/);
    assert.equal((await page.evaluate(async () => (await DMCStorage.create().read()).disabled.includes('Market Example'))), false, 'stale confirmation must not overwrite external state');

    // Manual import uses the selected Release attachment and still follows preview/install checks.
    await page.unroute('https://api.github.com/repos/example/mod/releases?per_page=20');
    await page.route('https://api.github.com/repos/example/mod/releases?per_page=20', route => route.fulfill(jsonResponse(releases(good100, good200))));
    await page.unroute('https://github.com/example/mod/releases/download/v2.0.0/market-example-2.0.0.zip');
    await page.route('https://github.com/example/mod/releases/download/v2.0.0/market-example-2.0.0.zip', route => route.fulfill({ status: 200, contentType: 'application/zip', body: good200 }));
    await repo.getByRole('button', { name: '刷新版本', exact: true }).click();
    await repo.locator('select').first().selectOption('200');
    const manualChooser = page.waitForEvent('filechooser');
    await repo.getByRole('button', { name: '导入此附件', exact: true }).click();
    await (await manualChooser).setFiles({ name: 'market-example-2.0.0.zip', mimeType: 'application/zip', buffer: good200 });
    await ui.locator('.next-confirm').waitFor();
    await ui.locator('.next-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await page.waitForFunction(async () => (await DMCStorage.create().catalog(await DMCStorage.create().read())).items.some(item => item.name === 'Market Example' && item.version === '2.0.0'));
    const manualRecovery = await page.evaluate(async () => DMCStorage.create().readRecovery());
    assert.ok(manualRecovery, 'manual import must create recovery point');
    await page.evaluate(async recovery => DMCStorage.create().dismissRecovery(recovery.id), manualRecovery);
    const beforeBadManual = await page.evaluate(async () => (await DMCStorage.create().read()).packages.slice());
    const badChooser = page.waitForEvent('filechooser');
    await repo.getByRole('button', { name: '导入此附件', exact: true }).click();
    await (await badChooser).setFiles({ name: 'wrong-size.zip', mimeType: 'application/zip', buffer: Buffer.concat([good100, Buffer.from([0])]) });
    await ui.locator('.next-notice.failure').waitFor();
    assert.match(await ui.locator('.next-notice.failure').textContent(), /大小一致/);
    assert.deepEqual(await page.evaluate(async () => (await DMCStorage.create().read()).packages), beforeBadManual, 'manual size rejection must not mutate packages');

    const digestReleases = releases(good100, good200);
    digestReleases[1].assets[0].digest = 'sha256:' + '0'.repeat(64);
    await page.unroute('https://api.github.com/repos/example/mod/releases?per_page=20');
    await page.route('https://api.github.com/repos/example/mod/releases?per_page=20', route => route.fulfill(jsonResponse(digestReleases)));
    await repo.getByRole('button', { name: '刷新版本', exact: true }).click();
    await repo.locator('select').first().selectOption('200');
    const beforeBadDigest = await page.evaluate(async () => (await DMCStorage.create().read()).packages.slice());
    const digestChooser = page.waitForEvent('filechooser');
    await repo.getByRole('button', { name: '导入此附件', exact: true }).click();
    await (await digestChooser).setFiles({ name: 'market-example-2.0.0.zip', mimeType: 'application/zip', buffer: good200 });
    await page.waitForFunction(() => document.querySelector('.next-notice.failure')?.textContent.includes('SHA-256'));
    assert.deepEqual(await page.evaluate(async () => (await DMCStorage.create().read()).packages), beforeBadDigest, 'manual digest rejection must not mutate packages');

    // Cordova external-link behavior is tested with a bridge stub; removing the bridge leaves the UI usable.
    await page.evaluate(() => { window.__openCalls = []; window.cordova = { InAppBrowser: { open: (...args) => window.__openCalls.push(args) } }; });
    const releaseLink = repo.getByRole('link', { name: /发布说明/ });
    await releaseLink.click();
    assert.deepEqual(await page.evaluate(() => window.__openCalls), [['https://github.com/example/mod/releases/tag/v2.0.0', '_system']]);
    await page.evaluate(() => { window.cordova = {}; });
    await releaseLink.click();
    await reloadedExternalAddress(page, 'https://github.com/example/mod/releases/tag/v2.0.0');
    await page.evaluate(() => { window.cordova = undefined; });
    await releaseLink.dispatchEvent('click');
    assert.equal(await page.locator('.dmc-next').isVisible(), true, 'removing Cordova bridge must not break the market UI');

    // A same-repository package with a different boot name must be rejected before storage mutation.
    await page.unroute('https://api.github.com/repos/example/mod/releases?per_page=20');
    await page.route('https://api.github.com/repos/example/mod/releases?per_page=20', route => route.fulfill(jsonResponse(releases(good100, wrong))));
    await page.unroute('https://github.com/example/mod/releases/download/v2.0.0/market-example-2.0.0.zip');
    await page.route('https://github.com/example/mod/releases/download/v2.0.0/market-example-2.0.0.zip', route => route.fulfill({ status: 200, contentType: 'application/zip', body: wrong }));
    await repo.getByRole('button', { name: '刷新版本', exact: true }).click();
    await repo.locator('select').first().selectOption('200');
    await repo.getByRole('button', { name: '下载并预检', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.next-notice.failure')?.textContent.includes('包内模组名称与仓库关联不符'));
    assert.match(await ui.locator('.next-notice.failure').textContent(), /包内模组名称与仓库关联不符/);
    const afterWrong = await page.evaluate(async () => ({ state: await DMCStorage.create().read(), source: JSON.parse(localStorage.getItem('dmc.market.sources.v1')) }));
    assert.ok(afterWrong.state.packages.includes('Market Example'));
    assert.equal(afterWrong.state.packages.includes('Other Example'), true);
    assert.equal(afterWrong.source.repositories[0].modName, 'Market Example');

    // Existing subscriptions survive a failed refresh.
    await page.route('https://api.github.com/repos/example/mod/releases?per_page=20', route => route.fulfill(jsonResponse({ message: 'rate limited' }, 403)));
    await repo.getByRole('button', { name: '刷新版本', exact: true }).click();
    await ui.locator('.next-error').waitFor();
    assert.match(await ui.locator('.next-error').textContent(), /限流/);
    assert.equal(await page.locator("article[data-repository='example/mod']").count(), 1);
    // Destroy and re-inject the shell: persisted source metadata is read back without a fetch.
    const requestsBeforeReinject = githubRequests.length;
    await page.evaluate(() => DoLModCenter.destroy());
    await page.addScriptTag({ path: path.join(root, 'dist/ui.js') });
    await page.locator('#dmc-sidebar-button').waitFor();
    await page.locator('#dmc-sidebar-button').click();
    const reloadedUi = page.locator('.dmc-next');
    await reloadedUi.getByRole('button', { name: /模组市场/ }).click();
    await reloadedUi.locator("article[data-repository='example/mod']").waitFor();
    assert.match(await reloadedUi.locator("article[data-repository='example/mod']").textContent(), /关联模组：Market Example/);
    assert.equal(githubRequests.length, requestsBeforeReinject, 're-injecting UI must not auto-fetch');
    const repoAfterReinject = reloadedUi.locator("article[data-repository='example/mod']");
    // Capture the populated success view after testing error states; no DOM is hidden for screenshots.
    await page.unroute('https://api.github.com/repos/example/mod/releases?per_page=20');
    await page.route('https://api.github.com/repos/example/mod/releases?per_page=20', route => route.fulfill(jsonResponse(releases(good100, good200))));
    await repoAfterReinject.getByRole('button', { name: '刷新版本', exact: true }).click();
    await repoAfterReinject.locator('select').first().selectOption('200');
    await repoAfterReinject.getByRole('button', { name: '下载并预检', exact: true }).waitFor();
    assert.equal(await reloadedUi.locator('.next-notice.failure,.next-market .next-error').count(),0);
    for (const [view,width,height] of [['tablet',1704,1136],['phone',390,844]]) {
      await page.setViewportSize({width,height});
      const metrics=await reloadedUi.locator('.next-scroll').evaluate(e=>({scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));
      assert.ok(metrics.scrollWidth<=metrics.clientWidth+2,view+' market view has no horizontal overflow');
      await page.screenshot({path:path.join(screenshots,'market-'+view+'.png'),fullPage:true});
      if(view==='phone') {
        await repoAfterReinject.getByRole('button',{name:'导入此附件',exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(screenshots,'market-phone-actions.png'),fullPage:true});
      }
    }
    await repoAfterReinject.getByRole('button', { name: '移除订阅', exact: true }).click();
    assert.equal(await reloadedUi.locator("article[data-repository='example/mod']").count(), 0);
    assert.ok((await page.evaluate(async () => (await DMCStorage.create().read()).packages.includes('Market Example'))), 'removing source must not uninstall package');
    assert.deepEqual(consoleErrors, []);
    console.log('PASS market UI: no auto-fetch, release/ZIP filtering, source persistence, cancelled download+preview, native install/update+recovery, export bytes, stale confirmation guard, source-name guard, 403 retention, destroy/reinject, remove-without-uninstall, phone/tablet screenshots');
    await page.evaluate(() => { DoLModCenter.destroy(); __fixture.cleanup(); });
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
