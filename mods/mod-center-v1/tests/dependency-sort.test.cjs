const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'dependency-sort.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window });
const plan = window.DMCSort.plan;
const mod = (name, deps = [], beauty = false, alias) => ({ name, beauty, bootJson: { dependenceInfo: deps, ...(alias ? { alias } : {}) } });
const dep = (modName, version = '') => ({ modName, version });
const names = x => Array.from(x.order);

assert.deepEqual(names(plan([mod('B', [dep('A')]), mod('A')])), ['A', 'B']);
assert.deepEqual(names(plan([mod('A'), mod('B'), mod('C')])), ['A', 'B', 'C']);
assert.deepEqual(names(plan([mod('A', [], true), mod('B')])), ['B', 'A']);
assert.deepEqual(names(plan([mod('A', [dep('B')], true), mod('B')])), ['B', 'A']);
assert.deepEqual(names(plan([mod('A', [dep('B')], true), mod('B', [dep('C')], true), mod('C')])), ['C', 'B', 'A']);

for (const result of [
  plan([mod('A', [dep('B')]), mod('B', [dep('A')])]),
  plan([mod('A', [dep('Missing')])]),
  plan([mod('A', [dep('Missing')])], { disabled: ['Missing'] }),
  plan([mod('A', [dep('x')]), mod('B', [], false, ['x']), mod('C', [], false, ['x'])]),
  plan([mod('A', [dep('A')])]),
  plan([mod('A', [{}])]),
  plan([mod('A'), mod('A')])
]) {
  assert.ok(result.errors.length);
  assert.equal(result.changed, false);
}
assert.deepEqual(names(plan([mod('A', [dep('x')]), mod('B', [], false, ['x'])])), ['B', 'A']);
assert.deepEqual(names(plan([mod('A', [dep('x')])], { external: [mod('x')] })), ['A']);
const replaced = plan([mod('A', [dep('x')])], { external: [mod('x')], disabled: ['x'] });
assert.ok(replaced.errors.length);
const pseudo = plan([mod('A', [dep('ModLoader', '>=2') , dep('GameVersion', 'anything')])], { loaderVersion: '2.101.1', checkVersion: (actual, required) => actual === '2.101.1' && required === '>=2' });
assert.equal(pseudo.errors.length, 0);
assert.ok(pseudo.warnings.some(x => x.includes('GameVersion')));
assert.ok(plan([mod('A', [dep('ModLoader', 'x')])]).warnings.some(x => x.includes('无法校验')));
assert.ok(plan([mod('A', [dep('ModLoader', 'x')])], { checkVersion: () => false }).errors.length);
const internalVersion = plan([mod('A', [dep('B', '2')]), { name: 'B', bootJson: { version: '1', dependenceInfo: [] } }], { checkVersion: (actual, required) => actual === '1' && required === '2' });
assert.equal(internalVersion.errors.length, 0);
assert.ok(plan([mod('A', [dep('B', '2')]), { name: 'B', bootJson: { version: '1', dependenceInfo: [] } }], { checkVersion: () => false }).errors.some(x => x.includes('要求：2')));
const externalVersion = plan([mod('A', [dep('B', '2')])], { external: [{ name: 'B', bootJson: { version: '2', dependenceInfo: [] } }], checkVersion: (actual, required) => actual === required });
assert.equal(externalVersion.errors.length, 0);
assert.ok(plan([mod('A', [dep('B', '2')])], { external: [{ name: 'B', bootJson: { version: '1', dependenceInfo: [] } }], checkVersion: () => undefined }).warnings.some(x => x.includes('未校验')));
assert.ok(plan([mod('A', [dep('stale', '1')]), mod('B', [], false, ['stale'])], { external: [{ name: 'stale', bootJson: { version: '1', alias: ['stale'], dependenceInfo: [] } }], checkVersion: () => true }).errors.length === 0);
assert.deepEqual(plan([{ name: 'A', bootJson: [] }]).order, ['A']);
const original = [mod('A', [dep('B')]), mod('B')];
const before = JSON.stringify(original);
plan(original);
assert.equal(JSON.stringify(original), before);
console.log('dependency-sort tests passed');
