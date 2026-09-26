const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ path: require('path').join(__dirname, '..', 'src', 'markdown.js') });
  const result = await page.evaluate(() => {
    const root = document.getElementById('root');
    const source = '# Title\n\n**bold** and *em* and `code`\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\n<em>literal</em>\n```\n\n[Docs](https://example.invalid) ![avatar](https://example.invalid/a.png)\n<script>window.__pwned = true</script>\n<<if $money>>';
    const output = DMCMarkdown.render(root, source);
    const originalText = root.textContent;
    const rows = root.querySelectorAll('table tr').length;
    const code = root.querySelector('pre code').textContent;
    const security = { pwned: window.__pwned === true, scripts: root.querySelectorAll('script').length, images: root.querySelectorAll('img').length, links: root.querySelectorAll('a').length, headings: root.querySelectorAll('h1').length };
    DMCMarkdown.render(root, 'intro\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    return { html: root.outerHTML, text: originalText, output, ...security, rows, precedingRows: root.querySelectorAll('table tr').length, paragraphs: root.querySelectorAll('p').length, code };
  });
  assert.strictEqual(result.pwned, false);
  assert.strictEqual(result.scripts, 0);
  assert.strictEqual(result.images, 0);
  assert.strictEqual(result.links, 0);
  assert.strictEqual(result.headings, 1);
  assert.strictEqual(result.rows, 2);
  assert.strictEqual(result.precedingRows, 2);
  assert.strictEqual(result.paragraphs, 1);
  assert.match(result.text, /literal/);
  assert.match(result.text, /\[图片: avatar\]/);
  assert.match(result.text, /<script>window\.__pwned = true<\/script>/);
  assert.match(result.text, /<<if \$money>>/);
  assert.match(result.text, /https:\/\/example\.invalid/);
  assert.strictEqual(result.code, '<em>literal</em>');
  assert.ok(result.output.nodes > 0);

  const bounded = await page.evaluate(() => {
    const root = document.getElementById('root');
    return DMCMarkdown.render(root, 'x'.repeat(256 * 1024 + 100));
  });
  assert.strictEqual(bounded.truncated, true);
  assert.ok(bounded.nodes <= 12000);

  const hostile = await page.evaluate(() => {
    const root = document.getElementById('root');
    const deep = `${'>'.repeat(10000)} unsafe`;
    const many = Array.from({ length: 14000 }, (_, i) => `- item ${i}`).join('\n');
    const deepResult = DMCMarkdown.render(root, deep);
    const deepText = root.textContent;
    const listResult = DMCMarkdown.render(root, many);
    return { deepResult, deepText, listResult, listText: root.textContent, notices: root.querySelectorAll('.dmc-md-truncated').length };
  });
  assert.strictEqual(hostile.deepResult.truncated, true);
  assert.match(hostile.deepText, /unsafe/);
  assert.strictEqual(hostile.listResult.truncated, true);
  assert.match(hostile.listText, /\[README 已截断\]/);
  assert.ok(hostile.listResult.nodes <= 12000);
  assert.strictEqual(hostile.notices, 1);
  console.log('markdown tests passed');
  } finally {
    if (browser) await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
