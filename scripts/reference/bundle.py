"""Portable, deterministic input bundle; no installed IDs, secrets or computed results."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root=Path(__file__).resolve().parents[2]
paths=[]
for folder in ['fixtures/reference-neighborhood','fixtures/complete-demo','apps/web/public/scene-assets/reference','apps/web/public/scene-assets/complete-demo']:
 for p in (root/folder).iterdir():
  if p.is_file() and p.name!='installed.json' and p.suffix.lower() in ['.pdf','.png','.csv','.json','.md','.glb']:
   paths.append(p)
out=root/'fixtures/lake-view-complete-inputs.zip'
with ZipFile(out,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(paths):
  info=ZipInfo(str(p.relative_to(root)),date_time=(2026,9,15,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o644<<16
  z.writestr(info,p.read_bytes())
print(f'{out.name}: {len(paths)} authored inputs; no installed identities or computed results.')
