const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const transpile = (file) => ts.transpileModule(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const market = transpile('market.ts');
const wiki = transpile('wiki-source.ts').replace(/require\("\.\/market"\)/g, '__market');
const bundle = `(function(){window.__market={};(function(require,module,exports){${market}})(function(){}, {exports:window.__market}, window.__market);const __market=window.__market;const out={};(function(require,module,exports){${wiki}})(function(){return __market;}, {exports:out}, out);window.wiki=out;})();`;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addScriptTag({ content: bundle });
  const html = `<h2>公开模组</h2><table><tr><th>简介</th><th>最后更新日期</th><th>模组名称</th><th>作者</th><th>兼容版本</th></tr><tr><td>说明</td><td>2026/9/27(v1.2)</td><td><a href="https://github.com/Acme/One/tree/main">第一模组</a> [Github]</td><td>作者甲</td><td>适配版本: 0.5.10</td></tr><tr><td>简介</td><td>未知</td><td><a href="https://github.com/acme/two">第二模组</a><a href="https://github.com/acme/shared/releases/tag/v1">下载</a></td><td>作者乙</td><td></td></tr><tr><td>说明</td><td></td><td>无仓库模组</td><td></td><td></td></tr></table><h3>私有模组</h3><table><tr><th>工具名称</th><th>简介</th></tr><tr><td><a href="https://github.com/tools/x">工具</a></td><td>工具</td></tr></table><table><tr><th>模组名称</th><th>简介</th></tr><tr><td><a href="https://github.com/Acme/One/issues/1">恶意入口</a></td><td><img src="https://invalid.test/no.png"><script>window.bad=1</script></td></tr></table>`;
  const parsed = await page.evaluate((input) => window.wiki.parseWikiHtml(input), html);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].repositories[0].key, 'acme/one');
  assert.equal(parsed[0].author, '作者甲'); assert.equal(parsed[0].wikiVersion, 'v1.2'); assert.equal(parsed[0].compatibilityNotes, '适配版本: 0.5.10');
  assert.equal(parsed[1].repositories.length, 2);
  assert.equal(parsed[2].repositories.length, 0);
  const metadata = await page.evaluate(() => window.wiki.parseWikiHtml(`<table><tr><th>模组名称</th><th>模组简介</th><th>备注</th><th>模组作者</th><th>最后更新日期</th></tr>
    <tr><td>有版本</td><td>${'一般介绍'.repeat(100)}<br>目前未适配游戏最新版本 0.5.10.12</td><td>要求游戏版本 &gt;= 0.5.10.12</td><td>-Alice</td><td>2025/8/16(v1.6.5-beta.1)</td></tr>
    <tr><td>无版本</td><td>支持新功能，修复 1.2.3 问题</td><td></td><td>身份未知</td><td>要求游戏版本 v0.5.10.12</td></tr>
    <tr><td>缺失</td><td></td><td></td><td>—</td><td>未知</td></tr></table>`));
  assert.equal(metadata[0].wikiVersion, 'v1.6.5-beta.1');
  assert.equal(metadata[0].wikiUpdatedAt, '2025/8/16');
  assert.equal(metadata[0].author, '-Alice');
  assert.match(metadata[0].compatibilityNotes, /未适配游戏最新版本/);
  assert.match(metadata[0].compatibilityNotes, /要求游戏版本 >=/);
  assert.equal(metadata[1].wikiVersion, undefined);
  assert.equal(metadata[1].author, '身份未知');
  assert.equal(metadata[2].author, undefined);
  assert.equal(metadata[2].wikiUpdatedAt, undefined);
  const dashRepo = await page.evaluate(() => window.wiki.parseWikiHtml('<table><tr><th>模组名称</th></tr><tr><td><a href="https://github.com/dawalizhang/-/releases/tag/mod">牧场</a></td></tr></table>')[0].repositories[0].key);
  assert.equal(dashRepo, 'dawalizhang/-');
  assert.equal(await page.evaluate(() => window.bad), undefined);
  await page.evaluate(() => { window.fetch = async () => new Response(JSON.stringify({ parse: { title: '模组列表', revid: 12, text: { '*': '<h2>公开模组</h2><table><tr><th>模组名称</th></tr><tr><td>缓存模组</td></tr></table>' } } }), { headers: { 'content-type': 'application/json' } }); });
  const catalog = await page.evaluate(() => window.wiki.fetchWikiCatalog({ fetcher: window.fetch }));
  assert.equal(catalog.revision, 12);
  assert.equal(await page.evaluate(value => window.wiki.wikiCacheNeedsRefresh(value), catalog), false, 'fresh catalog with legitimately absent metadata does not need migration');
  await page.evaluate((value) => { window.testStore = { value, getItem() { return this.value; }, setItem(_key, next) { this.value = next; } }; }, JSON.stringify(catalog));
  assert.equal((await page.evaluate(() => window.wiki.loadWikiCache(window.testStore))).entries.length, 1);
  const oldCache = { ...catalog, entries: catalog.entries.map(({ author, wikiUpdatedAt, wikiVersion, compatibilityNotes, ...entry }) => entry) };
  delete oldCache.metadataVersion;
  assert.equal(await page.evaluate(value => window.wiki.wikiCacheNeedsRefresh(value), oldCache), true);
  assert.equal((await page.evaluate((value) => { window.oldStore = { value: JSON.stringify(value), getItem() { return this.value; } }; return window.wiki.loadWikiCache(window.oldStore); }, oldCache)).entries[0].name, '缓存模组');
  await page.evaluate((value) => window.wiki.saveWikiCache(value, window.testStore), catalog);
  const withMetadata = {...catalog, entries: metadata};
  const roundtrip = await page.evaluate(value => {window.wiki.saveWikiCache(value, window.testStore);return window.wiki.loadWikiCache(window.testStore);}, withMetadata);
  assert.deepEqual(roundtrip.entries, metadata);
  assert.equal(roundtrip.metadataVersion, catalog.metadataVersion);
  await assert.rejects(() => page.evaluate(value => window.wiki.saveWikiCache(value, window.testStore), {...catalog, metadataVersion: -1}), /元数据版本/);
  await page.evaluate(() => { window.testStore.value = '{broken'; });
  await assert.rejects(() => page.evaluate(() => window.wiki.loadWikiCache(window.testStore)), /损坏/);
  const invalid = { ...catalog, entries: [{ ...catalog.entries[0], author: 'x'.repeat(161) }] };
  await assert.rejects(() => page.evaluate((value) => window.wiki.saveWikiCache(value, window.testStore), invalid), /元数据/);
  await page.evaluate(() => { window.fetch = async () => new Response(JSON.stringify({ parse: { title: '模组列表', revid: 13, text: { '*': '<p>变化</p>' } } })); });
  let structureFailed = false;
  try { await page.evaluate(() => window.wiki.fetchWikiCatalog({ fetcher: window.fetch })); } catch { structureFailed = true; }
  assert.equal(structureFailed, true);
  const boundaries = await page.evaluate(async (catalog) => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    let preCancelled = false;
    try { await window.wiki.fetchWikiCatalog({ signal: controller.signal, fetcher: async () => { calls++; return new Response(''); } }); } catch (e) { preCancelled = /取消/.test(e.message); }
    let cancelled = false, oversized = false;
    try { await window.wiki.fetchWikiCatalog({ fetcher: async () => new Response(new ReadableStream({start(c) { c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; }})) }); } catch (e) { oversized = /过大/.test(e.message); }
    let quota = false;
    try { window.wiki.saveWikiCache(catalog, {setItem() { throw new DOMException('quota', 'QuotaExceededError'); }}); } catch (e) { quota = e.name === 'QuotaExceededError'; }
    const latest = window.wiki.parseWikiHtml('<table><tr><th>模组名称</th></tr><tr><td><a href="https://github.com/acme/one/releases/latest">最新</a></td></tr></table>')[0].repositories[0].key;
    return {calls, preCancelled, cancelled, oversized, quota, latest};
  }, catalog);
  assert.deepEqual(boundaries, {calls: 0, preCancelled: true, cancelled: true, oversized: true, quota: true, latest: 'acme/one'});
  console.log('wiki-source: passed');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
