'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/package-info.js'), 'utf8');
const context = {window: {}}; vm.runInNewContext(source, context, {filename: 'package-info.js'});
const api = context.window.DMCPackage;
assert.ok(api);
assert.deepEqual(JSON.parse(JSON.stringify(api.describe({imgFileList: ['a.png', 'a.png'], styleFileList: ['main.css']}))), {
  label: '图片包', beauty: true,
  groups: [
    {key: 'imgFileList', label: '图片', files: ['a.png'], count: 1},
    {key: 'styleFileList', label: '样式', files: ['main.css'], count: 1}
  ], declaredType: ''
});
assert.equal(api.describe({tweeFileList: ['story.twee']}).label, '文本内容包');
assert.equal(api.describe({imgFileList: ['a.png'], scriptFileList: ['boot.js'], tweeFileList: ['x.twee']}).label, '内容模组 · 含图片');
assert.equal(api.describe({imgFileList: ['a.png'], addonPlugin: [{addonName: 'UnknownAddon'}]}).beauty, false);
assert.equal(api.describe({imgFileList: ['a.png'], addonPlugin: [{addonName: 'ImageLoaderAddon'}]}).beauty, true);
assert.equal(api.describe({imgFileList: ['a.png'], additionFile: ['README.md', 'LICENSE', 'docs/CHANGELOG.txt']}).beauty, true);
assert.equal(api.describe({imgFileList: ['a.png'], additionFile: ['notes.txt']}).beauty, false);
assert.equal(api.describe({imgFileList: ['a.png'], scriptFileList: ['ok.js', 3]}).beauty, false);
const beauty = api.describe({addonPlugin: [{addonName: 'BeautySelectorAddon', params: {type: 'portrait', imgFileList: ['face.png']}}]});
assert.equal(beauty.label, '美化图包'); assert.equal(beauty.beauty, true);
assert.deepEqual(JSON.parse(JSON.stringify(beauty.groups.find(g => g.key === 'addonPlugin.params.imgFileList'))), {key: 'addonPlugin.params.imgFileList', label: '插件图片 · portrait', files: ['face.png'], count: 1});
assert.equal(api.describe({imgFileList: ['a.png'], type: 'x'.repeat(100)}).declaredType.length, 80);
const many = Array.from({length: 250}, (_, i) => 'img/' + i + '.png');
const bounded = api.describe({imgFileList: many});
assert.equal(bounded.groups[0].count, 250); assert.equal(bounded.groups[0].files.length, 200);
assert.equal(api.describe({imgFileList: ['../escape.png', '/root.png', '', 1]}).groups.length, 0);
console.log('PASS package classification, beauty heuristic, resource bounds and safe declarations');
