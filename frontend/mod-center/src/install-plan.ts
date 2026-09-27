import type {ModInfo} from './bridge';
import type {MarketSelection} from './market-batch';

export interface PlanFinding {id:string;severity:string;title:string;evidence:string[];suggestion:string}
export interface PlanItem {
  name:string;version:string;previous?:string;enabled:boolean;
  sourceKey?:string;sourceUrl?:string;release?:string;asset?:string;
  dependencies:{name:string;version:string}[];
}
export interface InstallPlan {items:PlanItem[];findings:PlanFinding[];loadOrder?:string[];sortWarnings?:string[]}
export interface InstallOutcome {
  kind:'install';status:'not-committed'|'committed'|'unverified'|'binding-pending';
  items:(PlanItem&{binding?:'saved'|'pending'})[];message:string;
}
export function createInstallPlan(items:ModInfo[],current:ModInfo[],disabled:string[],selections:MarketSelection[],findings:PlanFinding[]):InstallPlan {
  if(selections.length&&selections.length!==items.length)throw Error('来源与安装包数量不一致，请重新预检。');
  return {items:items.map((item,index)=>{
    const selected=selections[index],expected=selected?.source.modName;
    if(expected&&expected!==item.name)throw Error('包内模组名称与仓库关联不符：预期 '+expected+'，实际 '+item.name);
    const dependencies=item.bootJson?.dependenceInfo,old=current.find(p=>p.name===item.name);
    return {name:item.name,version:item.version||'未知',previous:old?(old.version||'未知'):undefined,
      enabled:!disabled.includes(item.name),sourceKey:selected?.source.key,sourceUrl:selected?.source.url,
      release:selected?.release.tag,asset:selected?.asset.name,
      dependencies:Array.isArray(dependencies)?dependencies.filter(d=>d&&typeof d.modName==='string').map(d=>({name:d.modName,version:typeof d.version==='string'?d.version:'未声明'})):[]};
  }),findings};
}
export function isCommittedError(error:unknown):boolean {return !!error&&typeof error==='object'&&(error as {committed?:unknown}).committed===true}
/** Storage alone commits the batch; source association is a separate, repairable step. */
export async function commitPreparedInstall(plan:InstallPlan,commit:()=>Promise<unknown>,bind:(key:string,name:string)=>boolean|Promise<boolean>):Promise<InstallOutcome> {
  const items=plan.items.map(item=>({...item,dependencies:item.dependencies.map(d=>({...d}))}));
  try{await commit()}catch(error){return {kind:'install',status:isCommittedError(error)?'unverified':'not-committed',items,message:String(error)}}
  const result:InstallOutcome={kind:'install',status:'committed',items,message:'整批模组已安装，重启游戏后生效。'};
  for(const item of result.items){
    if(!item.sourceKey)continue;
    try{item.binding=await bind(item.sourceKey,item.name)?'saved':'pending'}catch{item.binding='pending'}
  }
  if(result.items.some(item=>item.binding==='pending')){
    result.status='binding-pending';result.message='模组已安装，但部分仓库关联未保存；可在模组市场中重试关联。';
  }
  return result;
}
