export interface LibraryFile {
 id:string;
 name:string;
 size:number;
 modified:number;
 file:File;
}

const MAX_FILES=100;
const MAX_BYTES=256*1024*1024;

export function validateFiles(value:unknown):LibraryFile[]{
 if(!Array.isArray(value)||value.length>MAX_FILES)throw Error('一次最多选择 100 个 ZIP。');
 const ids=new Set<string>();
 return value.map(item=>{
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.name!=='string'||!item.name||item.name.length>512||!/\.zip$/i.test(item.name)||!Number.isSafeInteger(item.size)||item.size<0||!Number.isSafeInteger(item.modified)||item.modified<0||!(item.file instanceof File)||item.file.name!==item.name||item.file.size!==item.size||item.file.lastModified!==item.modified)throw Error('ZIP 文件资料无效，请重新选择。');
  ids.add(item.id);
  return item as LibraryFile;
 });
}

export function validateSelection(files:LibraryFile[]):number{
 const valid=validateFiles(files);
 if(!valid.length)throw Error('请至少选择一个 ZIP。');
 const total=valid.reduce((sum,file)=>sum+file.size,0);
 if(total>MAX_BYTES)throw Error('所选 ZIP 总大小不超过 256 MiB。');
 return total;
}

export async function readLibraryFiles(files:LibraryFile[],options:{signal?:AbortSignal;progress?:(text:string)=>void}={}):Promise<Uint8Array[]>{
 validateSelection(files);
 const check=()=>{if(options.signal?.aborted)throw Error('已取消读取，未安装模组。')};
 const results:Uint8Array[]=[];
 for(let index=0;index<files.length;index++){
  check();
  const file=files[index].file;
  const bytes=new Uint8Array(await file.arrayBuffer());
  check();
  if(bytes.byteLength!==file.size)throw Error('文件读取大小发生变化，请重新选择。');
  results.push(bytes);
  options.progress?.(`${index+1} / ${files.length} · ${file.name} · ${(bytes.byteLength/1048576).toFixed(1)} MiB`);
 }
 check();
 return results;
}
