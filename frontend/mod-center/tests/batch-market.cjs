const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const fixture = path.resolve(root, '../../mods/mod-center-v1/tests/native-loader.fixture.js');
const demo = path.join(__dirname, 'demo.html');
const artifacts = path.join(__dirname, 'artifacts', 'batch-market');
assert.ok(fs.existsSync(fixture), `native fixture missing: ${fixture}`);

const json = (body, status = 200) => ({status, contentType: 'application/json', body: JSON.stringify(body)});
async function zip(name, version) {
  const z = new JSZip();
  z.file('boot.json', JSON.stringify({name, version, scriptFileList: [], styleFileList: [], tweeFileList: [], imgFileList: [], additionFile: ['README.md']}));
  z.file('README.md', `# ${name}\n\n${version}`);
  return Buffer.from(await z.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
}
function release(owner, repo, id, bytes, name, tag = 'v1.0.0') {
  return [{id, name: `${name} ${tag}`, tag_name: tag, html_url: `https://github.com/${owner}/${repo}/releases/tag/${tag}`, published_at: '2026-09-01T00:00:00Z', prerelease: false, draft: false, assets: [{id: id * 10, name: `${repo}-${tag}.zip`, size: bytes.length, browser_download_url: `https://github.com/${owner}/${repo}/releases/download/${tag}/${repo}-${tag}.zip`}]}];
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  const context = await browser.newContext({viewport: {width: 1704, height: 1136}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const alpha = await zip('Batch Alpha', '1.0.0');
    const beta = await zip('Batch Beta', '1.0.0');
    const bad = await zip('Unexpected Package', '9.9.9');
    const invalid = Buffer.from('this is not a ZIP archive');
    const routes = [
      ['alpha', 'Batch Alpha', alpha],
      ['beta', 'Batch Beta', beta],
      ['broken', 'Unexpected Package', bad]
    ];
    for (const [repo, name, bytes] of routes) {
      await page.route(`https://api.github.com/repos/example/${repo}/releases?per_page=20`, r => r.fulfill(json(release('example', repo, repo === 'alpha' ? 1 : repo === 'beta' ? 2 : 3, bytes, name))));
      await page.route(`https://github.com/example/${repo}/releases/download/v1.0.0/${repo}-v1.0.0.zip`, r => r.fulfill({status: 200, contentType: 'application/zip', body: bytes}));
    }
    await page.route('https://api.github.com/repos/example/conflict/releases?per_page=20', r => r.fulfill(json(release('example', 'conflict', 4, invalid, 'Conflict Target'))));
    await page.route('https://github.com/example/conflict/releases/download/v1.0.0/conflict-v1.0.0.zip', r => r.fulfill({status: 200, contentType: 'application/zip', body: invalid}));
    await page.goto(pathToFileURL(demo).href);
    await page.waitForFunction(() => window.__fixtureReady);
    await page.evaluate(() => {
      window.nativeTestName = 'DMC_BATCH_' + crypto.randomUUID();
      window.modLoaderKeyConfigWinHookFunction = config => {
        config.config.set('ModLoader_IndexDBLoader', nativeTestName);
        config.config.set('keyval', nativeTestName);
        config.config.set('modDataIndexDBZipList', 'batch-enabled');
        config.config.set('modDataIndexDBZipListHidden', 'batch-disabled');
        config.config.set('modDataIndexDBZipPrefix', 'batch-package');
      };
    });
    await page.addScriptTag({path: fixture});
    await page.addStyleTag({path: path.join(root, 'dist/ui.css')});
    await page.addScriptTag({path: path.join(root, 'dist/ui.js')});
    await page.locator('#dmc-sidebar-button').click();
    const ui = page.locator('.dmc-next');
    await ui.getByRole('button', {name: /模组市场/}).click();

    async function add(repo) {
      await page.locator('#dmc-market-address').fill(`https://github.com/example/${repo}`);
      await ui.getByRole('button', {name: '添加仓库', exact: true}).click();
      await ui.locator(`article[data-repository='example/${repo}']`).waitFor();
    }
    await add('alpha');
    await add('beta');
    const alphaCard = ui.locator("article[data-repository='example/alpha']");
    const betaCard = ui.locator("article[data-repository='example/beta']");
    await alphaCard.getByRole('checkbox').check();
    await betaCard.getByRole('checkbox').check();
    const queue = ui.locator('.market-batch-summary');
    await queue.waitFor();
    assert.match(await queue.textContent(), /批量队列：2 个仓库/);
    assert.equal(await queue.locator('li').count(), 2);

    const emptyState = await page.evaluate(async () => ({state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery()}));
    await queue.getByRole('button', {name: '下载并预检所选', exact: true}).click();
    const plan = ui.locator('.next-confirm');
    await plan.waitFor();
    assert.match(await plan.textContent(), /Batch Alpha/);
    assert.match(await plan.textContent(), /Batch Beta/);
    fs.mkdirSync(artifacts, {recursive: true});
    for (const [view, width, height] of [['tablet-plan', 1704, 1136], ['phone-plan', 390, 844]]) {
      await page.setViewportSize({width, height});
      const metrics = await ui.locator('.next-scroll').evaluate(e => ({scrollWidth: e.scrollWidth, clientWidth: e.clientWidth}));
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 2, `${view} has no horizontal overflow`);
      await plan.getByRole('button', {name: '取消', exact: true}).scrollIntoViewIfNeeded();
      assert.equal(await plan.getByRole('button', {name: '取消', exact: true}).isVisible(), true, `${view} confirmation controls are reachable`);
      await page.screenshot({path: path.join(artifacts, `${view}-plan.png`), fullPage: true});
    }
    await page.setViewportSize({width: 1704, height: 1136});
    await plan.getByRole('button', {name: '取消', exact: true}).click();
    await page.waitForTimeout(50);
    const afterCancel = await page.evaluate(async () => ({state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery()}));
    assert.deepEqual(afterCancel, emptyState, 'cancelled batch must not write native state');
    assert.equal(await ui.locator('.market-batch-summary li').count(), 2, 'cancelled batch keeps its queue');

    await ui.locator('.market-batch-summary').getByRole('button', {name: '下载并预检所选', exact: true}).click();
    await ui.locator('.next-confirm').getByRole('button', {name: '确认', exact: true}).click();
    await page.waitForFunction(async () => { const s = await DMCStorage.create().read(); return s.packages.includes('Batch Alpha') && s.packages.includes('Batch Beta'); });
    const committed = await page.evaluate(async () => ({state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery()}));
    assert.ok(committed.recovery, 'batch commit creates one recovery point');
    assert.equal(await ui.locator('.market-batch-summary').count(), 0, 'committed selections are consumed');
    assert.deepEqual(committed.state.packages.sort(), ['Batch Alpha', 'Batch Beta']);
    await page.evaluate(async () => { const r = await DMCStorage.create().readRecovery(); if (r) await DMCStorage.create().dismissRecovery(r.id); });

    // Association failure is a committed install with a repairable pending binding.
    await add('broken');
    const brokenCard = ui.locator("article[data-repository='example/broken']");
    await page.evaluate(() => { const original = Storage.prototype.setItem; let fail = true; Storage.prototype.setItem = function(key, value) { if (fail && key === 'dmc.market.sources.v1') throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value); }; window.__failSourceBinding = value => { fail = value; }; });
    await brokenCard.getByRole('checkbox').check();
    await ui.locator('.market-batch-summary').getByRole('button', {name: '下载并预检所选', exact: true}).click();
    await ui.locator('.next-confirm').getByRole('button', {name: '确认', exact: true}).click();
    await ui.locator('.next-notice.failure').waitFor();
    assert.match(await ui.locator('.next-market').textContent(), /仓库关联未保存/);
    assert.ok((await page.evaluate(async () => (await DMCStorage.create().read()).packages)).includes('Unexpected Package'));
    await page.evaluate(() => window.__failSourceBinding(false));
    await brokenCard.getByRole('button', {name: '重试关联', exact: true}).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('dmc.market.sources.v1')).repositories.some(s => s.key === 'example/broken' && s.modName === 'Unexpected Package'));
    await page.evaluate(async () => { const r = await DMCStorage.create().readRecovery(); if (r) await DMCStorage.create().dismissRecovery(r.id); });

    // A malformed second attachment fails before commit and keeps the selected queue.
    await add('conflict');
    const alphaAgain = ui.locator("article[data-repository='example/alpha']");
    const conflictCard = ui.locator("article[data-repository='example/conflict']");
    await alphaAgain.getByRole('checkbox').check();
    await conflictCard.getByRole('checkbox').check();
    const beforeBad = await page.evaluate(async () => ({state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery()}));
    await ui.locator('.market-batch-summary').getByRole('button', {name: '下载并预检所选', exact: true}).click();
    await ui.locator('.next-notice.failure').waitFor();
    assert.match(await ui.locator('.next-notice.failure').textContent(), /ZIP|压缩|有效|格式|central directory/);
    assert.deepEqual(await page.evaluate(async () => ({state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery()})), beforeBad, 'bad attachment leaves native state and recovery unchanged');
    assert.equal(await ui.locator('.market-batch-summary li').count(), 2, 'failed preparation keeps both queued selections');

    for (const [view, width, height] of [['tablet', 1704, 1136], ['phone', 390, 844]]) {
      await page.setViewportSize({width, height});
      const metrics = await ui.locator('.next-scroll').evaluate(e => ({scrollWidth: e.scrollWidth, clientWidth: e.clientWidth}));
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 2, `${view} market view has no horizontal overflow`);
      fs.mkdirSync(artifacts, {recursive: true});
      await page.screenshot({path: path.join(artifacts, `${view}.png`), fullPage: true});
    }
    assert.deepEqual(errors, []);
    console.log('PASS batch market UI: two-repository queue, preview, cancel/no-write, one-commit install+recovery, source binding repair, malformed batch no-write+queue retention, phone/tablet screenshots');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
