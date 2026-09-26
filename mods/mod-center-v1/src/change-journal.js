(function(root){
 'use strict';
 const KEY='DoLModCenter.changes.v1',labels={install:'导入／更新',remove:'删除',toggle:'启停',move:'拖拽排序',reorderCatalog:'按前置排序',restore:'恢复完整备份',disableAll:'停用全部旁加载模组'};
 let entries=[],warning='',loaded=false;
 const clean=v=>typeof v==='string'?v.slice(0,160):'';
 function sanitize(e){if(!e||!Object.prototype.hasOwnProperty.call(labels,e.kind)||typeof e.time!=='string'||!Array.isArray(e.names))return null;return {kind:e.kind,time:e.time.slice(0,40),names:e.names.slice(0,100).map(clean).filter(Boolean),count:Number.isSafeInteger(e.count)?Math.max(0,e.count):e.names.length,version:clean(e.version),outcome:'success'};}
 function load(){if(loaded)return;loaded=true;try{const raw=root.localStorage.getItem(KEY);if(!raw)return;if(raw.length>131072)throw Error();const data=JSON.parse(raw);if(!Array.isArray(data)||data.length>100)throw Error();entries=data.map(sanitize);if(entries.some(x=>!x))throw Error();}catch(_){entries=[];warning='历史记录无法读取；仅显示本次会话记录，不覆盖原有历史。';}}
 function record(entry){load();entries.push(sanitize(entry));entries=entries.filter(Boolean).slice(-100);if(warning)return;try{while(entries.length>1&&JSON.stringify(entries).length>131072)entries.shift();root.localStorage.setItem(KEY,JSON.stringify(entries));}catch(_){warning='变更已完成，但历史无法保存；本次会话仍可查看。';}}
 const wrapped=new WeakSet();
 function wrap(api){if(!api||wrapped.has(api))return api;wrapped.add(api);const prepared=new WeakMap(),info=new WeakMap();
  if(api.prepare){const fn=api.prepare;api.prepare=async(...args)=>{const token=await fn(...args);prepared.set(token,args[1]);return token;};}
  if(api.inspect){const fn=api.inspect;api.inspect=async(...args)=>{const result=await fn(...args);if(args[0]&&typeof args[0]==='object')info.set(args[0],result);return result;};}
  for(const kind of Object.keys(labels)){if(typeof api[kind]!=='function')continue;const fn=api[kind];api[kind]=async(...args)=>{
   const result=await fn(...args);
   try{
    let names=[],version='';
    if(kind==='install'){const details=info.get(args[1]);names=[details?.name||prepared.get(args[0])].filter(Boolean);version=details?.version||'';}
    else if(['remove','toggle','move'].includes(kind))names=[args[1]];
    else if(kind==='restore')names=args[0]?.names||[];
    else if(kind==='reorderCatalog')names=args[1]||[];
    else names=args[0]?.enabled||[];
    record({kind,time:new Date().toISOString(),names,count:names.length,version});
   }catch(_){warning='操作已完成，但历史记录失败。';}
   return result;
  };}
  return api;
 }
 function render(host){load();const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};host.append(el('h3','最近变更'),el('p','仅记录本版本管理器确认成功的操作，最多 100 条；不包含外部修改，也不证明与报错有关。此记录不含旧包体，不能用作回滚备份。'));
  if(warning)host.append(el('p',warning));if(!entries.length)host.append(el('p','尚无变更记录。'));
  for(const e of [...entries].reverse()){const card=el('details','');card.append(el('summary',e.time+' · '+labels[e.kind]),el('p',e.names.join('、')+(e.count>e.names.length?'（名单已截断，共 '+e.count+' 项）':'')+(e.version?' · 新版本 '+e.version:'')));host.append(card);}
 }
 root.DMCJournal={wrap,render,list(){load();return entries.map(e=>({...e,names:[...e.names]}));},status(){load();return warning;}};
})(window);
