const {spawnSync}=require('node:child_process');
for(const name of ['markdown','package-info','dependency-sort','storage','emergency-storage','journal-summary','sort-storage','preload-storage','beauty-storage']){const r=spawnSync(process.execPath,['mods/mod-center-v1/tests/'+name+'.test.cjs'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1)}
