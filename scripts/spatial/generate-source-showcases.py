"""Generate NEW authored source-style showcase packages; never edits original fixture receipts."""
from pathlib import Path
from copy import deepcopy
import csv, io, json, hashlib, zipfile
ROOT=Path(__file__).resolve().parents[2]

def csv_bytes(rows,fields):
 stream=io.StringIO(newline=''); writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore',lineterminator='\n');writer.writeheader();writer.writerows(rows);return stream.getvalue().encode()
def json_bytes(value):return (json.dumps(value,indent=2,ensure_ascii=False)+'\n').encode()
def make(profile,path):
 original=json.loads((ROOT/path).read_text());scene=deepcopy(original)
 objects={o['id']:o for o in scene['objects']};geometries={g['id']:g for g in scene['geometries']};frame=deepcopy(scene['frames'][0]);frame.pop('geographicAnchor',None)
 relations=scene['relations'];parents={r['toId']:r['fromId'] for r in relations if r['kind']=='contains'}
 buildings=[o for o in objects.values() if o['type']=='building']
 building_ids={b['id']:f'DEMO-3D-{profile.upper()}-{b["id"]}' for b in buildings}
 parcel_ids={o['id']:f'DEMO-2D-{profile.upper()}-{o["id"]}' for o in objects.values() if o['type']=='parcel'}
 for building in buildings:
  supplied=[o for o in objects.values() if o['type']=='floor' and parents.get(o['id'])==building['id']]
  if supplied:continue
  geometry=geometries.get(building.get('geometryId'));height=geometry.get('heightM') if geometry else None
  count=building.get('attributes',{}).get('floorCount')
  if not isinstance(count,int) or count<1:count=1
  for level in range(count):
   floor_id=f'{building["id"]}-SHOWCASE-F{level}'
   floor={'id':floor_id,'type':'floor','label':f'Ground floor' if level==0 else f'Floor {level}','geometryId':None,'attributes':{'level':level,'buildingId':building['id']}}
   if height is not None and geometry and geometry['type'] in ['Polygon','MultiPolygon']:
    floor_geo=deepcopy(geometry);floor_geo.update(id=f'{floor_id}-shape-v1',objectId=floor_id,version=1,baseElevationM=geometry['baseElevationM']+height*level/count,heightM=height/count)
    geometries[floor_geo['id']]=floor_geo;floor['geometryId']=floor_geo['id']
   objects[floor_id]=floor;parents[floor_id]=building['id']
 for floor in [o for o in list(objects.values()) if o['type']=='floor']:
  if any(o['type']=='space' and parents.get(o['id'])==floor['id'] for o in objects.values()):continue
  unit_id=f'{floor["id"]}-SCHEDULE-UNIT'
  objects[unit_id]={'id':unit_id,'type':'space','label':'Dwelling · schedule only','geometryId':None,'attributes':{'unitType':'residential','geometryEvidence':'schedule_only'}};parents[unit_id]=floor['id']
 role_for={'parcel':'parcels','building':'buildings','floor':'floors','space':'spaces','road':'roads','utility':'utilities','open_area':'public_land'}
 id_key={'parcel':'parcel_id','building':'building_id','floor':'floor_id','space':'unit_id','road':'road_id','utility':'utility_id','open_area':'open_area_id'}
 layers={role:[] for role in role_for.values()}
 floor_ids={}
 for obj in objects.values():
  if obj['type']=='floor':floor_ids[obj['id']]=f'{building_ids[parents[obj["id"]]]}:{obj["attributes"]["level"]}'
 for obj in objects.values():
  typ=obj['type'];role=role_for.get(typ)
  if not role:continue
  geometry=geometries.get(obj.get('geometryId'))
  # A source CSV, not a made-up GeoJSON shape, establishes schedule-only identities.
  if typ in ['floor','space'] and not geometry:continue
  props=deepcopy(obj.get('attributes',{}));props.update({id_key[typ]:obj['id'],'name':obj['label'],'classification':'synthetic','source_revision':'source-showcase-1','geometry_status':'authored_synthetic' if geometry else 'unavailable','geometry_note':'Author-provided fictional geometry; not AI extraction or survey evidence.'})
  if geometry:props.update(geometry_id=geometry['id'],geometry_revision=geometry.get('version',1),base_elevation_m=geometry.get('baseElevationM'),height_m=geometry.get('heightM'),vertical_reference=frame['verticalDatum'])
  if typ=='parcel':props['parcel_2d_demo_id']=parcel_ids[obj['id']]
  elif typ=='building':
   parcel=parents.get(obj['id']) or props.get('parcel_id');props.update(internal_3d_id=building_ids[obj['id']],parcel_id=parcel,parcel_2d_demo_id=parcel_ids.get(parcel),floor_count=props.get('floorCount'))
  elif typ=='floor':props.update(building_id=parents[obj['id']],floor_id=obj['id'],internal_3d_id=floor_ids[obj['id']])
  elif typ=='space':props.update(floor_id=parents[obj['id']],internal_3d_id=f'{floor_ids[parents[obj["id"]]]}:UNIT:{obj["id"]}')
  feature={'type':'Feature','id':obj['id'],'properties':props,'geometry':{'type':geometry['type'],'coordinates':geometry['coordinates']} if geometry else None};layers[role].append(feature)
 schedule=[];residents=[]
 for floor in [o for o in objects.values() if o['type']=='floor']:
  building_id=parents[floor['id']];units=[o for o in objects.values() if o['type']=='space' and parents.get(o['id'])==floor['id']]
  for index,unit in enumerate(units):
   geo=geometries.get(unit.get('geometryId'));unit_type=unit.get('attributes',{}).get('unitType',unit.get('attributes',{}).get('use','residential'))
   unit_3d=f'{floor_ids[floor["id"]]}:UNIT:{unit["id"]}'
   schedule.append({'record_id':f'schedule-{unit["id"]}','building_id':building_id,'parcel_id':parents.get(building_id),'floor_id':floor['id'],'floor_name':floor['label'],'level':floor['attributes']['level'],'floor_3d_id':floor_ids[floor['id']],'unit_id':unit['id'],'unit_name':unit['label'],'unit_type':unit_type,'unit_3d_id':unit_3d,'area_sq_m':geo.get('areaM2','') if geo else '', 'source_plan_file':'authored floor_spaces.geojson' if geo else '', 'geometry_status':'authored_synthetic' if geo else 'schedule_only','classification':'synthetic'})
   if unit_type in ['circulation','parking','shared','common','stair','staircase'] or floor['attributes']['level']<0:continue
   residents.append({'resident_id':f'fictional-resident-{unit["id"]}','name':f'Fictional Resident {building_id} · {floor["attributes"]["level"]}/{index+1}','role':'resident','classification':'synthetic','building_id':building_id,'floor_id':floor['id'],'unit_id':unit['id'],'note':'Fictional occupant schedule; not ownership, identity verification or contact data.'})
 files={};roles={}
 for role,features in layers.items():
  if not features:continue
  filename=f'{role}.geojson';files[filename]=json_bytes({'type':'FeatureCollection','crs':{'type':'name','properties':{'name':frame['name']}},'features':features});roles[filename]=role
 files['floor-schedule.csv']=csv_bytes(schedule,['record_id','building_id','parcel_id','floor_id','floor_name','level','floor_3d_id','unit_id','unit_name','unit_type','unit_3d_id','area_sq_m','source_plan_file','geometry_status','classification']);roles['floor-schedule.csv']='floor_schedule'
 files['fictional-residents.csv']=csv_bytes(residents,['resident_id','name','role','classification','building_id','floor_id','unit_id','note']);roles['fictional-residents.csv']='residents'
 metadata=deepcopy(scene['metadata']);metadata.update(id=f'{metadata["id"]}-SOURCE-SHOWCASE',title=f'{"Lake View" if profile=="anchor" else "Neem Gali" if profile=="dense" else "Neem Quarter"} · fictional source showcase',description='Authored source-style local GeoJSON and CSV demo. All IDs are DEMO identifiers, residents are fictional occupants, and schedule-only units have no invented geometry.',officialIssuance=False)
 manifest={'schemaVersion':'ulpin-source-package/1','classification':'synthetic','metadata':metadata,'frame':frame,'sourceRevision':'source-showcase-1','files':[{'path':name,'role':roles[name],'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in files.items()],'sceneDecoration':scene.get('sceneDecoration')}
 files['source-manifest.json']=json_bytes(manifest)
 files['manifest.json']=json_bytes({'schemaVersion':'source-integrity/1','classification':'synthetic','files':[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in files.items()]})
 output=ROOT/'design/reference-map-v5/data'/f'source-showcase-{profile}';output.mkdir(exist_ok=True)
 for name,data in files.items():(output/name).write_bytes(data)
 zip_path=ROOT/'apps/web/public/reference'/f'showcase-{profile}.zip'
 with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
  for name,data in files.items():
   info=zipfile.ZipInfo(name,date_time=(2026,9,20,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)
 print(json.dumps({'profile':profile,'buildings':len(buildings),'floors':len(floor_ids),'scheduleUnits':len(schedule),'fictionalResidents':len(residents),'zip':str(zip_path.relative_to(ROOT)),'bytes':zip_path.stat().st_size}))
if __name__ == '__main__':
 make('dense','design/reference-map-v5/data/reference-scene.json')
 make('reference','design/reference-map-v5/data/archive/t072-reference-v5/reference-scene.json')
