const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '../src');
const compile = (file, localRequire) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  const module = {exports: {}};
  const requireFn = (id) => id === './market' ? localRequire : require(id);
  new Function('require', 'module', 'exports', js)(requireFn, module, module.exports);
  return module.exports;
};
const market = compile('market.ts', null);
const batch = compile('market-batch.ts', market);

const source = (key) => ({key, owner: key.split('/')[0], repo: key.split('/')[1], url: `https://github.com/${key}`});
const selection = (key, id = 1, size = 3) => {
  const s = source(key);
  const asset = {id, name: `${key.replace('/', '-')}.zip`, size, url: `https://github.com/${key}/releases/download/v1/${id}.zip`};
  const release = {id, name: 'v1', tag: 'v1', url: `https://github.com/${key}/releases/tag/v1`, prerelease: false, publishedAt: '2026-01-01T00:00:00Z', assets: [asset]};
  return {source: s, release, asset};
};

assert.throws(() => batch.snapshotMarketSelections([]), /1 到 30/);
assert.throws(() => batch.snapshotMarketSelections([selection('a/a'), selection('a/a', 2)]), /重复仓库/);
const duplicateAsset=selection('b/b');duplicateAsset.asset.url=selection('a/a').asset.url;
assert.throws(() => batch.snapshotMarketSelections([selection('a/a'),duplicateAsset]), /重复附件/);
assert.throws(() => batch.snapshotMarketSelections([selection('a/a', 1, 100 * 1024 * 1024), selection('b/b', 2, 100 * 1024 * 1024), selection('c/c', 3, 100 * 1024 * 1024)]), /总大小/);

let calls = [];
const original = [selection('a/a'), selection('b/b', 2, 2)];
const progress = [];
const run = async () => {
const result = await batch.downloadMarketBatch(original, {onProgress: (...args) => progress.push(args)}, async (repo, asset, options) => {
  calls.push(repo.key);
  options.onProgress?.(asset.size, asset.size);
  return new Uint8Array(asset.size);
});
assert.deepEqual(calls, ['a/a', 'b/b']);
assert.deepEqual(result.inputs.map(bytes => bytes.byteLength), [3, 2]);
assert.deepEqual(result.selections.map(item => item.source.key), ['a/a', 'b/b']);
assert.ok(progress.length >= 2);

original[0].source.owner = 'changed';
original[0].asset.name = 'changed.zip';
assert.equal(result.selections[0].source.owner, 'a');
assert.notEqual(result.selections[0].asset.name, 'changed.zip');

let failedCalls = 0;
await assert.rejects(() => batch.downloadMarketBatch([selection('a/a'), selection('b/b', 2),selection('c/c',3)], {}, async (_repo,asset) => {
  failedCalls += 1;
  if(failedCalls===2)throw new Error('second failed');
  return new Uint8Array(asset.size);
}), /second failed/);
assert.equal(failedCalls, 2);

const mutable=[selection('a/a'),selection('b/b',2)];let receivedName='';
await batch.downloadMarketBatch(mutable,{},async (repo,asset)=>{
  if(repo.key==='a/a'){mutable[1].asset.name='changed.zip';mutable[1].source.modName='wrong'}
  else {receivedName=asset.name;assert.equal(repo.modName,undefined)}
  return new Uint8Array(asset.size);
});
assert.equal(receivedName,'b-b.zip','selection is snapshotted before the first await');

const controller = new AbortController();
let cancelCalls = 0;
await assert.rejects(() => batch.downloadMarketBatch([selection('a/a'), selection('b/b', 2)], {signal: controller.signal}, async (_repo, asset, options) => {
  cancelCalls += 1;
  controller.abort();
  options.onProgress?.(asset.size, asset.size);
  return new Uint8Array(asset.size);
}), /aborted/);
assert.equal(cancelCalls, 1);
console.log('market-batch: passed');
};
run().catch(error => { console.error(error); process.exitCode = 1; });
