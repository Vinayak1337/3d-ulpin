"""Authored reconstruction of REF-01 composition, not recovered survey geometry."""
from pathlib import Path
import json, random, importlib.util
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('showcases',Path(__file__).with_name('generate-source-showcases.py'));gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)
old=json.loads((ROOT/'design/reference-map-v5/data/archive/t072-reference-v5/reference-scene.json').read_text())
frame=dict(old['frames'][0]);frame.pop('geographicAnchor',None);frame.update(id='FRAME-LAKE-VIEW-DEMO',name='LOCAL-LAKE-VIEW-DEMO-M',nativeCrs='LOCAL-LAKE-VIEW-DEMO-M')
d={'schemaVersion':'1.0.0','metadata':{'id':'LAKE-VIEW-ANCHOR-DEMO','title':'Lake View · reference reconstruction','classification':'synthetic','description':'Authored from REF-01 visual composition. Not its original dataset, a real location or survey.','focalObjectId':'B01','extent':[-26,-26,191,204],'officialIssuance':False},'frames':[frame],'objects':[],'geometries':[],'relations':[],'sceneDecoration':{'classification':'synthetic_visual_decoration','urbanForm':'open_block','ground':'grass','plotWalls':True,'trees':[],'cars':[],'buildingStyles':{},'parkPaths':[],'architecture':{'roofEquipment':{'maxHeightAboveRoofM':1.8}},'camera':{'direction':[.85,1.65,1.45],'distanceM':156,'focusOffset':[-3,0,13]}}}
def ring(x,y,w,h):return [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]
def add(id,typ,label,coords,height=0,base=0,attrs=None,gtype='Polygon'):
 gid=f'{id}-shape-v1';d['objects'].append({'id':id,'type':typ,'label':label,'geometryId':gid,'attributes':attrs or {}});d['geometries'].append({'id':gid,'objectId':id,'version':1,'frameId':frame['id'],'verticalDatum':frame['verticalDatum'],'type':gtype,'coordinates':[coords] if gtype=='Polygon' else coords,'baseElevationM':base,'heightM':height});return id
# The public park sits in the foreground left of the focal building, matching REF-01.
roads=[('R01','Lake View Road',ring(-26,96,217,10)),('R02','Park Lane',ring(94,-26,9,230)),('R03','5th Main Road',ring(-26,17,217,10)),('R04','Lake View Lane',ring(47,56,144,8)),('R05','Garden Lane',ring(-26,137,217,8))]
for id,name,poly in roads:add(id,'road',name,poly,attrs={'road_class':'local_street'})
add('PARK01','open_area','Public Park · demo',ring(9,28,37,67),attrs={'use':'park','ownership':'not asserted'})
# Tight plots and varied three-to-five storey buildings; dimensions are authored demo values.
plots=[(66,64,27,31,5)]
for y,h in [(65,30),(107,29),(0,16),(146,12)]:
 for x,w in [(7,18),(28,18),(49,16),(69,23),(105,22),(130,23)]:
  if y==65 and x==69:continue
  if y==65 and x in [7,28]:continue
  plots.append((x,y,w,h,3+(len(plots)%3)))
for x,w in [(65,27),(105,22),(130,23)]:plots.append((x,28,w,27,3+(len(plots)%2)))
for x in [-24,166]:
 for y in [28,65,107,146,177]:plots.append((x,y,23,27,3+(len(plots)%2)))
for y in [-24,177]:
 for x in [7,29,51,73,106,133]:plots.append((x,y,20,24,3+(len(plots)%2)))
plots.extend([(-24,-24,23,24,3),(166,-24,23,24,4)])
for i,(x,y,w,h,levels) in enumerate(plots,1):
 bid=f'B{i:02d}';pid=f'P{i:02d}';add(pid,'parcel',f'Plot {i:02d}',ring(x,y,w,h),attrs={'landUse':'residential'})
 bx,by,bw,bh=x+2,y+2,min(w-4,17),min(h-4,19)
 if i==1:bx,by,bw,bh=68,62.8,18,21.2
 # Recessed entrance and stepped roof outlines preserve a real polygon silhouette.
 poly=[[bx,by],[bx+bw,by],[bx+bw,by+bh],[bx+bw*.64,by+bh],[bx+bw*.64,by+bh-1.8],[bx,by+bh-1.8],[bx,by]]
 add(bid,'building','Lake View Residence' if i==1 else f'Lake View House {i:02d}',poly,levels*3.1,attrs={'use':'residential','floorCount':levels,'address':f'{12 if i==1 else i*2}, Lake View Road · fictional','parcel_id':pid})
 d['relations'].append({'fromId':pid,'toId':bid,'kind':'contains'})
 d['sceneDecoration']['buildingStyles'][bid]={'wallColor':['#e7e9e6','#e0e5e5','#e8e5dc','#dce3e6'][i%4],'palette':1,'frontEdges':[0,1],'hasBalconies':True,'roofCore':True}
 if i==1:
  # Authored floor/unit shapes use the same source schema as other importable files.
  for level in [-1,0,1,2,3,4]:
   fid=f'B01-F{level if level>=0 else "B"}';add(fid,'floor','Basement' if level<0 else 'Ground floor' if level==0 else f'Floor {level}',poly,3.1,level*3.1,{'level':level,'buildingId':bid});d['relations'].append({'fromId':bid,'toId':fid,'kind':'contains'})
   if level>=0:
    for j,(ux,uw) in enumerate([(bx+.3,8.1),(bx+9.6,8.1)],1):
     uid=f'{fid}-U{j}';add(uid,'space',f'Apartment {level+1}0{j}',ring(ux,by+.3,uw,17.8),2.9,level*3.1,{'use':'residential','level':level,'floorId':fid});d['relations'].append({'fromId':fid,'toId':uid,'kind':'contains'})
# Source utility alignment, shallow below the road; no fabricated clearance assertion.
add('UT01','utility','Water pipeline · demo',[[3,60,-1.8],[98.5,60,-1.8],[98.5,154,-1.8]],None,None,{'use':'water','diameterM':.28},'LineString')
r=random.Random(1078)
# Dense soft crowns around perimeter/setbacks and park, clear of source footprints.
buildings=[g['coordinates'][0] for g in d['geometries'] if g['objectId'].startswith('B') and '-F' not in g['objectId']]
def inside(x,y,poly):
 c=False
 for a,b in zip(poly,poly[1:]):
  if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:c=not c
 return c
candidates=[]
for x in range(8,158,6):
 for y in [29,53,66,94,108,135,147]:candidates.append((x+r.uniform(-1,1),y+r.uniform(-.6,.6)))
for x in [5,26,47,63,92,105,128,156]:
 for y in range(31,135,9):candidates.append((x+r.uniform(-.6,.6),y))
for _ in range(24):candidates.append((r.uniform(12,58),r.uniform(32,50)))
for x,y in candidates:
 if 94<=x<=103 or 56<=y<=64 or 96<=y<=106:continue
 if any(inside(x,y,p) for p in buildings):continue
 if 12<x<43 and 31<y<92 and r.random()>.15:continue
 d['sceneDecoration']['trees'].append({'position':[round(x,2),round(y,2)],'heightM':round(r.uniform(5,8),2),'radiusM':round(r.uniform(1.8,2.9),2)})
d['sceneDecoration']['cars']=[{'position':[x,100.2],'heading':90} for x in [22,58,116]]+[{'position':[99.8,y],'heading':0} for y in [39,82,123]]
path=ROOT/'design/reference-map-v5/data/anchor-authored-scene.json';path.write_text(json.dumps(d,indent=2)+'\n')
gen.make('anchor',str(path.relative_to(ROOT)))
print('trees',len(d['sceneDecoration']['trees']))
