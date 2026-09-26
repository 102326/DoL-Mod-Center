/* Synthetic data and a dedicated test-only IndexedDB. Never opens the game's database. */
(async function () {
  const dbName = 'DMC_TEST_' + crypto.randomUUID();
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('fixture');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  class TestLoader {
    static modDataIndexDBZipList = 'enabled-custom';
    static modDataIndexDBZipListHidden = 'disabled-custom';
    static modDataIndexDBZipPrefix = 'fixture-package';
    static calcModNameKey(name) { return this.modDataIndexDBZipPrefix + ':' + name; }
    customStore(mode, callback) {
      const tx = database.transaction('fixture', mode), store = tx.objectStore('fixture');
      if (window.__failWrite && mode === 'readwrite') {
        let count = 0;
        return callback(new Proxy(store, {get(target, prop) {
          if (prop === 'put') return (...args) => { if (++count === 2) throw Error('synthetic partial write'); return target.put(...args); };
          const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
        }}));
      }
      return callback(store);
    }
  }
  const loader = new TestLoader();
  const pack = (name, version='1.0.0') => new TextEncoder().encode(JSON.stringify({name,version,dependenceInfo:[]}));
  async function seed(entries) {
    return loader.customStore('readwrite', store => new Promise((resolve,reject) => {
      entries.forEach(([key,value]) => value===undefined ? store.delete(key) : store.put(value,key));
      store.transaction.oncomplete=resolve;store.transaction.onabort=()=>reject(store.transaction.error);
    }));
  }
  await seed([['enabled-custom',JSON.stringify(['A','B'])],['disabled-custom',JSON.stringify(['C'])],
    ['fixture-package:A',pack('A')],['fixture-package:B',pack('B')],['fixture-package:C',pack('C')]]);
  window.__loaded = [{name:'A',version:'1.0.0',bootJson:{name:'A',version:'1.0.0'}},
    {name:'BuiltIn',version:'2.0.0',bootJson:{name:'BuiltIn',version:'2.0.0'}}];
  window.modUtils = {version:'2.101.1',getModLoader:()=>({getIndexDBLoader:()=>loader}),
    getModListNameNoAlias:()=>__loaded.map(x=>x.name),getMod:n=>__loaded.find(x=>x.name===n),getAnyModByNameNoAlias:n=>__loaded.find(x=>x.name===n)};
  window.modModLoadController = {async checkModZipFileIndexDB(bytes) {
    try {return JSON.parse(new TextDecoder().decode(bytes));} catch (_) {return 'Invalid fixture archive';}
  }};
  window.modLoaderGui_LoadingProgress={getLoadLog:()=>['[00:00:00][logError] Synthetic fixture error']};
  window.__fixture = {loader,seed,pack,dbName, async cleanup(){database.close();indexedDB.deleteDatabase(dbName);}};
  window.__fixtureReady=true;
})();
