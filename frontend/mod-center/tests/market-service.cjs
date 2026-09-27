const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(require('node:path').join(__dirname, '../src/market.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const compiledModule = { exports: {} };
vm.runInNewContext(`(function(require,module,exports){${js}\n})(require,module,module.exports)`, { require, module: compiledModule, console, URL, URLSearchParams, TextEncoder, TextDecoder, ReadableStream, Headers, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout, atob, fetch: global.fetch, crypto: global.crypto });
const market = compiledModule.exports;
assert.equal(market.compatibilityNotes('模组版本 v1.2.3\n修复 0.5.1 缺陷'), undefined);
assert.equal(market.compatibilityNotes('- 游戏版本：`0.5.11.9`\n- ModLoader：2.31.2'), '游戏版本：0.5.11.9');
assert.equal(market.compatibilityNotes('目前未适配游戏最新版本 0.5.10.12'), '目前未适配游戏最新版本 0.5.10.12');
assert.equal(market.compatibilityNotes('x'.repeat(64001)), undefined);
assert.equal(market.compatibilityNotes('最新版本不适配现有版本秋枫框架，请等秋枫3.0更新之后再更新1.0.4版本面部扩展'), undefined);
assert.equal(market.displayMarketDate('nonsense'), '未知');

const repo = market.parseRepository('https://github.com/Acme/Mods.git/');
assert.equal(repo.key, 'acme/mods');
assert.throws(() => market.parseRepository('https://github.com/acme/mods/releases'), /HTTPS/);
assert.throws(() => market.parseRepository('https://evil.example/acme/mods'), /github/);
assert.throws(() => market.parseRepository('https://github.com/acme/mods?token=x'), /无效字符/);
assert.throws(() => market.parseRepository('https://github.com:443/acme/mods'), /HTTPS/);
assert.throws(() => market.parseRepository('https://github.com/acme/../mods'), /根地址/);

const store = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
market.saveSources([repo, { ...repo, url: repo.url, modName: '我的模组' }].slice(0, 1), store);
assert.equal(market.loadSources(store)[0].key, 'acme/mods');
store.value = '{bad';
assert.throws(() => market.loadSources(store), /损坏/);
store.value = JSON.stringify({ schemaVersion: 1, repositories: [{ key: 'acme/mods', url: repo.url }, { key: 'ACME/MODS', url: repo.url }] });
assert.throws(() => market.loadSources(store), /重复/);
assert.throws(() => market.saveSources([repo], { setItem() { throw new Error('quota'); } }), /quota/);

function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}
const releaseJson = [{ id: 1, name: 'v1', tag_name: 'v1.0', html_url: 'https://github.com/acme/mods/releases/tag/v1.0', prerelease: false, draft: false, published_at: '2026-09-27T00:00:00Z', assets: [{ id: 2, name: 'mod.zip', size: 4, browser_download_url: 'https://github.com/ACME/MODS/releases/download/v1.0/mod.zip', digest: null }, { id: 3, name: 'source.zip', size: 4, browser_download_url: 'https://github.com/Other/Mods/releases/download/v1.0/source.zip' }] }, { id: 4, name: 'beta', tag_name: 'v2.0-beta', html_url: 'https://github.com/acme/mods/releases/tag/v2', prerelease: true, draft: false, published_at: '2026-09-27T00:00:00Z', assets: [] }];
let lastRequest;
const fetcher = async (url, init) => { lastRequest = { url, init }; return response(JSON.stringify(releaseJson)); };
(async () => {
  const markdown='# 模组说明\n[作者](https://example.org)';
  const readmeJson={encoding:'base64',size:Buffer.byteLength(markdown),content:Buffer.from(markdown).toString('base64'),html_url:'https://github.com/acme/mods/blob/main/README.md'};
  let readmeRequest;
  const readme=await market.fetchReadme(repo,{fetcher:async(url,init)=>{readmeRequest={url,init};return response(JSON.stringify(readmeJson));}});
  assert.equal(readme.text,markdown);assert.equal(readmeRequest.url,'https://api.github.com/repos/Acme/Mods/readme');assert.equal(readmeRequest.init.credentials,'omit');
  await assert.rejects(()=>market.fetchReadme(repo,{fetcher:async()=>response('{}',404)}),/没有可读取/);
  await assert.rejects(()=>market.fetchReadme(repo,{fetcher:async()=>response(JSON.stringify({...readmeJson,size:256*1024+1}))}),/256 KiB/);
  await assert.rejects(()=>market.fetchReadme(repo,{fetcher:async()=>response(JSON.stringify({...readmeJson,content:'!!!'}))}),/编码无效/);
  await assert.rejects(()=>market.fetchReadme(repo,{fetcher:async()=>response(JSON.stringify({...readmeJson,html_url:'https://github.com/other/repo/blob/main/README.md'}))}),/来源地址/);
  await assert.rejects(()=>market.fetchReadme(repo,{fetcher:async()=>response(JSON.stringify({...readmeJson,size:1}))}),/大小不符/);
  const cancelledReadme=new AbortController();cancelledReadme.abort();let readmeCalls=0;
  await assert.rejects(()=>market.fetchReadme(repo,{signal:cancelledReadme.signal,fetcher:async()=>{readmeCalls++;return response('{}')}}),/已取消/);assert.equal(readmeCalls,0);
  let readmeStreamCancelled=false;
  await assert.rejects(()=>market.fetchReadme(repo,{fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1024*1024+1));},cancel(){readmeStreamCancelled=true}}))}),/过大/);assert.equal(readmeStreamCancelled,true);
  const stable = await market.fetchReleases(repo, { fetcher });
  assert.equal(stable.length, 1);
  assert.equal(stable[0].assets.length, 1);
  const enriched = await market.fetchReleases(repo, {fetcher: async()=>response(JSON.stringify([{...releaseJson[0],updated_at:'2026-09-28T01:00:00Z',body:'- 游戏版本：`0.5.11.9`'}]))});
  assert.equal(enriched[0].compatibilityNotes, '游戏版本：0.5.11.9');
  assert.equal(enriched[0].updatedAt, '2026-09-28T01:00:00Z');
  assert.equal(lastRequest.init.credentials, 'omit');
  const all = await market.fetchReleases(repo, { fetcher, includePrereleases: true });
  assert.equal(all.length, 2);
  await assert.rejects(() => market.fetchReleases(repo, { fetcher: async () => response('{}', 403) }), /限流/);
  await assert.rejects(() => market.fetchReleases(repo, { fetcher: async () => response('{}', 404) }), /不存在/);
  await assert.rejects(() => market.fetchReleases(repo, { fetcher: async () => response('{}', 429) }), /限流/);
  await assert.rejects(() => market.fetchReleases(repo, { fetcher: async () => response(JSON.stringify([{ ...releaseJson[0], html_url: 'https://github.com/acme/mods/releases/tag/v1?x=1' }])) }), /不安全/);
  for (const html_url of ['javascript:alert(1)', 'https://user:secret@github.com/acme/mods/releases/tag/v1', 'https://github.com:444/acme/mods/releases/tag/v1', 'https://github.com/other/mods/releases/tag/v1']) {
    await assert.rejects(() => market.fetchReleases(repo, { fetcher: async () => response(JSON.stringify([{ ...releaseJson[0], html_url }])) }), /地址/);
  }
  let metadataCancelled = false;
  const hugeMetadata = new ReadableStream({start(c){c.enqueue(new Uint8Array(4*1024*1024+1));},cancel(){metadataCancelled=true;}});
  await assert.rejects(() => market.fetchReleases(repo, {fetcher:async()=>new Response(hugeMetadata)}), /过大/);
  assert.equal(metadataCancelled,true,'oversized metadata stops the stream');

  const bytes = new Uint8Array([80, 75, 3, 4]);
  const asset = stable[0].assets[0];
  const good = { ...asset, digest: `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')}` };
  let progress = 0;
  const downloaded = await market.downloadAsset(repo, good, { fetcher: async () => response(bytes, 200, { 'content-length': '4' }), onProgress: (n) => { progress = n; } });
  assert.deepEqual([...downloaded], [...bytes]); assert.equal(progress, 4);
  await market.verifyAssetBytes(good,bytes);
  await assert.rejects(()=>market.verifyAssetBytes(good,new Uint8Array(3)),/大小/);
  await assert.rejects(()=>market.verifyAssetBytes(good,new Uint8Array(4)),/校验失败/);
  const noDigest = await market.downloadAsset(repo,asset,{fetcher:async()=>response(bytes)});
  assert.deepEqual([...noDigest],[...bytes],'legacy null digest permits normal download');
  await assert.rejects(() => market.downloadAsset(repo, { ...good, digest: 'sha256:' + '0'.repeat(64) }, { fetcher: async () => response(bytes, 200, { 'content-length': '4' }) }), /校验失败/);
  await assert.rejects(() => market.downloadAsset(repo, { ...asset, size: 5 }, { fetcher: async () => response(bytes, 200, { 'content-length': '4' }) }), /大小/);
  let cancelled = false;
  const oversizeBody = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); }, cancel() { cancelled = true; } });
  await assert.rejects(() => market.downloadAsset(repo, { ...asset, size: 1, digest: undefined }, { fetcher: async () => ({ ok: true, status: 200, headers: new Headers(), body: oversizeBody }) }), /超过限制/);
  assert.equal(cancelled, true);
  const during = new AbortController();let streamCancelled=false;
  const partial=new ReadableStream({start(c){c.enqueue(bytes.slice(0,2));},cancel(){streamCancelled=true;}});
  await assert.rejects(()=>market.downloadAsset(repo,asset,{signal:during.signal,fetcher:async()=>new Response(partial),onProgress:()=>during.abort()}),/AbortError/);
  assert.equal(streamCancelled,true,'cancel after progress closes unfinished stream');
  const controller = new AbortController(); controller.abort();
  let requested=false;
  await assert.rejects(()=>market.downloadAsset(repo,asset,{signal:controller.signal,fetcher:async()=>{requested=true;return response(bytes)}}),/AbortError/);
  assert.equal(requested,false,'pre-cancelled download does not send a request');
  // Advance only the download timeout, without waiting two minutes in a test.
  const timedModule={exports:{}};
  vm.runInNewContext(`(function(require,module,exports){${js}\n})(require,module,module.exports)`,{require,module:timedModule,console,URL,TextEncoder,TextDecoder,ReadableStream,Headers,AbortController,AbortSignal,DOMException,crypto:global.crypto,fetch:global.fetch,setTimeout:(fn,ms)=>{assert.equal(ms,120000);queueMicrotask(fn);return -1;},clearTimeout:()=>{}});
  await assert.rejects(()=>timedModule.exports.downloadAsset(repo,asset,{fetcher:async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))}),/120 秒/);
  await assert.rejects(() => market.downloadAsset(repo, { ...asset, digest: undefined }, { signal: controller.signal, fetcher: async (_url, init) => { if (init.signal.aborted) throw new DOMException('aborted', 'AbortError'); return response(bytes); } }), /AbortError/);
  console.log('market-service: passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
