const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/local-library.ts'), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
const compiledModule = {exports: {}};
new Function('require', 'module', 'exports', js)(require, compiledModule, compiledModule.exports);
const library = compiledModule.exports;

const makeFile = (name, bytes = [1, 2, 3], modified = 1000) => new File([Uint8Array.from(bytes)], name, {lastModified: modified, type: 'application/zip'});
const entry = (id, file) => ({id, name: file.name, size: file.size, modified: file.lastModified, file});

const alpha = makeFile('Alpha.zip', [1, 2, 3], 1000);
const beta = makeFile('Beta.zip', [4, 5], 3000);
assert.deepEqual(library.validateFiles([entry('a', alpha), entry('b', beta)]).map(f => f.name), ['Alpha.zip', 'Beta.zip']);
assert.throws(() => library.validateFiles([entry('a', alpha), entry('a', beta)]), /资料无效/);
assert.throws(() => library.validateFiles([{...entry('a', alpha), size: 99}]), /资料无效/);
assert.throws(() => library.validateFiles([{...entry('a', alpha), file: makeFile('Other.zip', [1, 2, 3], 1000)}]), /资料无效/);
assert.throws(() => library.validateFiles([{...entry('a', alpha), name: 'Alpha.txt'}]), /资料无效/);
assert.throws(() => library.validateSelection([]), /至少选择/);
assert.throws(() => library.validateSelection(Array.from({length: 101}, (_, i) => entry(String(i), makeFile(`${i}.zip`)))), /100 个/);
const overLimit = Array.from({length: 100}, (_, i) => entry(String(i), makeFile(`${i}.zip`, new Uint8Array(2700000), i + 1)));
assert.throws(() => library.validateSelection(overLimit), /256 MiB/);

(async () => {
  const progress = [];
  const result = await library.readLibraryFiles([entry('a', alpha), entry('b', beta)], {progress: text => progress.push(text)});
  assert.deepEqual(result.map(bytes => Array.from(bytes)), [[1, 2, 3], [4, 5]]);
  assert.equal(progress.length, 2);

  const controller = new AbortController();
  const slow = makeFile('Slow.zip', [9], 5000);
  const originalArrayBuffer = slow.arrayBuffer.bind(slow);
  slow.arrayBuffer = async () => { await new Promise(resolve => setTimeout(resolve, 20)); return originalArrayBuffer(); };
  const pending = library.readLibraryFiles([entry('slow', slow)], {signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, /已取消读取/);

  assert.throws(() => library.validateFiles([{...entry('a', alpha), modified: alpha.lastModified + 1}]), /资料无效/);
  console.log('PASS pure-mod library protocol: real File metadata validation, dedup identity fields, 100/256MiB limits, multi-file read/progress, cancellation, no Cordova calls');
})().catch(error => { console.error(error); process.exitCode = 1; });
