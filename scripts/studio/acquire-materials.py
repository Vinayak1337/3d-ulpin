"""Acquire a finite CC0 asset set once; runtime never calls a third-party API."""
from pathlib import Path
import hashlib, json, urllib.request

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'apps/web/public/studio-materials'
OUT.mkdir(parents=True,exist_ok=True)
UA={'User-Agent':'3D-ULPIN-Studio-Reference-Review/1.0'}
ASSETS=[('kloppenheim_06_puresky','hdri','hdr','daylight.hdr'),
 ('leafy_grass','Diffuse','jpg','grass-color.jpg'),('leafy_grass','nor_gl','jpg','grass-normal.jpg'),
 ('asphalt_02','Diffuse','jpg','asphalt-color.jpg'),('asphalt_02','nor_gl','jpg','asphalt-normal.jpg')]
metadata={};receipts=[]
for asset,channel,fmt,name in ASSETS:
 if asset not in metadata:
  with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/'+asset,headers=UA),timeout=30) as r:metadata[asset]=json.load(r)
 item=metadata[asset][channel]['1k'][fmt]
 if item['size']>4*1024*1024:raise ValueError('Asset exceeds the offline texture budget')
 target=OUT/name
 data=target.read_bytes() if target.exists() else None
 if data is None or hashlib.md5(data).hexdigest()!=item['md5']:
  if not item['url'].startswith('https://dl.polyhaven.org/file/ph-assets/'):raise ValueError('Unexpected asset host')
  with urllib.request.urlopen(urllib.request.Request(item['url'],headers=UA),timeout=45) as r:data=r.read(4*1024*1024+1)
  if len(data)!=item['size'] or hashlib.md5(data).hexdigest()!=item['md5']:raise ValueError('Asset byte verification failed')
  target.write_bytes(data)
 receipts.append({'asset':asset,'channel':channel,'file':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'source':item['url'],'page':'https://polyhaven.com/a/'+asset,'license':'CC0-1.0','licenseSource':'https://polyhaven.com/license'})
(OUT/'SOURCES.json').write_text(json.dumps({'purpose':'Lighting and surface materials only, never property evidence or imagery of this neighbourhood','provider':'Poly Haven','files':receipts},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'assets':len(receipts),'bytes':sum(x['bytes'] for x in receipts),'verified':True}))
