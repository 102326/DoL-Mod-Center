const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = path.resolve(root, '../../mods/mod-center-v1/tests/native-loader.fixture.js');
const demo = path.join(__dirname, 'demo.html');
const wikiUrl = 'https://degreesoflewditycn.miraheze.org/w/api.php?action=parse&page=%E6%A8%A1%E7%BB%84%E5%88%97%E8%A1%A8&prop=text%7Crevid&format=json&origin=*';
assert.ok(fs.existsSync(fixture), `native fixture missing: ${fixture}`);

function jsonResponse(body, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }
function wikiHtml() {
  const rows = [
    '<tr><td><a href="https://github.com/example/mod">Example One</a></td><td>简介含 <a href="https://github.com/other/unrelated">另一个链接</a>，不应识别</td><td>Alice</td><td>2026/9/1</td><td>v1.2</td><td>游戏版本：0.5.11.9；不支持旧版存档</td></tr>',
    '<tr><td><a href="https://github.com/example/mod">Example Two</a></td><td>同一仓库的第二条目录项</td><td>Bob</td><td>2026-09-02</td><td>v1.1</td><td>游戏版本：0.5.11</td></tr>',
    '<tr><td>No Repository</td><td>没有公开仓库</td><td>Carol</td><td>2026-09-03</td><td>v0.9</td><td>暂无适配说明</td></tr>',
    ...Array.from({ length: 21 }, (_, index) => `<tr><td>Catalog Entry ${index + 4}</td><td>测试目录条目</td><td>Author</td><td>2026-09-${String(index + 4).padStart(2, '0')}</td><td>v${index + 4}.0</td><td>游戏版本：${index<2?'0.5.11.9':'0.5.11'}</td></tr>`),
  ].join('');
  return `<h3>公开模组</h3><table><thead><tr><th>模组名称</th><th>模组简介</th><th>作者</th><th>最后更新日期</th><th>当前版本</th><th>游戏版本</th></tr></thead><tbody>${rows}</tbody></table><img src="https://cdn.invalid/wiki.png"><script src="https://cdn.invalid/wiki.js"></script>`;
}
function wikiPayload(html = wikiHtml(), revision = 16047) { return { parse: { title: '模组列表', revid: revision, text: { '*': html } } }; }
function releasePayload() { return [{ id: 11, name: 'Example Release', tag_name: 'v1.2.0', html_url: 'https://github.com/example/mod/releases/tag/v1.2.0', published_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z', body: '- 游戏版本：`0.5.11.9`\n- 不支持 DoL 0.5.10', prerelease: false, draft: false, assets: [] }]; }
function readmePayload(markdown = '# Example README\n\n<script>window.__readmeScript=1</script>\n\n![remote](https://cdn.invalid/readme.png)\n\n[外部链接](https://github.com/example/mod/issues)') {
  const content = Buffer.from(markdown, 'utf8');
  return { encoding: 'base64', content: content.toString('base64'), size: content.length, html_url: 'https://github.com/example/mod/blob/main/README.md' };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const contexts = [];
  const artifacts = path.join(__dirname, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1704, height: 1136 } });
    contexts.push(context);
    const page = await context.newPage();
    const wikiRequests = [], githubRequests = [], errors = [], remoteImages = [];
    page.on('request', request => {if(request.url().includes('cdn.invalid'))remoteImages.push(request.url())});
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url() === wikiUrl) wikiRequests.push(request.url()); if (request.url().startsWith('https://api.github.com/')) githubRequests.push(request.url()); });
    await page.route(wikiUrl, route => route.fulfill(jsonResponse(wikiPayload())));
    await page.route('https://api.github.com/repos/example/mod/releases?per_page=20', route => route.fulfill(jsonResponse(releasePayload())));
    await page.route('https://api.github.com/repos/example/mod/readme', route => route.fulfill(jsonResponse(readmePayload())));
    await page.goto(pathToFileURL(demo).href);
    await page.waitForFunction(() => window.__fixtureReady);
    await page.evaluate(() => {
      window.StartConfig = { version: '0.5.11.9' };
      window.nativeTestName = 'DMC_WIKI_' + crypto.randomUUID();
      window.modLoaderKeyConfigWinHookFunction = config => { config.config.set('ModLoader_IndexDBLoader', nativeTestName); config.config.set('keyval', nativeTestName); config.config.set('modDataIndexDBZipList', 'wiki-enabled'); config.config.set('modDataIndexDBZipListHidden', 'wiki-disabled'); config.config.set('modDataIndexDBZipPrefix', 'wiki-package'); };
    });
    await page.addScriptTag({ path: fixture });
    await page.addStyleTag({ path: path.join(root, 'dist/ui.css') });
    await page.addScriptTag({ path: path.join(root, 'dist/ui.js') });
    await page.locator('#dmc-sidebar-button').click();
    let ui = page.locator('.dmc-next');
    await ui.getByRole('button', { name: /模组市场/ }).click();
    const directory = ui.locator('.wiki-directory');
    assert.equal(wikiRequests.length, 0, 'opening market must not fetch Wiki');
    assert.equal(await directory.getByRole('button', { name: '刷新 Wiki 目录', exact: true }).count(), 1);

    await directory.getByRole('button', { name: '刷新 Wiki 目录', exact: true }).click();
    await directory.getByText(/修订 16047/).waitFor();
    assert.equal(wikiRequests.length, 1);
    assert.equal(await directory.locator('.wiki-entry').count(), 20);
    assert.equal(await directory.getByText('Example One', { exact: true }).count(), 1);
    assert.equal(await directory.getByText('No Repository', { exact: true }).count(), 1);
    assert.equal(await directory.getByRole('button', { name: '下一页', exact: true }).isEnabled(), true);
    await directory.getByRole('button', { name: '下一页', exact: true }).click();
    assert.equal(await directory.getByText('Example One', { exact: true }).count(), 0, 'pagination advances to a different page');
    await directory.getByRole('button', { name: '上一页', exact: true }).click();
    await directory.getByRole('searchbox', { name: '搜索 Wiki 目录' }).fill('Example Two');
    assert.equal(await directory.locator('.wiki-entry').count(), 1);
    assert.equal(await directory.getByText('Example Two', { exact: true }).count(), 1);
    await directory.getByRole('searchbox', { name: '搜索 Wiki 目录' }).fill('');

    const entriesBeforeOpen = await directory.locator('.wiki-entry').evaluateAll(nodes => nodes.map(node => node.querySelector('.wiki-badge')?.textContent?.trim() || ''));
    const rank = text => text.includes('不符') ? 2 : text.includes('当前版本') ? 0 : text.includes('未知') ? 1 : 9;
    assert.ok(entriesBeforeOpen.every((value, index) => index === 0 || rank(value) >= rank(entriesBeforeOpen[index - 1])), 'Wiki entries are sorted by compatibility rank');
    assert.deepEqual(await directory.locator('.wiki-entry-heading strong').evaluateAll(nodes=>nodes.slice(0,2).map(node=>node.textContent)),['Catalog Entry 5','Catalog Entry 4'],'supported entries are first and ordered newest date first');
    assert.equal(await directory.getByRole('button', { name: /查询发布信息|刷新发布信息/ }).count(), 0, 'release query buttons are absent before expansion');
    const exampleOne = directory.locator('.wiki-entry').filter({ hasText: 'Example One' });
    const toggle = exampleOne.locator('button.wiki-entry-toggle');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    const beforeInspect = githubRequests.length;
    await toggle.click();
    await exampleOne.locator('.wiki-detail').waitFor();
    await page.waitForFunction(() => document.querySelector('.wiki-release-info') || document.querySelector('.wiki-directory .next-error'));
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(githubRequests.length, beforeInspect + 2, 'expanding one entry requests only its release and README');
    assert.equal(await exampleOne.getByText('Alice', { exact: true }).count(), 1);
    assert.match(await exampleOne.textContent(), /2026[/-]0?9[/-]0?1/);
    assert.equal(await exampleOne.getByText('v1.2', { exact: true }).count(), 1);
    assert.match(await exampleOne.textContent(), /不支持旧版存档/);
    const releaseInfo = exampleOne.locator('.wiki-release-info');
    assert.equal(await releaseInfo.getByText('v1.2.0', { exact: false }).count(), 1);
    assert.match(await releaseInfo.locator('dl > div').filter({ hasText: '发布时间' }).locator('dd').innerText(), /2026[/-]0?9[/-]0?1/);
    assert.match(await releaseInfo.locator('dl > div').filter({ hasText: '发布记录更新' }).locator('dd').innerText(), /2026[/-]0?9[/-]0?2/);
    assert.match(await releaseInfo.locator('.wiki-compatibility').innerText(), /不支持 DoL 0\.5\.10/);
    assert.equal(await exampleOne.locator('.dmc-repository-readme').count(), 1, 'README is rendered');
    assert.match(await exampleOne.locator('.dmc-repository-readme').innerText(), /Example README/);
    assert.equal(await exampleOne.locator('.dmc-repository-readme script').count(), 0, 'README script is not rendered');
    assert.equal(await page.evaluate(()=>window.__readmeScript),undefined);
    assert.equal(await exampleOne.locator('.dmc-repository-readme img').count(),0);
    assert.equal(await exampleOne.locator('.dmc-md-image-load').count(),1);
    assert.deepEqual(remoteImages,[], 'Wiki and README images are not fetched automatically');
    await page.evaluate(()=>{window.__readmeExternal=[];window.cordova={InAppBrowser:{open:(...args)=>window.__readmeExternal.push(args)}}});
    await exampleOne.getByRole('link',{name:'外部链接',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__readmeExternal),[['https://github.com/example/mod/issues','_system']]);
    await page.evaluate(()=>{window.cordova={}});
    await exampleOne.getByRole('link',{name:'查看 GitHub README',exact:true}).click();
    assert.equal(await exampleOne.getByRole('textbox',{name:'可复制的 README 地址'}).inputValue(),'https://github.com/example/mod/blob/main/README.md');
    await page.evaluate(()=>{window.cordova=undefined});
    assert.equal(githubRequests.some(url => url.includes('other/unrelated')), false, 'description GitHub link is not queried');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('dmc.market.sources.v1'))), null, 'inspection does not add a subscription');
    assert.equal(await exampleOne.getByRole('button', { name: /查询发布信息|刷新发布信息/ }).count(), 0, 'release query buttons remain absent after expansion');
    assert.equal(await exampleOne.getByText(/多个目录条目/).count(), 1, 'shared repository warning is visible');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('.wiki-entry-toggle')?.getAttribute('aria-expanded') === 'false');
    const beforeCachedInspect = githubRequests.length;
    await toggle.click();
    await exampleOne.locator('.dmc-repository-readme').waitFor();
    assert.equal(githubRequests.length, beforeCachedInspect, 'reopening uses session results without duplicate requests');
    await exampleOne.getByRole('button', { name: '加入并查询发布', exact: true }).click();
    await ui.locator("article[data-repository='example/mod']").waitFor();
    assert.equal(githubRequests.length, beforeCachedInspect + 1, 'subscribing queries only the selected repository release');
    assert.equal(await exampleOne.getByRole('button', { name: '已在我的仓库', exact: true }).count(), 1);
    const second = directory.locator('.wiki-entry').filter({ hasText: 'Example Two' });
    assert.equal(await second.getByRole('button', { name: '已在我的仓库', exact: true }).count(), 0, 'collapsed shared entry has no duplicate subscription control');
    assert.equal(await directory.locator('.wiki-entry').filter({ hasText: 'No Repository' }).count(), 1, 'no-repository entry remains visible');
    assert.equal(await directory.getByRole('button', { name: /查询发布信息|刷新发布信息/ }).count(), 0);
    await toggle.click();
    for (const item of [[1363, 1136, 'wiki-tablet'], [390, 844, 'wiki-phone']]) {
      const width = item[0], height = item[1], prefix = item[2];
      await page.setViewportSize({ width, height });
      await directory.locator('summary').scrollIntoViewIfNeeded();
      await directory.getByText('Example One', { exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await directory.locator('summary').isVisible(), true, prefix + ' screenshot shows directory title');
      assert.ok(await directory.evaluate(element => element.scrollWidth <= element.clientWidth + 2), prefix + ' list has no horizontal overflow');
      await page.screenshot({ path: path.join(artifacts, prefix + '.png'), fullPage: true });
      await toggle.click();
      await exampleOne.locator('.wiki-detail').waitFor();
      await exampleOne.locator('.dmc-repository-readme').waitFor();
      assert.ok(await directory.evaluate(element => element.scrollWidth <= element.clientWidth + 2), prefix + ' expanded has no horizontal overflow');
      await page.screenshot({ path: path.join(artifacts, prefix + '-expanded.png'), fullPage: true });
      await exampleOne.locator('.dmc-repository-readme').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,prefix+'-readme.png')});
      await toggle.click();
    }
    await page.setViewportSize({ width: 1704, height: 1136 });

    // Legacy cache stays usable offline, but visibly prompts a metadata refresh.
    await page.evaluate(() => {
      const key = 'dmc.market.wiki.v1', value = JSON.parse(localStorage.getItem(key));
      delete value.metadataVersion;
      value.entries = value.entries.map(({author, wikiUpdatedAt, wikiVersion, compatibilityNotes, ...entry}) => entry);
      localStorage.setItem(key, JSON.stringify(value));
    });
    const requestsBeforeReload = wikiRequests.length;
    await page.evaluate(() => DoLModCenter.destroy());
    await page.unroute(wikiUrl);
    await page.route(wikiUrl, route => route.abort());
    await page.addScriptTag({ path: path.join(root, 'dist/ui.js') });
    await page.locator('#dmc-sidebar-button').waitFor();
    await page.locator('#dmc-sidebar-button').click();
    ui = page.locator('.dmc-next');
    await ui.getByRole('button', { name: /模组市场/ }).click();
    const cachedDirectory = ui.locator('.wiki-directory');
    await cachedDirectory.getByText(/修订 16047/).waitFor();
    assert.equal(wikiRequests.length, requestsBeforeReload, 'valid Wiki cache avoids reload fetch');
    assert.equal(await ui.locator("article[data-repository='example/mod']").count(), 1, 'source subscription survives reload');
    await cachedDirectory.locator('.wiki-cache-warning').waitFor();
    await page.unroute(wikiUrl);
    await page.route(wikiUrl, route => route.fulfill(jsonResponse(wikiPayload())));
    await cachedDirectory.getByRole('button', {name: '刷新 Wiki 目录', exact: true}).click();
    await cachedDirectory.locator('.wiki-cache-warning').waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dmc.market.wiki.v1')).entries[0].author), 'Alice');
    assert.equal(wikiRequests.length, requestsBeforeReload + 1, 'legacy migration fetches only on refresh');

    // Closing a detail cancels the request and discards its eventual result.
    await page.unroute('https://api.github.com/repos/example/mod/readme');
    await page.route('https://api.github.com/repos/example/mod/readme',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill(jsonResponse(readmePayload())).catch(()=>{})});
    const abortEntry=cachedDirectory.locator('.wiki-entry').filter({hasText:'Example One'});
    await abortEntry.locator('.wiki-entry-toggle').click();
    await abortEntry.getByText('正在读取发布信息与 README…').waitFor();
    await abortEntry.locator('.wiki-entry-toggle').click();
    await page.waitForTimeout(650);
    assert.equal(await abortEntry.locator('.wiki-detail').count(),0);
    assert.equal(await cachedDirectory.locator('.dmc-repository-readme').count(),0);
    // README failure keeps release information and retries after collapse/reopen.
    await page.unroute('https://api.github.com/repos/example/mod/readme');
    await page.route('https://api.github.com/repos/example/mod/readme', route => route.fulfill(jsonResponse({ message: 'missing' }, 404)));
    const cachedExample = cachedDirectory.locator('.wiki-entry').filter({ hasText: 'Example One' });
    const cachedToggle = cachedExample.locator('button.wiki-entry-toggle');
    await cachedToggle.click();
    await cachedExample.locator('.wiki-release-info').waitFor();
    await cachedExample.locator('.next-error').first().waitFor();
    assert.equal(await cachedExample.locator('.wiki-release-info').count(), 1, 'README 404 does not remove release result');
    await cachedToggle.click();
    await page.unroute('https://api.github.com/repos/example/mod/readme');
    await page.route('https://api.github.com/repos/example/mod/readme', route => route.fulfill(jsonResponse(readmePayload())));
    await cachedToggle.click();
    await cachedExample.locator('.dmc-repository-readme').waitFor();
    assert.equal(await cachedExample.locator('.dmc-repository-readme').count(), 1, 'README retry succeeds after collapse');
    await cachedToggle.click();


    // Invalid responses retain the old cache and source subscription.
    const replaceWiki = async (response) => { await page.unroute(wikiUrl); await page.route(wikiUrl, route => route.fulfill(response)); };
    await replaceWiki({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'forbidden' }) });
    await cachedDirectory.getByRole('button', { name: '刷新 Wiki 目录', exact: true }).click();
    await cachedDirectory.getByText(/Wiki 请求受到限制/).waitFor();
    assert.equal(await cachedDirectory.getByText(/修订 16047/).count(), 1);
    assert.equal(await ui.locator("article[data-repository='example/mod']").count(), 1);
    await replaceWiki({ status: 200, contentType: 'text/html', body: '<html>captcha</html>' });
    await cachedDirectory.getByRole('button', { name: '刷新 Wiki 目录', exact: true }).click();
    await cachedDirectory.getByText(/非 JSON 验证页/).waitFor();
    assert.equal(await cachedDirectory.getByText(/修订 16047/).count(), 1);
    await replaceWiki(jsonResponse({ parse: { title: 'wrong', revid: 16048, text: { '*': wikiHtml() } } }));
    await cachedDirectory.getByRole('button', { name: '刷新 Wiki 目录', exact: true }).click();
    await cachedDirectory.getByText(/结构发生变化/).waitFor();
    assert.equal(await cachedDirectory.getByText(/修订 16047/).count(), 1);

    // Leaving the market tab cancels an in-flight refresh and does not replace cache.
    await page.unroute(wikiUrl);
    await page.route(wikiUrl, async route => { await new Promise(resolve => setTimeout(resolve, 2000)); await route.fulfill(jsonResponse(wikiPayload(wikiHtml(), 16049))); });
    await cachedDirectory.getByRole('button', { name: '刷新 Wiki 目录', exact: true }).click();
    await cachedDirectory.getByRole('button', { name: '取消目录刷新', exact: true }).waitFor();
    await ui.getByRole('button', { name: /本地模组/ }).click();
    await page.waitForFunction(() => !document.querySelector('.wiki-directory [aria-label="取消目录刷新"]'));
    await ui.getByRole('button', { name: /模组市场/ }).click();
    assert.equal(await ui.locator('.wiki-directory').getByText(/修订 16047/).count(), 1, 'cancelled refresh retains cache');

    // Wiki external link follows the same Cordova system-browser/copy fallback contract.
    const wikiDirectory = ui.locator('.wiki-directory');
    await page.evaluate(() => { window.__wikiOpenCalls = []; window.cordova = { InAppBrowser: { open: (...args) => window.__wikiOpenCalls.push(args) } }; });
    await wikiDirectory.getByRole('link', { name: /查看 Wiki 原页/ }).click();
    assert.deepEqual(await page.evaluate(() => window.__wikiOpenCalls), [['https://degreesoflewditycn.miraheze.org/wiki/%E6%A8%A1%E7%BB%84%E5%88%97%E8%A1%A8', '_system']]);
    await page.evaluate(() => { window.cordova = {}; });
    await wikiDirectory.getByRole('link', { name: /查看 Wiki 原页/ }).click();
    await wikiDirectory.locator('input[aria-label="复制 Wiki 地址"]').waitFor();
    assert.equal(await wikiDirectory.locator('input[aria-label="复制 Wiki 地址"]').inputValue(), 'https://degreesoflewditycn.miraheze.org/wiki/%E6%A8%A1%E7%BB%84%E5%88%97%E8%A1%A8');
    await page.evaluate(() => { window.cordova = undefined; });
    assert.equal(await page.locator('.dmc-next').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS Wiki market: no auto-fetch, safe HTML extraction, pagination/search, selective subscribe, cache reload, invalid-response retention, cancel-on-tab-change, Cordova link fallback, tablet/phone screenshots');
    await page.evaluate(() => { DoLModCenter.destroy(); __fixture.cleanup(); });
  } finally { for (const context of contexts) await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
