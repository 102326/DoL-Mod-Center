const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const storagePath = path.join(root, 'mods/mod-center-v1/src/storage.js');
const dbName = 'dmc-two-page-cas-test';
const storeName = 'keyval';
const prefix = 'DMC-Test-';
const storageSource = fs.readFileSync(storagePath, 'utf8');

function pageSetup() {
  return `
    window.__dmcTestDb = ${JSON.stringify(dbName)};
    window.__dmcOpen = function(mode) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(window.__dmcTestDb);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => request.result.createObjectStore(${JSON.stringify(storeName)});
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(${JSON.stringify(storeName)}, mode);
          const store = tx.objectStore(${JSON.stringify(storeName)});
          resolve({db, tx, store});
        };
      });
    };
    window.__dmcStore = (mode, callback) => window.__dmcOpen(mode).then(({db, tx, store}) => {
      let value;
      try { value = callback(store); } catch (error) { try { tx.abort(); } catch (_) {} db.close(); throw error; }
      return Promise.resolve(value).finally(() => db.close());
    });
    window.__dmcSeed = async function() {
      const {db, tx, store} = await window.__dmcOpen('readwrite');
      store.put(JSON.stringify(['Existing']), 'enabled');
      store.put(JSON.stringify([]), 'disabled');
      store.put(new Uint8Array([69, 120, 105, 115, 116, 105, 110, 103]), ${JSON.stringify(prefix + 'Existing')});
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('seed aborted')); });
      db.close();
    };
    window.modUtils = {
      version: '2.101.1',
      getModLoader: () => window.__dmcLoader,
      getModListNameNoAlias: () => ['Existing'],
      getAnyModByNameNoAlias: () => undefined
    };
    window.__dmcLoader = {
      customStore: window.__dmcStore,
      getIndexDBLoader: () => window.__dmcLoader
    };
    window.__dmcLoader.constructor = {
      calcModNameKey: name => ${JSON.stringify(prefix)} + name,
      modDataIndexDBZipList: 'enabled',
      modDataIndexDBZipListHidden: 'disabled'
    };
    window.modModLoadController = {
      checkModZipFileIndexDB: async bytes => JSON.parse(new TextDecoder().decode(bytes))
    };
  `;
}

function inputBytes(name, version) {
  return Uint8Array.from(Buffer.from(JSON.stringify({name, version}), 'utf8'));
}

async function readEvidence(page) {
  return page.evaluate(async () => {
    const storage = window.DMCStorage.create();
    const state = await storage.read();
    const recovery = await storage.readRecovery();
    const bytes = {};
    for (const name of state.packages) bytes[name] = Array.from(await storage.exportZip(name));
    if (recovery) delete recovery.pendingRestart;
    return {packages: state.packages, enabled: state.enabled, disabled: state.disabled, bytes, recovery};
  });
}

(async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end('<!doctype html><meta charset="utf-8"><title>DoL Mod Center storage test</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let browser;
  try {
    browser = await chromium.launch({headless: true, channel: 'msedge'});
    const context = await browser.newContext();
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    for (const page of pages) {
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.addScriptTag({content: pageSetup()});
      await page.addScriptTag({content: storageSource});
      await page.evaluate(() => { window.__dmcStorage = window.DMCStorage.create(); });
    }
    await pages[0].evaluate(() => window.__dmcSeed());
    const [first, second] = pages;
    const [snapshotA, snapshotB] = await Promise.all(pages.map(page => page.evaluate(async () => {
      return window.__dmcStorage.read();
    })));
    assert.equal(snapshotA.writable, true);
    assert.equal(snapshotA.revision, snapshotB.revision, 'both pages must prepare from one revision');

    await Promise.all(pages.map((page, index) => page.evaluate(async ({snapshot, name}) => {
      window.__dmcToken = await window.__dmcStorage.prepareInstallBatch(snapshot, [new Uint8Array(JSON.parse(name))]);
    }, {snapshot: index === 0 ? snapshotA : snapshotB, name: JSON.stringify(Array.from(inputBytes('Added', index === 0 ? '1.0.0' : '2.0.0')))})));

    await first.evaluate(() => window.__dmcStorage.installBatch(window.__dmcToken));
    const committed = await readEvidence(first);
    assert.deepEqual(committed.packages, ['Added', 'Existing']);
    assert.deepEqual(committed.enabled, ['Existing', 'Added']);
    assert.deepEqual(committed.disabled, []);
    assert.deepEqual(committed.bytes.Added, Array.from(inputBytes('Added', '1.0.0')));
    assert.ok(committed.recovery, 'first commit must leave a recovery point');

    await assert.rejects(
      second.evaluate(() => window.__dmcStorage.installBatch(window.__dmcToken)),
      /确认期间配置或包体已变化，请重新导入/,
      'second page must reject its stale prepared token'
    );
    const afterReject = await readEvidence(second);
    assert.deepEqual(afterReject, committed, 'stale rejection must not change packages, lists, or recovery');

    const third = await context.newPage();
    await third.goto(`http://127.0.0.1:${port}/`);
    await third.addScriptTag({content: pageSetup()});
    await third.addScriptTag({content: storageSource});
    await third.evaluate(() => { window.__dmcStorage = window.DMCStorage.create(); });
    assert.deepEqual(await readEvidence(third), committed, 'a fresh page must observe the committed durable state');
    await context.close();
    console.log('PASS two-page stale install token rejected; packages, lists, recovery, and third-page persistence verified');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
