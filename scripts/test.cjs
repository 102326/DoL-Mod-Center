const {spawnSync}=require('node:child_process');
for(const name of ['diagnostic-assistant','install-recovery','recovery-boundaries','markdown','package-info','dependency-sort','storage','emergency-storage','journal-summary','sort-storage','preload-storage','beauty-storage']){const r=spawnSync(process.execPath,['mods/mod-center-v1/tests/'+name+'.test.cjs'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1)}
const market=spawnSync(process.execPath,['frontend/mod-center/tests/market-service.cjs'],{stdio:'inherit'});if(market.status!==0)process.exit(market.status??1);
const wiki=spawnSync(process.execPath,['frontend/mod-center/tests/wiki-source.cjs'],{stdio:'inherit'});if(wiki.status!==0)process.exit(wiki.status??1);
const order=spawnSync(process.execPath,['frontend/mod-center/tests/market-order.cjs'],{stdio:'inherit'});if(order.status!==0)process.exit(order.status??1);
for(const name of ['market-batch','install-plan','local-library']){const result=spawnSync(process.execPath,['frontend/mod-center/tests/'+name+'.cjs'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1)}
const batchOrder=spawnSync(process.execPath,['mods/mod-center-v1/tests/batch-order.test.cjs'],{stdio:'inherit'});if(batchOrder.status!==0)process.exit(batchOrder.status??1);
