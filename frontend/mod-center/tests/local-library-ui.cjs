const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const fixture = path.resolve(root, '../../mods/mod-center-v1/tests/native-loader.fixture.js');
const demo = path.join(__dirname, 'demo.html');
const artifacts = path.join(__dirname, 'artifacts', 'local-library');
async function packageBytes(name, deps = []) {
  const zip = new JSZip();
  zip.file('boot.json', JSON.stringify({name, version: '1.0.0', dependenceInfo: deps, scriptFileList: [], styleFileList: [], tweeFileList: [], imgFileList: [], additionFile: ['README.md']}));
  zip.file('README.md', `# ${name}`);
  return Buffer.from(await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  try {
  const page = await browser.newPage({viewport: {width: 1704, height: 1136}});
  const errors = [];
  const base = await packageBytes('Base');
  const addon = await packageBytes('Addon', [{modName: 'Base', version: '1.0.0'}]);
  const extra = await packageBytes('Extra');
  const tempFiles = path.join(artifacts, 'inputs');
  fs.mkdirSync(tempFiles, {recursive: true});
  const paths = {base: path.join(tempFiles, 'Base.zip'), addon: path.join(tempFiles, 'Addon.zip'), extra: path.join(tempFiles, 'Extra.zip')};
  fs.writeFileSync(paths.base, base); fs.writeFileSync(paths.addon, addon); fs.writeFileSync(paths.extra, extra);
  const fixedTime = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(paths.base, fixedTime, fixedTime); fs.utimesSync(paths.addon, fixedTime, fixedTime); fs.utimesSync(paths.extra, fixedTime, fixedTime);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(demo).href);
  await page.waitForFunction(() => window.__fixtureReady);
  await page.evaluate(() => {
    window.nativeTestName = 'DMC_PURE_LIBRARY_' + crypto.randomUUID();
    window.modLoaderKeyConfigWinHookFunction = config => {
      config.config.set('ModLoader_IndexDBLoader', nativeTestName);
      config.config.set('keyval', nativeTestName);
      config.config.set('modDataIndexDBZipList', 'pure-enabled');
      config.config.set('modDataIndexDBZipListHidden', 'pure-disabled');
      config.config.set('modDataIndexDBZipPrefix', 'pure-package');
    };
    let nativeCalls = 0;
    window.cordova = {exec() { nativeCalls++; throw new Error('pure-mod flow must not call native directory API'); }};
    window.__nativeCalls = () => nativeCalls;
  });
  await page.addScriptTag({path: fixture});
  await page.addStyleTag({path: path.join(root, 'dist/ui.css')});
  await page.addScriptTag({path: path.join(root, 'dist/ui.js')});
  await page.locator('#dmc-sidebar-button').click();
  const ui = page.locator('.dmc-next');
  await ui.getByRole('button', {name: '待导入列表', exact: true}).click();
  const library = ui.locator('.local-library');
  const input = library.locator('input[type=file]');
  const add = async (...files) => input.setInputFiles(files);

  await add(paths.addon);
  await page.waitForFunction(() => document.querySelector('.local-library')?.textContent.includes('列表 1 / 100 个'));
  await add(paths.base, paths.addon);
  assert.match(await library.textContent(), /列表 2 \/ 100 个/);
  assert.match(await library.textContent(), /已跳过 1 个/);
  assert.equal(await page.evaluate(() => window.__nativeCalls()), 0);

  await library.getByLabel('搜索待导入文件').fill('Base');
  assert.equal(await library.locator('li').count(), 1);
  await library.getByLabel('搜索待导入文件').fill('');
  await library.getByLabel('文件排序').selectOption('name');
  assert.match(await library.locator('li').first().textContent(), /Addon\.zip/);
  await library.getByLabel('文件排序').selectOption('size');
  assert.match(await library.locator('li').first().textContent(), addon.length > base.length ? /Addon\.zip/ : /Base\.zip/);
  await library.getByLabel('文件排序').selectOption('modified');
  assert.match(await library.locator('li').first().textContent(), /Addon\.zip/);

  await library.locator('li').filter({hasText: 'Base.zip'}).getByRole('checkbox').check();
  await library.locator('li').filter({hasText: 'Addon.zip'}).getByRole('checkbox').check();
  assert.equal(await library.getByRole('checkbox', {name: /预检时按前置依赖整理加载顺序/}).isChecked(), true);
  await library.getByRole('button', {name: '预检所选 ZIP', exact: true}).click();
  const firstPlan = ui.getByRole('alertdialog', {name: '确认配置修改'});
  await firstPlan.waitFor();
  assert.match(await firstPlan.textContent(), /Base/);
  assert.match(await firstPlan.textContent(), /Addon/);
  assert.equal(await firstPlan.locator('details[open]').count(), 0, 'plan details start collapsed');
  fs.mkdirSync(artifacts, {recursive: true});
  for (const [name, width, height] of [['tablet', 1704, 1136], ['phone', 390, 844]]) {
    await page.setViewportSize({width, height});
    assert.ok(await firstPlan.getByRole('button', {name: '确认', exact: true}).isVisible(), `${name} confirmation remains reachable`);
    await page.screenshot({path: path.join(artifacts, `${name}-plan.png`), fullPage: true});
  }
  await page.setViewportSize({width: 1704, height: 1136});
  await firstPlan.getByText(/查看调整后的加载顺序/).click();
  assert.deepEqual(await firstPlan.locator('ol li').allTextContents(), ['Base', 'Addon'], 'preview shows dependency order');
  await firstPlan.getByRole('button', {name: '取消', exact: true}).click();
  assert.deepEqual(await page.evaluate(async () => (await DMCStorage.create().read()).packages), []);

  // A late file chooser event while confirmation is open must not mutate the staged queue.
  await library.getByRole('button', {name: '预检所选 ZIP', exact: true}).click();
  await ui.getByRole('alertdialog', {name: '确认配置修改'}).waitFor();
  await add(paths.extra);
  assert.match(await library.textContent(), /列表 2 \/ 100 个/);
  await ui.getByRole('alertdialog', {name: '确认配置修改'}).getByRole('button', {name: '取消', exact: true}).click();

  await library.getByRole('button', {name: '预检所选 ZIP', exact: true}).click();
  await ui.getByRole('alertdialog', {name: '确认配置修改'}).getByRole('button', {name: '确认', exact: true}).click();
  await page.waitForFunction(async () => { const s = await DMCStorage.create().read(); return s.packages.includes('Base') && s.packages.includes('Addon'); });
  const state = await page.evaluate(async () => ({state: await DMCStorage.create().read(), recovery: await DMCStorage.create().readRecovery()}));
  assert.deepEqual(state.state.enabled.slice(-2), ['Base', 'Addon'], 'auto-sort places Base before Addon');
  assert.ok(state.recovery, 'confirmed pure-mod import creates recovery');
  assert.equal(await page.evaluate(() => window.__nativeCalls()), 0);

  fs.mkdirSync(artifacts, {recursive: true});
  for (const [name, width, height] of [['tablet', 1704, 1136], ['phone', 390, 844]]) {
    await page.setViewportSize({width, height});
    const metrics = await ui.locator('.next-scroll').evaluate(e => ({scrollWidth: e.scrollWidth, clientWidth: e.clientWidth}));
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 2, `${name} has no horizontal overflow`);
    await library.locator('li').first().scrollIntoViewIfNeeded();
    assert.equal(await library.locator('li').first().getByRole('checkbox').isVisible(), true, `${name} list is reachable`);
    await page.screenshot({path: path.join(artifacts, `${name}-list.png`), fullPage: true});
    const preflight = library.getByRole('button', {name: '预检所选 ZIP', exact: true});
    await preflight.scrollIntoViewIfNeeded();
    assert.equal(await preflight.isVisible(), true, `${name} preflight is reachable`);
    await page.screenshot({path: path.join(artifacts, `${name}-actions.png`), fullPage: true});
  }
  assert.deepEqual(errors, []);
  console.log('PASS pure-mod library UI: repeated staged file adds+dedup, search/name/time/size sort, dependency preview, cancel/no-write, late chooser guard, confirmed atomic install+recovery, no native calls, phone/tablet layout');
  await page.evaluate(() => DoLModCenter.destroy());
  } finally {
  await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
