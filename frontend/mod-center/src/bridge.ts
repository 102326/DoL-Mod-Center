export interface ModInfo {name:string;version?:string;bootJson?:Record<string,unknown>;error?:string}
export interface State {enabled:string[];disabled:string[];packages:string[];loaded:ModInfo[];preloaded:ModInfo[];missing:string[];orphans:string[];revision:string;writable:boolean;reason?:string}
export interface Catalog {items:ModInfo[];preloaded:ModInfo[];enabled:string[];disabled:string[]}
export type Token=object;
export interface BatchOrderContext {enabled:string[];disabled:string[];items:ModInfo[];preloaded:ModInfo[];fixedNames:string[]}
export interface Storage {
 prepareInstallBatch(state:State,inputs:Uint8Array[],options?:{order:(context:BatchOrderContext)=>string[]|Promise<string[]>}):Promise<{items:ModInfo[];names:string[];enabled:string[];disabled:string[]}>;
 installBatch(token:object):Promise<State>;readRecovery():Promise<any>;prepareRecovery():Promise<object>;rollbackRecovery(token:object):Promise<State>;dismissRecovery(id:string):Promise<void>;
 read():Promise<State>;catalog(state:State):Promise<Catalog>;
 prepare(state:State,name:string):Promise<Token>;inspect(bytes:Uint8Array):Promise<ModInfo>;
 install(token:Token,bytes:Uint8Array):Promise<State>;remove(token:Token,name:string):Promise<State>;
 toggle(state:State,name:string,on:boolean):Promise<State>;move(state:State,name:string,index:number):Promise<State>;
 reorderCatalog(token:Catalog,order:string[]):Promise<State>;exportZip(name:string):Promise<Uint8Array>;
 details(name:string):Promise<ModInfo>;loadedDetails(name:string):Promise<ModInfo>;
}
// Existing, tested modules own storage and their DOM. Vue owns only their host elements.
export const runtime=window as typeof window & Record<string,any>;
export function storage():Storage{return runtime.DMCJournal.wrap(runtime.DMCStorage.create(window));}
export const emptyState=():State=>({enabled:[],disabled:[],packages:[],loaded:[],preloaded:[],missing:[],orphans:[],revision:'',writable:false});
export async function download(bytes:Uint8Array,name:string){
 const blob=new Blob([new Uint8Array(bytes).buffer],{type:name.endsWith('.txt')?'text/plain;charset=utf-8':'application/zip'});
 if(runtime.cordova?.plugins?.saveDialog?.saveFile)await runtime.cordova.plugins.saveDialog.saveFile(blob,name);
 else {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
}
