'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'demo.html')).href);
    await page.waitForFunction(() => window.__fixtureReady);

    await page.evaluate(async () => {
      await __fixture.seed([
        ['enabled-custom', JSON.stringify(['A', 'B'])],
        ['disabled-custom', JSON.stringify(['C'])],
        ['fixture-package:A', __fixture.pack('A', '2.0.0')],
        ['fixture-package:B', __fixture.pack('B', '1.0.0')],
        ['fixture-package:C', __fixture.pack('C', '1.0.0')]
      ]);
      window.__loaded = [
        { name: 'A', version: '1.0.0', bootJson: { name: 'A', version: '1.0.0' } },
        { name: 'BuiltIn', version: '2.0.0', bootJson: { name: 'BuiltIn', version: '2.0.0' } }
      ];
    });
    await page.locator('#dmc-sidebar-button').click();
    await page.waitForFunction(() => document.querySelector('.dmc-status').textContent.includes('就绪'));

    const card = name => page.locator('.dmc-mod-list .dmc-card[data-mod-name="' + name + '"]');
    const cards = () => page.locator('.dmc-mod-list .dmc-card[data-mod-name]');
    const confirm = () => page.locator('.dmc-inline-confirm').getByRole('button', { name: '确认', exact: true }).click();
    const body = name => card(name).innerText();

    // Stored A (v2) and runtime A (v1) share one card with independent badges.
    assert.equal(await cards().count(), 4);
    assert.equal(await card('A').count(), 1);
    assert.match(await body('A'), /已启用/);
    assert.match(await body('A'), /已挂载/);
    assert.match(await body('A'), /本地 2\.0\.0 \/ 已挂载 1\.0\.0/);
    assert.match(await body('C'), /已禁用/);
    assert.doesNotMatch(await body('C'), /已挂载|已启用/);
    assert.match(await body('B'), /已启用/);
    assert.match(await body('B'), /未挂载/);
    assert.match(await body('BuiltIn'), /已挂载/);
    assert.doesNotMatch(await body('BuiltIn'), /已启用|已禁用/);
    assert.equal(await card('BuiltIn').getByRole('button', { name: '删除', exact: true }).count(), 0);
    assert.equal(await card('BuiltIn').getByRole('button', { name: '启用', exact: true }).count(), 0);

    // A can be disabled while its current runtime mount remains visible on one card.
    await card('A').getByRole('button', { name: '禁用', exact: true }).click();
    await confirm();
    await page.waitForFunction(() => document.querySelector('.dmc-status').textContent.includes('禁用'));
    assert.equal(await card('A').count(), 1);
    assert.match(await body('A'), /已禁用/);
    assert.match(await body('A'), /已挂载/);
    assert.doesNotMatch(await body('A'), /已启用/);

    // Removing the stored package leaves the runtime-only mount readonly.
    await card('A').getByRole('button', { name: '删除', exact: true }).click();
    await confirm();
    await page.waitForFunction(() => document.querySelector('.dmc-status').textContent.includes('已删除'));
    assert.equal(await card('A').count(), 1);
    assert.match(await body('A'), /非本地配置 · 只读/);
    assert.match(await body('A'), /已挂载/);
    assert.equal(await card('A').getByRole('button', { name: '删除', exact: true }).count(), 0);

    // Detail switching must expose runtime v1 after starting from the stored v2 card.
    await page.evaluate(async () => {
      await __fixture.seed([['fixture-package:A', __fixture.pack('A', '2.0.0')], ['disabled-custom', JSON.stringify(['A'])]]);
    });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.waitForFunction(() => {
      const c = document.querySelector('.dmc-mod-list .dmc-card[data-mod-name="A"]');
      return c && c.dataset.loaded === 'false' && c.textContent.includes('2.0.0');
    });
    await card('A').getByRole('button', { name: '详情', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dmc-details')?.textContent.includes('2.0.0'));
    assert.match(await page.locator('.dmc-content').innerText(), /本地存储包资料/);
    await page.getByRole('button', { name: '查看本次挂载资料', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dmc-details')?.textContent.includes('1.0.0'));
    assert.match(await page.locator('.dmc-content').innerText(), /当前运行包资料/);
    await page.getByRole('button', { name: '返回模组列表', exact: true }).click();

    // Empty state and read errors never claim a false enabled package.
    await page.evaluate(async () => {
      await __fixture.seed([
        ['enabled-custom', JSON.stringify([])], ['disabled-custom', JSON.stringify([])],
        ['fixture-package:A', undefined], ['fixture-package:B', undefined], ['fixture-package:C', undefined]
      ]);
      window.__loaded = [];
    });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dmc-mod-list')?.textContent.includes('没有匹配的模组'));
    assert.equal(await page.locator('.dmc-state-enabled').count(), 0);

    await page.evaluate(() => {
      __fixture.loader.customStore = () => { throw Error('synthetic read error'); };
      window.__loaded = [{ name: 'BuiltIn', version: '2.0.0', bootJson: { name: 'BuiltIn', version: '2.0.0' } }];
    });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dmc-status').textContent.includes('无法读取'));
    assert.equal(await page.locator('.dmc-state-enabled').count(), 0);
    assert.equal(await page.locator('.dmc-state[data-state="enabled"]').count(), 0);
    assert.equal(await page.locator('.dmc-mod-list .dmc-card[data-mod-name="BuiltIn"]').getByRole('button', { name: '删除', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS unified package cards, independent configured/mounted badges, runtime-only protection, detail version switch, empty/read-error no false enabled claims');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
