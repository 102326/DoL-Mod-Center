/* Original, bounded, read-only classic ZIP reader. No files are extracted to disk. */
(function (root) {
  'use strict';
  const LIMIT = 256 * 1024;
  const candidate = path => typeof path === 'string' && path.length <= 512 &&
    !path.includes('\\') && !path.startsWith('/') && !path.split('/').some(p => p === '..' || p === '.') &&
    /^(?:readme(?:[._-][a-z0-9-]+)?|说明|说明文档|使用说明)(?:\.(?:md|txt|markdown))?$/i.test(path.split('/').pop());
  function choose(paths) {
    return paths.filter(candidate).sort((a,b) => a.split('/').length-b.split('/').length ||
      Number(!/^readme\.(md|txt)$/i.test(a))-Number(!/^readme\.(md|txt)$/i.test(b)) || a.localeCompare(b))[0];
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const value of bytes) { crc ^= value; for (let bit=0;bit<8;bit++) crc = (crc>>>1) ^ (crc&1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function read(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > 256*1024*1024) throw Error('不是受支持的 ZIP 包。');
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const u16 = i => view.getUint16(i,true), u32 = i => view.getUint32(i,true);
    let end = -1;
    for (let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
      if(u32(i)===0x06054b50 && i+22+u16(i+20)===bytes.length){end=i;break;}
    }
    if(end<0)throw Error('找不到 ZIP 目录。');
    const count=u16(end+10), length=u32(end+12), start=u32(end+16);
    if(u16(end+4)!==0 || u16(end+6)!==0 || u16(end+8)!==count || count===65535 || start===0xffffffff || length===0xffffffff) throw Error('暂不支持分卷或 ZIP64 文档预览。');
    if(count>20000 || start+length>end)throw Error('ZIP 目录超过限制或已损坏。');
    const entries=new Map(); let pos=start;
    for(let i=0;i<count;i++){
      if(pos+46>start+length || u32(pos)!==0x02014b50)throw Error('ZIP 目录条目损坏。');
      const n=u16(pos+28), extra=u16(pos+30), comment=u16(pos+32), next=pos+46+n+extra+comment;
      if(next>start+length)throw Error('ZIP 文件名越界。');
      const path=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+n));
      if(candidate(path)){
        if(entries.has(path))throw Error('README 路径重复，无法确定文档。');
        entries.set(path,{flags:u16(pos+8), method:u16(pos+10), crc:u32(pos+16), compressed:u32(pos+20), size:u32(pos+24), offset:u32(pos+42)});
      }
      pos=next;
    }
    const path=choose([...entries.keys()]);
    if(!path)return {message:'包内未找到 README 或说明文档。'};
    const e=entries.get(path), p=e.offset;
    if(e.flags&1)throw Error('不预览加密文档。');
    if(e.size>LIMIT || e.compressed>LIMIT+65536)throw Error('README 超过 256 KiB 预览限制。');
    if(p+30>start || u32(p)!==0x04034b50 || u16(p+8)!==e.method || u16(p+6)!==e.flags)throw Error('README ZIP 头不一致。');
    const dataStart=p+30+u16(p+26)+u16(p+28);
    if(dataStart+e.compressed>start)throw Error('README 数据越界。');
    const localPath=new TextDecoder().decode(bytes.subarray(p+30,p+30+u16(p+26)));
    if(localPath!==path)throw Error('README 文件名不一致。');
    let result=bytes.subarray(dataStart,dataStart+e.compressed);
    if(e.method===8){
      if(typeof root.DecompressionStream!=='function')throw Error('当前浏览器不支持压缩 README 预览。');
      const reader=new Blob([result]).stream().pipeThrough(new root.DecompressionStream('deflate-raw')).getReader();
      const chunks=[];let size=0;
      try { while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>LIMIT || size>e.size)throw Error('README 解压大小超过限制。');chunks.push(chunk.value);} }
      catch(error){await reader.cancel().catch(()=>{});throw error;}
      result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
    } else if(e.method!==0)throw Error('此压缩方式暂不支持文档预览。');
    if(result.length!==e.size || crc32(result)!==e.crc)throw Error('README 长度或校验和不正确。');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(result);
    if(text.includes('\0'))throw Error('README 不是受支持的文本文件。');
    return {path,text};
  }
  async function safely(bytes){try{return await read(bytes);}catch(error){return {message:'README 暂不可读：'+error.message};}}
  async function loaded(zip) {
    try {
      if (!zip?.files || typeof zip.file !== 'function') return {message:'加载器未提供当前运行包的文档。'};
      const path=choose(Object.keys(zip.files));
      if(!path)return {message:'包内未找到 README 或说明文档。'};
      const entry=zip.file(path);
      if(entry?.dir || typeof entry?.internalStream !== 'function')return {message:'此包格式不支持限大小文档预览，请查看作者资料。'};
      const bytes=await new Promise((resolve,reject)=>{
        const stream=entry.internalStream('uint8array'),chunks=[];let size=0,failed=false;
        stream.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>LIMIT){failed=true;stream.pause();reject(Error('README 超过 256 KiB 预览限制。'));return;}chunks.push(chunk);});
        stream.on('error',reject);
        stream.on('end',()=>{if(failed)return;const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}resolve(out);});
        stream.resume();
      });
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(text.includes('\0'))throw Error('README 不是文本。');
      return {path,text};
    } catch(error) {return {message:'README 暂不可读：'+error.message};}
  }
  root.DMCReadme={read:safely,loaded,choose,LIMIT};
})(window);
