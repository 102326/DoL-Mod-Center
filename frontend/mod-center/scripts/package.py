from pathlib import Path
import json,zipfile,hashlib
root=Path(__file__).resolve().parent.parent
project=root.parent.parent
legacy=project/'mods/mod-center-v1/src'
boot=json.loads((legacy/'boot.json').read_text(encoding='utf-8'))
boot['version']='2.0.0'
boot['scriptFileList']=[name for name in boot['scriptFileList'] if name!='manager-ui.js']
assets={}
for key in ['scriptFileList','styleFileList','tweeFileList','imgFileList','additionFile']:
 for name in boot.get(key,[]):
  source=(legacy/name).resolve()
  assert source.is_relative_to(legacy.resolve())
  assets[name]=source.read_bytes()
boot['scriptFileList'].append('ui.js');boot['styleFileList'].append('ui.css')
for name in ['ui.js','ui.css']:assets[name]=(root/'dist'/name).read_bytes()
notices=[]
for name in ['vue','tailwindcss'] + ['@vue/'+p.name for p in sorted((root/'node_modules/@vue').iterdir()) if p.is_dir()]:
 folder=root/'node_modules'/name
 license=next(iter(folder.glob('LICENSE*')))
 notices.append(name+'\n'+license.read_text(encoding='utf-8'))
assets['THIRD-PARTY-NOTICES.txt']='\n\n'.join(notices).encode()
assets['README.md']=(root/'README.md').read_bytes()
boot['additionFile'].append('THIRD-PARTY-NOTICES.txt')
assets['boot.json']=json.dumps(boot,ensure_ascii=False,indent=2).encode()
name='DoLModCenter-'+boot['version']+'.mod.zip'
out=root/'dist'/name
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for key,value in sorted(assets.items()):
  item=zipfile.ZipInfo(key,(2026,1,1,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED;z.writestr(item,value)
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 assert set(z.namelist())==set(assets)
 assert all(z.read(k)==v for k,v in assets.items())
release=project/'releases/mods'/name
# Build only the artifact matching the declared version.
release.parent.mkdir(parents=True,exist_ok=True)
release.write_bytes(out.read_bytes())
print(json.dumps({'file':str(release),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'members':len(assets)}))
