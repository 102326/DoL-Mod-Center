/* Original DoLModCenter storage adapter. No ModHub implementation is used. */
(function (root) {
  'use strict';
  const LIMIT = 256 * 1024 * 1024;
  let activeWrites=0;
  const RECOVERY_KEY='DoLModCenter.recovery.v1';
  const SESSION=String(Date.now())+'-'+Math.random().toString(36).slice(2);
  function validName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 512 && !/[\x00-\x1f]/.test(name);
  }
  function parseList(value, label) {
    if (value === undefined) return [];
    let list;
    try { list = typeof value === 'string' ? JSON.parse(value) : null; } catch (_) {}
    if (!Array.isArray(list) || list.length > 2000 || !list.every(validName) || new Set(list).size !== list.length) {
      throw Error(label + '格式异常，已停止写入；请通过原加载器核对。');
    }
    return list;
  }
  function bytesOf(value) {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (typeof value === 'string') {
      if (value.length > LIMIT * 1.4) throw Error('包体超过 256 MiB 限制。');
      const decoded = root.atob(value);
      return Uint8Array.from(decoded, c => c.charCodeAt(0));
    }
    throw Error('存储包体缺失或格式不受支持。');
  }
  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function create(environment = root) {
    let busy = false;
    const prepared = new WeakMap();
    const restoreTokens = new WeakMap();
    const catalogTokens = new WeakMap();
    const batchTokens=new WeakMap(), recoveryTokens=new WeakMap(), metadataCache=new Map();
    function contract() {
      const manager = environment.modSC2DataManager;
      const utils = environment.modUtils || manager?.getModUtils?.();
      const controller = environment.modModLoadController || manager?.getModLoadController?.();
      const loader = utils?.getModLoader?.()?.getIndexDBLoader?.();
      const cls = loader?.constructor;
      if (typeof loader?.customStore !== 'function' || typeof cls?.calcModNameKey !== 'function' ||
          typeof cls.modDataIndexDBZipList !== 'string' || typeof cls.modDataIndexDBZipListHidden !== 'string' ||
          typeof controller?.checkModZipFileIndexDB !== 'function') {
        throw Error('当前加载器未提供已验证的存储接口；本地配置不可写，请使用原加载器。');
      }
      const enabledKey = cls.modDataIndexDBZipList, disabledKey = cls.modDataIndexDBZipListHidden;
      const prefix = cls.calcModNameKey('');
      if (!prefix || enabledKey === disabledKey || typeof prefix !== 'string' ||
          cls.calcModNameKey('DMC-Probe') !== prefix + 'DMC-Probe' ||
          enabledKey.startsWith(prefix) || disabledKey.startsWith(prefix) || RECOVERY_KEY.startsWith(prefix) || [enabledKey,disabledKey].includes(RECOVERY_KEY)) throw Error('加载器键名契约不受支持。');
      return {utils, controller, loader, enabledKey, disabledKey, prefix, key: name => cls.calcModNameKey(name)};
    }
    function cacheEntries(c) {
      try {
        const entries = c.utils.getModLoader?.()?.getModCacheOneArray?.();
        return Array.isArray(entries) ? entries : [];
      } catch (_) { return []; }
    }
    function loaded(c, entries = cacheEntries(c)) {
      try {
        const names = c.utils.getModListNameNoAlias();
        if (!Array.isArray(names)) return [];
        return names.slice(0, 2000).map(name => {
          const m = c.utils.getAnyModByNameNoAlias?.(name) || c.utils.getMod?.(name);
          const cached = entries.find(entry => entry?.name === name);
          return {name, version: String(m?.bootJson?.version ?? m?.version ?? ''), bootJson: m?.bootJson || {}, ...(cached && Object.prototype.hasOwnProperty.call(cached, 'from') ? {from: cached.from} : {})};
        });
      } catch (_) { return []; }
    }
    function decorateState(c, state) {
      const entries = cacheEntries(c), local = entries.filter(entry => entry?.from === 'Local' && validName(entry?.name) && entry?.mod?.bootJson && typeof entry.mod.bootJson === 'object' && !Array.isArray(entry.mod.bootJson));
      const preloaded = local.map(entry => ({name: entry.name, version: String(entry.mod.bootJson.version ?? ''), bootJson: entry.mod.bootJson, from: 'Local'}));
      const preloadedNames = new Set(preloaded.map(entry => entry.name));
      const storedNames = new Set(state.packages);
      const references = [...state.enabled, ...state.disabled].filter(name => !storedNames.has(name) && preloadedNames.has(name));
      return {...state,
        loaded: loaded(c, entries),
        preloaded,
        missing: [...state.enabled, ...state.disabled].filter(name => !storedNames.has(name) && !preloadedNames.has(name)),
        preloadedReferences: references};
    }
    // All requests and writes are scheduled in IDB callbacks. Never await ZIP parsing inside a transaction.
    function transaction(c, mode, name, operation) {
      return c.loader.customStore(mode, store => new Promise((resolve, reject) => {
        const tx = store.transaction;
        let result, failure, left = name === undefined ? 3 : 4;
        const values = {};
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || Error('存储事务未提交：' + (tx.error?.message || '操作已中止')));
        tx.onerror = () => { failure ||= Error('存储失败：' + (tx.error?.message || '未知错误')); };
        function abort(error) { failure = error; try { tx.abort(); } catch (_) { reject(error); } }
        function request(key, req) {
          req.onsuccess = () => {
            values[key] = req.result;
            if (--left !== 0) return;
            try {
              const enabled = parseList(values.enabled, '启用列表'), disabled = parseList(values.disabled, '禁用列表');
              if (enabled.some(n => disabled.includes(n))) throw Error('同一模组同时存在于启用和禁用列表，已停止写入。');
              const packages = values.keys.filter(k => typeof k === 'string' && k.startsWith(c.prefix)).map(k => k.slice(c.prefix.length)).sort();
              const revision = JSON.stringify([enabled, disabled, packages]);
              const state = {enabled, disabled, packages, revision,
                orphans: packages.filter(n => !enabled.includes(n) && !disabled.includes(n)),
                missing: [...enabled, ...disabled].filter(n => !packages.includes(n))};
              result = operation ? operation(store, state, values.package) : {...state, package: values.package};
            } catch (error) { abort(error); }
          };
        }
        try {
          request('enabled', store.get(c.enabledKey)); request('disabled', store.get(c.disabledKey));
          request('keys', store.getAllKeys());
          if (name !== undefined) request('package', store.get(c.key(name)));
        } catch (error) { abort(error); }
      }));
    }
    async function read() {
      const c = contract(), state = await transaction(c, 'readonly');
      delete state.package;
      return {...decorateState(c, state), writable: c.utils.version === '2.101.1',
        reason: c.utils.version === '2.101.1' ? '' : '此存储适配仅验证了 ModLoader 2.101.1，当前版本只读。'};
    }
    async function prepare(snapshot, name) {
      if (!snapshot || !validName(name)) throw Error('请先刷新配置。');
      const state = await transaction(contract(), 'readonly', name);
      if (state.revision !== snapshot.revision) throw Error('配置已变化，请刷新后重新确认。');
      const token = {...snapshot};
      prepared.set(token, {name, bytes: state.package === undefined ? undefined : bytesOf(state.package)});
      return token;
    }
    async function inspect(input) {
      const bytes = bytesOf(input);
      if (!bytes.length || bytes.length > LIMIT) throw Error('请选择不超过 256 MiB 的模组包。');
      const bootJson = await contract().controller.checkModZipFileIndexDB(bytes);
      if (!bootJson || typeof bootJson !== 'object' || Array.isArray(bootJson) || !validName(bootJson.name) || typeof bootJson.version !== 'string') {
        throw Error('加载器未通过模组包校验：' + (typeof bootJson === 'string' ? bootJson.slice(0, 300) : '缺少合法名称或版本'));
      }
      return {name: bootJson.name, version: bootJson.version, bootJson};
    }
    async function exportZip(name) {
      if (!validName(name)) throw Error('模组名称无效。');
      const data = await transaction(contract(), 'readonly', name);
      const bytes = bytesOf(data.package);
      if (bytes.length > LIMIT) throw Error('包体超过 256 MiB 限制。');
      return bytes;
    }
    async function details(name) {
      const bytes = await exportZip(name), info = await inspect(bytes);
      if (info.name !== name) throw Error('登记名称与包内名称不一致，不能把它当作同一模组。');
      const readme = await environment.DMCReadme?.read(bytes);
      return {...info, size: bytes.length, readme};
    }
    async function loadedDetails(name) {
      if (!validName(name)) throw Error('模组名称无效。');
      const utils=environment.modUtils || environment.modSC2DataManager?.getModUtils?.();
      const mod=utils?.getAnyModByNameNoAlias?.(name) || utils?.getMod?.(name);
      if (!mod?.bootJson) throw Error('当前运行模组元数据不可用。');
      let readme;
      try {
        const runtimeZip=utils.getModZip?.(name);
        const zip=typeof runtimeZip?.getZipFile==='function' ? runtimeZip.getZipFile() : runtimeZip;
        readme=await environment.DMCReadme?.loaded(zip);
      }
      catch(error){readme={message:'运行包文档不可用：'+error.message};}
      return {name,version:mod.bootJson.version,bootJson:mod.bootJson,readme};
    }
    function allPackages(c,mode,operation){
      return c.loader.customStore(mode,store=>new Promise((resolve,reject)=>{
        const tx=store.transaction;let result,failure,keys,values;
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(failure||Error('完整配置事务已中止。'));
        function finish(){if(!keys||!values)return;try{
          const map=new Map(keys.map((k,i)=>[k,values[i]]));
          const enabled=parseList(map.get(c.enabledKey),'启用列表'),disabled=parseList(map.get(c.disabledKey),'禁用列表');
          if(enabled.some(n=>disabled.includes(n)))throw Error('启用和禁用列表重叠。');
          const packages=keys.filter(k=>typeof k==='string'&&k.startsWith(c.prefix)).map(k=>({name:k.slice(c.prefix.length),bytes:bytesOf(map.get(k))}));
          if(packages.some(p=>!validName(p.name)||c.key(p.name)!==c.prefix+p.name))throw Error('包体键名异常。');
          result=operation(store,{enabled,disabled,packages,rawEnabled:map.get(c.enabledKey),rawDisabled:map.get(c.disabledKey),recovery:map.get(RECOVERY_KEY)});
        }catch(error){failure=error;tx.abort();}}
        const kr=store.getAllKeys(),vr=store.getAll();kr.onsuccess=()=>{keys=kr.result;finish();};vr.onsuccess=()=>{values=vr.result;finish();};
      }));
    }
    const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return root.btoa(s);};
    async function digest(bytes){if(!root.crypto?.subtle)throw Error('当前环境无法校验备份哈希。');return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
    // External references are accepted only from the loader's confirmed Local cache.
    function preloadReferences(c, enabled, disabled, packages) {
      const state=decorateState(c,{enabled,disabled,packages:packages.map(p=>p.name)});
      if(state.missing.length)throw Error('名单引用了缺失包体或来源尚未确认：'+state.missing.join('、')+'。请在游戏加载完成后重试；真正缺包时可使用紧急导出。');
      return state.preloadedReferences.map(name=>{
        const matches=state.preloaded.filter(p=>p.name===name);
        if(matches.length!==1 || !matches[0].version)throw Error('预载来源或版本不明确：'+name);
        return {name,version:matches[0].version,from:'Local'};
      });
    }
    function checkPreloads(c, references) {
      const entries=cacheEntries(c);
      for(const ref of references){
        const matches=entries.filter(e=>e?.name===ref.name&&e.from==='Local'&&e.mod?.bootJson);
        if(matches.length!==1||matches[0].mod.bootJson.version!==ref.version)throw Error('目标游戏缺少相同版本的预载模组，或尚未完成加载：'+ref.name+' '+ref.version);
      }
    }
    async function backup(){
      const c=contract(),raw=await allPackages(c,'readonly',(_,state)=>state);
      if(raw.packages.length>2000 || raw.packages.reduce((s,p)=>s+p.bytes.length,0)>LIMIT)throw Error('完整备份超过 256 MiB 或 2000 个包的限制。');
      const preloaded=preloadReferences(c,raw.enabled,raw.disabled,raw.packages);
      const packages=[];
      for(const p of raw.packages){const info=await inspect(p.bytes);if(info.name!==p.name)throw Error('包内名称与登记名称不一致：'+p.name);packages.push({name:p.name,version:info.version,byteLength:p.bytes.length,sha256:await digest(p.bytes),data:encode(p.bytes)});}
      const fingerprint=await digest(new TextEncoder().encode(JSON.stringify([raw.enabled,raw.disabled,packages.map(p=>[p.name,p.byteLength,p.sha256])])));
      return {schema:'DoLModCenter.full.v2',preloaded,storageVersion:c.utils.version,createdAt:new Date().toISOString(),enabled:raw.enabled,disabled:raw.disabled,packages,fingerprint};
    }
    function emergencyReport(value) {
      if (typeof value !== 'string') return {type: value === undefined ? 'missing' : typeof value};
      return value.length <= 65536 ? {type:'string',value} : {type:'string',length:value.length,value:value.slice(0,65536),truncated:true};
    }
    function emergencyList(value, label, issues) {
      if (value === undefined) return {raw: emergencyReport(value), value: [], valid: true};
      try {
        if(typeof value==='string'&&value.length>1048576)throw Error(label+'超过紧急解析上限，原文仅保留前64KiB');
        const parsed = typeof value === 'string' ? JSON.parse(value) : null;
        if (!Array.isArray(parsed) || parsed.length > 2000 || !parsed.every(validName) || new Set(parsed).size !== parsed.length) throw Error(label + '格式异常');
        return {raw: emergencyReport(value), value: parsed, valid: true};
      } catch (error) {
        issues.push({kind:'config',key:label,message:error.message || label + '无法解析'});
        return {raw: emergencyReport(value), value: [], valid: false};
      }
    }
    function emergencyTransaction(c) {
      return c.loader.customStore('readonly', store => new Promise((resolve, reject) => {
        const tx=store.transaction; let keys, values, settled=false;
        const fail=error => { if (!settled) { settled=true; try { tx.abort(); } catch (_) {} reject(error); } };
        tx.onerror=()=>fail(tx.error || Error('应急导出读取失败。'));
        tx.onabort=()=>fail(tx.error || Error('应急导出事务已中止。'));
        tx.oncomplete=()=>{ if (!settled) { settled=true; resolve({keys,values}); } };

        try {
          const kr=store.getAllKeys();
          kr.onsuccess=()=>{keys=kr.result;values=new Array(keys.length);let packages=0;
            keys.forEach((key,index)=>{const isPackage=typeof key==='string'&&key.startsWith(c.prefix);
              if(key!==c.enabledKey&&key!==c.disabledKey&&(!isPackage||packages++>=2000))return;
              const request=store.get(key);request.onsuccess=()=>{values[index]=request.result;};request.onerror=()=>fail(request.error||Error('应急导出值读取失败。'));
            });
          };
          kr.onerror=()=>fail(kr.error || Error('应急导出键读取失败。'));
        } catch (error) { fail(error); }
      }));
    }
    async function emergencyBackup() {
      const c=contract(), captured=await emergencyTransaction(c), keys=Array.isArray(captured.keys)?captured.keys:[], values=Array.isArray(captured.values)?captured.values:[];
      const map=new Map(keys.map((key,index)=>[key,values[index]])), issues=[];
      const enabledInfo=emergencyList(map.get(c.enabledKey),'enabled',issues), disabledInfo=emergencyList(map.get(c.disabledKey),'disabled',issues);
      const enabled=enabledInfo.value, disabled=disabledInfo.value, referenced=new Set([...enabled,...disabled]);
      if(enabled.some(name=>disabled.includes(name)))issues.push({kind:'config',message:'启用和禁用名单存在重叠。'});
      const packageKeys=keys.filter(key=>typeof key==='string'&&key.startsWith(c.prefix));
      const packages=[]; let total=0, complete=true, allHashes=true, allValidated=true;
      if (packageKeys.length>2000) { complete=false; issues.push({kind:'limit',message:'包数量超过 2000，超出部分未捕获。',count:packageKeys.length}); }
      for (let index=0; index<Math.min(packageKeys.length,2000); index++) {
        const key=packageKeys[index], name=key.slice(c.prefix.length), raw=map.get(key), item={name};
        if (!validName(name) || c.key(name)!==key) { complete=false; issues.push({kind:'package',name,message:'包体键名异常，未捕获。'}); continue; }
        let bytes;
        try { bytes=bytesOf(raw); } catch (error) { complete=false; allHashes=false; allValidated=false; item.capture='unreadable'; item.issue=error.message; issues.push({kind:'package',name,message:error.message}); packages.push(item); continue; }
        if (bytes.length<1 || bytes.length>LIMIT || total+bytes.length>LIMIT) {
          complete=false; allHashes=false; allValidated=false; item.capture='excluded'; item.byteLength=bytes.length; item.issue=bytes.length>LIMIT?'包体超过 256 MiB。':'应急导出总量超过 256 MiB。';
          issues.push({kind:'limit',name,message:item.issue,byteLength:bytes.length}); packages.push(item); continue;
        }
        total+=bytes.length; item.capture='complete'; item.byteLength=bytes.length; item.data=encode(bytes);
        try { item.sha256=await digest(bytes); } catch (error) { complete=false; allHashes=false; item.sha256=null; item.issue=error.message; issues.push({kind:'hash',name,message:error.message}); }
        try {
          const bootJson=await c.controller.checkModZipFileIndexDB(bytes);
          item.validation={status:bootJson&&typeof bootJson==='object'&&!Array.isArray(bootJson)&&validName(bootJson.name)&&bootJson.name===name&&typeof bootJson.version==='string'?'valid':'invalid',name:bootJson?.name,version:bootJson?.version};
          if (item.validation.status!=='valid') { complete=false; allValidated=false; item.issue='原生 ZIP/模组校验未通过。'; issues.push({kind:'validation',name,message:item.issue}); }
        } catch (error) { complete=false; allValidated=false; item.validation={status:'invalid',message:error.message}; item.issue=error.message; issues.push({kind:'validation',name,message:error.message}); }
        packages.push(item);
      }
      const storedNames=new Set(packages.filter(p=>p.capture==='complete').map(p=>p.name));
      const trustedPreloads=new Set(cacheEntries(c).filter(e=>e?.from==='Local'&&e?.mod?.bootJson&&validName(e.name)).map(e=>e.name));
      const missing=[...referenced].filter(name=>!storedNames.has(name)&&!trustedPreloads.has(name));
      for (const name of missing) issues.push({kind:'missing-reference',name,message:'配置引用的包体未被完整捕获。'});
      const entries=cacheEntries(c), preloaded=entries.filter(entry=>entry?.from==='Local'&&validName(entry?.name)&&entry?.mod?.bootJson&&typeof entry.mod.bootJson==='object'&&!Array.isArray(entry.mod.bootJson)).map(entry=>({name:entry.name,version:String(entry.mod.bootJson.version??''),from:'Local'}));
      const timestamp=new Date().toISOString();
      return {schema:'DoLModCenter.emergency.v1',restorable:false,createdAt:timestamp,timestamp,loaderVersion:c.utils.version,
        config:{enabled:enabledInfo,disabled:disabledInfo,referenced:[...referenced],missing},packages,preloaded,
        completePackageCapture:complete&&packageKeys.length<=2000&&total<=LIMIT,integrity:{allHashes,allValidated},consistentCapture:true,
        issues,requiresReview:issues.length>0,exclusions:['saves','game','embeddedPackages','typeconfigs','caches'],rawConfigLimit:65536};
    }
    async function prepareRestore(archive){
      if(!archive||!['DoLModCenter.full.v1','DoLModCenter.full.v2'].includes(archive.schema)||archive.storageVersion!=='2.101.1'||!Array.isArray(archive.enabled)||!Array.isArray(archive.disabled)||!Array.isArray(archive.packages)||archive.packages.length>2000)throw Error('备份格式或加载器版本不受支持。');
      if(archive.packages.reduce((n,p)=>n+(typeof p?.data==='string'?p.data.length:0),0)>Math.ceil(LIMIT/3)*4+8000)throw Error('备份编码总量超过限制。');
      const enabled=parseList(JSON.stringify(archive.enabled),'备份启用列表'),disabled=parseList(JSON.stringify(archive.disabled),'备份禁用列表');
      if(enabled.some(n=>disabled.includes(n)))throw Error('备份列表重叠。');
      const packages=[],names=new Set();let total=0;
      for(const p of archive.packages){
        if(!validName(p?.name)||names.has(p.name)||typeof p.version!=='string'||typeof p.data!=='string'||p.data.length>Math.ceil(LIMIT/3)*4||p.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(p.data)||!Number.isInteger(p.byteLength)||p.byteLength<1||p.byteLength>LIMIT||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('备份包条目无效或重复。');
        const bytes=bytesOf(p.data);total+=bytes.length;if(total>LIMIT)throw Error('备份包总量超过 256 MiB。');
        if(encode(bytes)!==p.data || bytes.length!==p.byteLength || await digest(bytes)!==p.sha256)throw Error('备份包长度或哈希不符：'+p.name);
        const info=await inspect(bytes);if(info.name!==p.name || info.version!==p.version)throw Error('备份元数据不符：'+p.name);
        names.add(p.name);packages.push({name:p.name,bytes});
      }
      const preloaded=archive.schema==='DoLModCenter.full.v2'?archive.preloaded:[];
      if(!Array.isArray(preloaded)||preloaded.length>4000)throw Error('备份预载引用格式无效。');
      const external=new Set();
      for(const p of preloaded){
        if(!validName(p?.name)||typeof p.version!=='string'||!p.version||p.from!=='Local'||external.has(p.name)||names.has(p.name)||!enabled.includes(p.name)&&!disabled.includes(p.name))throw Error('备份预载引用无效或重复。');
        external.add(p.name);
      }
      if([...enabled,...disabled].some(n=>!names.has(n)&&!external.has(n)))throw Error('备份中缺少名单引用的包体。');
      const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读，不能恢复。');
      checkPreloads(c,preloaded);
      const before=await allPackages(c,'readonly',(_,state)=>state),signatures=[];
      for(const p of before.packages)signatures.push([p.name,p.bytes.length,await digest(p.bytes)]);
      const fingerprint=await digest(new TextEncoder().encode(JSON.stringify([before.enabled,before.disabled,signatures])));
      const token={enabled,disabled,names:[...names],bytes:total,previousPackages:before.packages.length,fingerprint,preloaded:preloaded.map(p=>({...p})),orphans:packages.filter(p=>!enabled.includes(p.name)&&!disabled.includes(p.name)).length};
      restoreTokens.set(token,{before,preloaded:preloaded.map(p=>({...p})),next:{enabled:[...enabled],disabled:[...disabled],packages}});return token;
    }
    function sameSnapshot(a,b){return JSON.stringify([a.enabled,a.disabled])===JSON.stringify([b.enabled,b.disabled])&&a.packages.length===b.packages.length&&a.packages.every((p,i)=>p.name===b.packages[i].name&&sameBytes(p.bytes,b.packages[i].bytes));}
    async function restore(token){
      const plan=restoreTokens.get(token);if(!plan)throw Error('请重新检查备份后确认恢复。');
      if(busy)throw Error('已有存储操作进行中。');busy=true;activeWrites++;
      try{const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读。');
        checkPreloads(c,plan.preloaded);
        await allPackages(c,'readwrite',(store,current)=>{
          if(current.rawEnabled!==plan.before.rawEnabled || current.rawDisabled!==plan.before.rawDisabled || !sameSnapshot(current,plan.before))throw Error('恢复确认期间配置或包体已变化，请重新检查。');
          store.delete(RECOVERY_KEY);
          for(const p of current.packages)store.delete(c.key(p.name));
          for(const p of plan.next.packages)store.put(p.bytes,c.key(p.name));
          store.put(JSON.stringify(plan.next.enabled),c.enabledKey);store.put(JSON.stringify(plan.next.disabled),c.disabledKey);
        });restoreTokens.delete(token);
        const after=await allPackages(c,'readonly',(_,state)=>state);
        const expected={...plan.next,packages:[...plan.next.packages].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)};
        if(!sameSnapshot(after,expected))throw Error('恢复已提交，但回读发现又有变化；请重新核对。');
        return read();
      }finally{busy=false;activeWrites--;}
    }
    // Capture package bytes as well as lists: a same-name replacement invalidates a sorting preview.
    async function catalog(snapshot) {
      const c=contract(), before=await allPackages(c,'readonly',(_,state)=>state);
      const revision=JSON.stringify([before.enabled,before.disabled,before.packages.map(p=>p.name).sort()]);
      if(snapshot && revision!==snapshot.revision)throw Error('配置已变化，请刷新后读取包资料。');
      if(before.packages.length>2000 || before.packages.reduce((n,p)=>n+p.bytes.length,0)>LIMIT)throw Error('包资料扫描超过 256 MiB 或 2000 个包的限制；仍可逐包查看详情和管理。');
      for(const name of metadataCache.keys())if(!before.packages.some(p=>p.name===name))metadataCache.delete(name);
      const items=[];
      for(const p of before.packages){
        try{let cached=metadataCache.get(p.name);if(!cached||!sameBytes(cached.bytes,p.bytes)){const info=await inspect(p.bytes);if(info.name!==p.name)throw Error('包内名称与登记名称不一致');cached={bytes:p.bytes,info};metadataCache.set(p.name,cached)}items.push(JSON.parse(JSON.stringify(cached.info)));}
        catch(error){items.push({name:p.name,error:error.message});}
      }
      const decorated=decorateState(c, {...before, packages: before.packages.map(p => p.name)});
      const result={items,preloaded:decorated.preloaded,enabled:[...before.enabled],disabled:[...before.disabled],revision};
      catalogTokens.set(result,before);return result;
    }
    async function reorderCatalog(token, order) {
      const before=catalogTokens.get(token);
      if(!before || !Array.isArray(order) || order.length!==before.enabled.length || new Set(order).size!==order.length || order.some(n=>!before.enabled.includes(n)))throw Error('排序预览已失效或名单不完整，请重新生成。');
      const nextOrder=[...order];
      if(busy)throw Error('已有存储操作进行中。');busy=true;activeWrites++;
      try{const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读。');
        await allPackages(c,'readwrite',(store,current)=>{
          if(current.rawEnabled!==before.rawEnabled || current.rawDisabled!==before.rawDisabled || !sameSnapshot(current,before))throw Error('排序预览后配置或包体已变化，请重新生成预览。');
          store.put(JSON.stringify(nextOrder),c.enabledKey);
        });catalogTokens.delete(token);
        const after=await allPackages(c,'readonly',(_,state)=>state);
        if(!sameSnapshot(after,{...before,enabled:nextOrder}))throw Error('排序已提交，但回读发现配置又发生变化，请刷新核对。');
        return read();
      }finally{busy=false;activeWrites--;}
    }
    async function disableAll(snapshot){
      if(busy)throw Error('已有存储操作进行中。');busy=true;activeWrites++;
      try{const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读。');
        await transaction(c,'readwrite',undefined,(store,state)=>{
          if(state.revision!==snapshot?.revision)throw Error('配置已变化，请刷新后确认。');
          store.put(JSON.stringify([]),c.enabledKey);store.put(JSON.stringify([...state.disabled,...state.enabled]),c.disabledKey);
        });return read();
      }finally{busy=false;activeWrites--;}
    }
    async function change(snapshot, name, kind, argument) {
      if (busy) throw Error('已有配置操作进行中，请等待完成。');
      if (!snapshot || typeof snapshot.revision !== 'string' || !validName(name)) throw Error('请先刷新配置。');
      if (name === 'DoLModCenter' && kind !== 'install' && !environment.__DMC_BUILTIN) throw Error('请通过原加载器停用或删除当前管理器。');
      busy = true;activeWrites++;
      try {
        const c = contract();
        if (c.utils.version !== '2.101.1') throw Error('当前加载器版本未经过存储适配验证，禁止写入。');
        const condition = prepared.get(snapshot);
        if ((kind === 'install' || kind === 'remove') && condition?.name !== name) throw Error('请先检查目标包并重新确认此操作。');
        const expected = await transaction(c, 'readwrite', name, (store, state, existing) => {
          if (state.revision !== snapshot.revision) throw Error('配置已被其他操作修改，请刷新后重试。');
          if (kind === 'install' || kind === 'remove') {
            if ((existing === undefined) !== (condition.bytes === undefined) ||
                (existing !== undefined && !sameBytes(bytesOf(existing), condition.bytes))) {
              throw Error('目标包在确认后已被其他操作替换；请刷新并重新确认。');
            }
          }
          let enabled = [...state.enabled], disabled = [...state.disabled];
          if (kind !== 'install' && !enabled.includes(name) && !disabled.includes(name)) throw Error('该模组不在旁加载配置中，不能修改内置模组。');
          if (kind === 'toggle') {
            if (existing === undefined) throw Error('模组包体缺失，请重新导入。');
            enabled = enabled.filter(n => n !== name); disabled = disabled.filter(n => n !== name);
            (argument ? enabled : disabled).push(name);
          } else if (kind === 'move') {
            if (!enabled.includes(name) || !Number.isInteger(argument) || argument < 0 || argument >= enabled.length) throw Error('加载顺序位置无效。');
            enabled.splice(enabled.indexOf(name), 1); enabled.splice(argument, 0, name);
          } else if (kind === 'remove') {
            enabled = enabled.filter(n => n !== name); disabled = disabled.filter(n => n !== name);
            store.delete(c.key(name));
          } else if (kind === 'install') {
            // Updating a disabled mod preserves its disabled state; new packages are enabled on next restart.
            if (!enabled.includes(name) && !disabled.includes(name)) enabled.push(name);
            store.put(argument, c.key(name));
          } else throw Error('未知操作。');
          store.put(JSON.stringify(enabled), c.enabledKey); store.put(JSON.stringify(disabled), c.disabledKey);
          return {enabled, disabled};
        });
        const after = await transaction(c, 'readonly', name);
        if (JSON.stringify([after.enabled, after.disabled]) !== JSON.stringify([expected.enabled, expected.disabled])) {
          throw Error('事务已提交，但回读发现配置又发生变化；请刷新核对，不自动覆盖其他操作。');
        }
        if (kind === 'remove' && after.package !== undefined) throw Error('删除后包体核验未通过。');
        if (kind === 'install' && !sameBytes(bytesOf(after.package), argument)) throw Error('导入后包体核验未通过。');
        delete after.package;
        return {...decorateState(c, after), writable: true, reason: ''};
      } finally { busy = false; activeWrites--; }
    }
    function bounded(raw){
      if(raw.packages.length>2000||raw.packages.reduce((n,p)=>n+p.bytes.length,0)>LIMIT)throw Error('启动恢复总包体超过 256 MiB 或 2000 包限制。');
    }
    async function fingerprint(raw){
      bounded(raw);const signatures=[];
      for(const p of [...raw.packages].sort((a,b)=>a.name.localeCompare(b.name)))signatures.push([p.name,p.bytes.length,await digest(p.bytes)]);
      return digest(new TextEncoder().encode(JSON.stringify([raw.rawEnabled,raw.rawDisabled,raw.enabled,raw.disabled,signatures])));
    }
    // Only this installer creates a recovery point. Lists, new ZIPs and old ZIPs commit together.
    async function prepareInstallBatch(snapshot, inputs, options={}){
      if(!Array.isArray(inputs)||!inputs.length||inputs.length>100)throw Error('一次请选择 1–100 个 ZIP。');
      const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读。');
      const packages=[],items=[],names=new Set();let total=0;
      for(const input of inputs){const bytes=bytesOf(input);total+=bytes.length;if(total>LIMIT)throw Error('导入包总量超过 256 MiB。');const info=await inspect(bytes);if(names.has(info.name))throw Error('同批包名称重复：'+info.name);names.add(info.name);packages.push({name:info.name,bytes});items.push(info);}
      const before=await allPackages(c,'readonly',(_,s)=>s);bounded(before);
      const revision=JSON.stringify([before.enabled,before.disabled,before.packages.map(p=>p.name).sort()]);
      if(revision!==snapshot?.revision)throw Error('配置已变化，请重新导入。');
      if(before.recovery!==undefined)throw Error('存在未处理的启动恢复点，请先在备份与恢复中确认保留当前配置或撤销上次导入。');
      const next={enabled:[...before.enabled],disabled:[...before.disabled],packages:before.packages.filter(p=>!names.has(p.name)).concat(packages).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)};
      for(const p of packages)if(!next.enabled.includes(p.name)&&!next.disabled.includes(p.name))next.enabled.push(p.name);
      if(options.order!==undefined){
        if(typeof options.order!=='function')throw Error('排序计划无效。');
        const decorated=decorateState(c,{...next,packages:next.packages.map(p=>p.name)});
        const fixedNames=decorated.preloaded.filter(p=>!next.packages.some(x=>x.name===p.name)).map(p=>p.name),allItems=[];
        for(const p of next.packages){
          let info=items.find(item=>item.name===p.name);
          if(!info){const cached=metadataCache.get(p.name);info=cached&&sameBytes(cached.bytes,p.bytes)?cached.info:await inspect(p.bytes);}
          if(info.name!==p.name)throw Error('包内名称与登记名称不一致：'+p.name);
          allItems.push(info);
        }
        const proposed=await options.order(JSON.parse(JSON.stringify({enabled:next.enabled,disabled:next.disabled,items:allItems,preloaded:decorated.preloaded,fixedNames})));
        if(!Array.isArray(proposed)||proposed.length!==next.enabled.length||new Set(proposed).size!==proposed.length||proposed.some(n=>!next.enabled.includes(n)))throw Error('排序名单不是启用列表的完整排列。');
        if(next.enabled.some((name,index)=>fixedNames.includes(name)&&proposed[index]!==name))throw Error('不能移动预载模组的固定位置。');
        next.enabled=[...proposed];
      }
      parseList(JSON.stringify(next.enabled),'导入启用列表');parseList(JSON.stringify(next.disabled),'导入禁用列表');
      next.rawEnabled=JSON.stringify(next.enabled);next.rawDisabled=JSON.stringify(next.disabled);
      bounded(next);
      const previous=[];
      for(const p of packages){const old=before.packages.find(x=>x.name===p.name);previous.push({name:p.name,data:old?encode(old.bytes):null,sha256:old?await digest(old.bytes):null});}
      const record={schema:'DoLModCenter.recovery.v1',loaderVersion:c.utils.version,id:SESSION+'-'+Math.random().toString(36).slice(2),session:SESSION,createdAt:new Date().toISOString(),enabled:[...before.enabled],disabled:[...before.disabled],previous,expected:await fingerprint(next)};
      const token={items:JSON.parse(JSON.stringify(items)),names:[...names],enabled:[...next.enabled],disabled:[...next.disabled]};
      batchTokens.set(token,{before,next,record});return token;
    }
    async function installBatch(token){
      const plan=batchTokens.get(token);if(!plan)throw Error('请重新检查导入包。');
      if(busy)throw Error('已有存储操作进行中。');busy=true;activeWrites++;
      let committed=false;
      try{const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读。');
        await allPackages(c,'readwrite',(store,current)=>{
          if(current.recovery!==undefined||current.rawEnabled!==plan.before.rawEnabled||current.rawDisabled!==plan.before.rawDisabled||!sameSnapshot(current,plan.before))throw Error('确认期间配置或包体已变化，请重新导入。');
          store.put(plan.record,RECOVERY_KEY);
          for(const p of plan.next.packages)if(plan.record.previous.some(x=>x.name===p.name))store.put(p.bytes,c.key(p.name));
          store.put(JSON.stringify(plan.next.enabled),c.enabledKey);store.put(JSON.stringify(plan.next.disabled),c.disabledKey);
        });batchTokens.delete(token);
        committed=true;
        const after=await allPackages(c,'readonly',(_,s)=>s);
        if(after.rawEnabled!==plan.next.rawEnabled||after.rawDisabled!==plan.next.rawDisabled||!sameSnapshot(after,plan.next)||JSON.stringify(after.recovery)!==JSON.stringify(plan.record))throw Error('导入已提交，但回读发现变化；请检查恢复点。');
        return await read();
      }catch(error){
        if(committed){
          if(error&&typeof error==='object'){
            try{error.committed=true}catch(_){const wrapped=Error(String(error));wrapped.committed=true;error=wrapped;}
          }else {const wrapped=Error(String(error));wrapped.committed=true;error=wrapped;}
        }
        throw error;
      }finally{busy=false;activeWrites--;}
    }
    function recoverySummary(record){
      if(!record)return null;
      if(record.schema!=='DoLModCenter.recovery.v1'||record.loaderVersion!=='2.101.1'||!Array.isArray(record.previous)||record.previous.length<1||record.previous.length>100||typeof record.id!=='string'||record.id.length>160||typeof record.session!=='string'||record.session.length>160||typeof record.createdAt!=='string'||record.createdAt.length>40||!Number.isFinite(Date.parse(record.createdAt))||typeof record.expected!=='string'||!/^[a-f0-9]{64}$/.test(record.expected))throw Error('启动恢复点格式异常，保留原记录，请先导出完整备份。');
      return {id:record.id,createdAt:record.createdAt,names:record.previous.map(p=>p.name),pendingRestart:record.session===SESSION};
    }
    async function readRecovery(){return allPackages(contract(),'readonly',(_,s)=>recoverySummary(s.recovery));}
    async function prepareRecovery(){
      const c=contract(),before=await allPackages(c,'readonly',(_,s)=>s),record=before.recovery;
      const summary=recoverySummary(record);if(!summary)throw Error('没有启动恢复点。');
      if(await fingerprint(before)!==record.expected)throw Error('导入后配置或包体已有其他变化，不能直接回退；请使用完整备份或手动核对。');
      const enabled=parseList(JSON.stringify(record.enabled),'恢复启用列表'),disabled=parseList(JSON.stringify(record.disabled),'恢复禁用列表');
      if(enabled.some(n=>disabled.includes(n)))throw Error('恢复名单重叠。');
      if(record.previous.reduce((n,p)=>n+(typeof p?.data==='string'?p.data.length:0),0)>Math.ceil(LIMIT/3)*4+400)throw Error('旧包体编码总量超过限制。');
      const names=new Set(),packages=[...before.packages];let oldTotal=0;
      for(const p of record.previous){
        if(!validName(p?.name)||names.has(p.name)||!before.packages.some(x=>x.name===p.name))throw Error('恢复包条目无效。');names.add(p.name);
        if(p.data===null){if(p.sha256!==null)throw Error('新增包恢复条目无效。');if(!disabled.includes(p.name)&&!enabled.includes(p.name))disabled.push(p.name);continue;}
        if(typeof p.data!=='string'||p.data.length>Math.ceil(LIMIT/3)*4||p.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(p.data)||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('旧包体大小或格式异常。');
        const bytes=bytesOf(p.data);oldTotal+=bytes.length;if(!bytes.length||oldTotal>LIMIT||encode(bytes)!==p.data)throw Error('旧包体总量或编码不合法。');if(await digest(bytes)!==p.sha256)throw Error('旧包体校验失败：'+p.name);
        const info=await inspect(bytes);if(info.name!==p.name)throw Error('旧包名称不符。');
        const i=packages.findIndex(x=>x.name===p.name);if(i<0)throw Error('当前包体缺失。');packages[i]={name:p.name,bytes};
      }
      parseList(JSON.stringify(enabled),'恢复启用列表');parseList(JSON.stringify(disabled),'恢复禁用列表');
      const token={...summary};recoveryTokens.set(token,{before,recordText:JSON.stringify(record),next:{enabled,disabled,packages}});return token;
    }
    async function rollbackRecovery(token){
      const plan=recoveryTokens.get(token);if(!plan)throw Error('请重新检查恢复点。');
      if(busy)throw Error('已有存储操作进行中。');busy=true;activeWrites++;
      try{const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读。');
        await allPackages(c,'readwrite',(store,current)=>{
          if(JSON.stringify(current.recovery)!==plan.recordText||current.rawEnabled!==plan.before.rawEnabled||current.rawDisabled!==plan.before.rawDisabled||!sameSnapshot(current,plan.before))throw Error('恢复确认期间配置发生变化，请重新检查。');
          for(const p of plan.next.packages)if(current.recovery.previous.some(x=>x.name===p.name&&x.data!==null))store.put(p.bytes,c.key(p.name));
          store.put(JSON.stringify(plan.next.enabled),c.enabledKey);store.put(JSON.stringify(plan.next.disabled),c.disabledKey);store.delete(RECOVERY_KEY);
        });recoveryTokens.delete(token);
        const after=await allPackages(c,'readonly',(_,s)=>s);if(after.rawEnabled!==JSON.stringify(plan.next.enabled)||after.rawDisabled!==JSON.stringify(plan.next.disabled)||!sameSnapshot(after,plan.next)||after.recovery!==undefined)throw Error('恢复已提交但回读不符，请刷新检查。');
        return read();
      }finally{busy=false;activeWrites--;}
    }
    async function dismissRecovery(id){
      if(busy)throw Error('已有存储操作进行中。');busy=true;activeWrites++;
      try{const c=contract();if(c.utils.version!=='2.101.1')throw Error('当前加载器只读。');return await allPackages(c,'readwrite',(store,s)=>{if(s.recovery?.id!==id)throw Error('恢复点已变化，请刷新。');store.delete(RECOVERY_KEY);});}
      finally{busy=false;activeWrites--;}
    }
    return {
      prepareInstallBatch,installBatch,readRecovery,prepareRecovery,rollbackRecovery,dismissRecovery,
      read, inspect, details, loadedDetails, catalog, reorderCatalog, exportZip, prepare, backup, emergencyBackup, prepareRestore, restore, disableAll,isBusy:()=>busy,
      toggle(snapshot, name, enabled) {
        if (typeof enabled !== 'boolean') return Promise.reject(Error('启停状态必须是布尔值。'));
        return change(snapshot, name, 'toggle', enabled);
      },
      move: (snapshot, name, index) => change(snapshot, name, 'move', index),
      remove: (snapshot, name) => change(snapshot, name, 'remove'),
      async install(snapshot, input) {
        const bytes = bytesOf(input), manifest = await inspect(bytes);
        return change(snapshot, manifest.name, 'install', bytes);
      }
    };
  }
  root.DMCStorage = {create,isBusy:()=>activeWrites>0};
})(typeof window === 'undefined' ? globalThis : window);
