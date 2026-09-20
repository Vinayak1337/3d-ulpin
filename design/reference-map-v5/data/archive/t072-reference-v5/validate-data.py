#!/usr/bin/env python3
"""Read source files and validate round trips without running app services."""
import base64, csv, hashlib, importlib.util, json, pathlib, sys, zipfile
from jsonschema import Draft202012Validator
from pyproj import Transformer
from shapely.geometry import shape
ROOT=pathlib.Path(__file__).resolve().parent;DATA=ROOT/'data';PKG=ROOT/'dataset';REPO=ROOT.parents[1]
def check(condition,message):
 if not condition:raise AssertionError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def main():
 d=json.loads((DATA/'reference-scene.json').read_text());schema=json.loads((DATA/'schema.json').read_text());Draft202012Validator.check_schema(schema);Draft202012Validator(schema).validate(d)
 collections=['objects','geometries','relations','sources','sourceRecords','observations','lineage','identifierAssertions','batches','issues','rights','frames'];idx={name:{i['id']:i for i in d[name]} for name in collections}
 ids=[i['id'] for name in collections for i in d[name]];check(len(ids)==len(set(ids)),'Duplicate IDs')
 references={'objects':{'geometryId':'geometries','sourceRecordIds':'sourceRecords'},'geometries':{'objectId':'objects','frameId':'frames','lineageId':'lineage','sourceRecordIds':'sourceRecords','supersedesId':'geometries'},'sourceRecords':{'sourceId':'sources'},'lineage':{'inputSourceRecordIds':'sourceRecords','inputGeometryIds':'geometries','outputGeometryId':'geometries'},'relations':{'fromId':'objects','toId':'objects','sourceRecordIds':'sourceRecords'},'observations':{'objectId':'objects','sourceRecordIds':'sourceRecords'},'rights':{'subjectObjectIds':'objects','evidenceSourceRecordIds':'sourceRecords'},'identifierAssertions':{'objectId':'objects','sourceRecordIds':'sourceRecords'},'issues':{'objectIds':'objects','sourceRecordIds':'sourceRecords'},'batches':{'sourceIds':'sources','objectIds':'objects','issueIds':'issues'},'sources':{'frameId':'frames'}}
 for group,fields in references.items():
  for item in d[group]:
   for field,target in fields.items():
    value=item[field]
    for rid in value if isinstance(value,list) else ([] if value is None else [value]):check(rid in idx[target],f'{item["id"]} broken {field}: {rid}')
 geoms={g['objectId']:g for g in d['geometries']};polys={}
 for g in d['geometries']:
  check(idx['objects'][g['objectId']]['geometryId']==g['id'],'Geometry owner mismatch')
  check(g['verticalDatum']==idx['frames'][g['frameId']]['verticalDatum'],'Geometry/frame vertical datum mismatch')
  geometry=shape({'type':g['type'],'coordinates':g['coordinates']});check(geometry.is_valid,f'Invalid geometry {g["id"]}')
  if g['type']=='Polygon':
   check(all(r[0]==r[-1] for r in g['coordinates']),'Unclosed ring');check(abs(geometry.area-g['areaM2'])<1e-7,'Area mismatch');polys[g['objectId']]=geometry
 for o in d['objects']:
  if o['type']=='building':check(polys[o['attributes']['parcel_id']].covers(polys[o['id']]),'Building outside parcel')
  if o['type']=='space':
   floor=geoms[o['attributes']['floorId']];g=geoms[o['id']];check(polys[o['attributes']['floorId']].covers(polys[o['id']]),'Space outside floor');check(g['baseElevationM']>=floor['baseElevationM'] and g['baseElevationM']+g['heightM']<=floor['baseElevationM']+floor['heightM']+1e-7,'Space vertical mismatch')
 buildings=[o for o in d['objects'] if o['type']=='building']
 for i,a in enumerate(buildings):
  for b in buildings[i+1:]:check(polys[a['id']].intersection(polys[b['id']]).area<1e-7,'Buildings overlap')
 spaces=[o for o in d['objects'] if o['type']=='space']
 for i,a in enumerate(spaces):
  for b in spaces[i+1:]:
   if a['attributes']['floorId']==b['attributes']['floorId']:check(polys[a['id']].intersection(polys[b['id']]).area<1e-7,'Sibling spaces overlap')
 check(geoms['B12']['heightM'] is None and idx['objects']['B12']['attributes']['floorCount'] is None,'Unknown height fabricated')
 check(len(d['issues'])==1 and d['issues'][0]['objectIds']==['B12'],'Pending issue drift')
 for s in d['sources']:
  raw=(ROOT/s['originalUri']).read_bytes();check(sha(raw)==s['originalSha256'] and len(raw)==s['byteSize'],'Source fingerprint/size mismatch')
 for l in d['lineage']:
  raw=json.dumps(idx['sourceRecords'][l['inputSourceRecordIds'][0]]['attributes'],sort_keys=True,separators=(',',':')).encode();check(sha(raw)==l['inputFingerprint'],'Lineage fingerprint mismatch')
 # Actual source files -> reconstructed normalized features. No input from master coordinates.
 mapping=json.loads((PKG/'import-mapping.json').read_text());origin=mapping['transformation']['projectedOriginM'];inverse=Transformer.from_crs(4326,32643,always_xy=True);max_error=0.0;reimported={}
 for p in sorted(PKG.glob('*.geojson')):
  source=json.loads(p.read_text());check(source['type']=='FeatureCollection' and 'crs' not in source,'GeoJSON is not RFC7946')
  for f in source['features']:
   props=f['properties'];oid=props['object_id'];check(oid==f['id'] and oid not in reimported,'Lost/duplicate source identity');check(props['classification']=='synthetic','Lost synthetic status')
   def local(pos):
    x,y=inverse.transform(*pos);return [x-origin[0],y-origin[1]]
   coords=[list(map(local,r)) for r in f['geometry']['coordinates']] if f['geometry']['type']=='Polygon' else list(map(local,f['geometry']['coordinates']))
   if f['geometry']['type']=='LineString' and 'vertex_elevations_m' in props:coords=[pt+[z] for pt,z in zip(coords,props['vertex_elevations_m'])]
   reconstructed={'type':f['geometry']['type'],'coordinates':coords};expected={'type':geoms[oid]['type'],'coordinates':geoms[oid]['coordinates']};error=shape(reconstructed).hausdorff_distance(shape(expected));max_error=max(error,max_error);check(error<=1e-6,'Geometry round-trip error')
   check(props['height_m']==geoms[oid]['heightM'] and props['base_elevation_m']==geoms[oid]['baseElevationM'],'Height/base round-trip changed')
   check(f==idx['sourceRecords']['SR-'+oid]['attributes'],'Raw record no longer matches source feature')
   reimported[oid]={'id':oid,'geometry':reconstructed,'heightM':props['height_m'],'baseElevationM':props['base_elevation_m']}
 check(set(reimported)==set(idx['objects']),'Round-trip object identity set changed')
 with (PKG/'floor_schedule.csv').open(newline='') as fh:
  rows=list(csv.DictReader(fh));check(len(rows)==len(spaces),'CSV schedule count mismatch')
  for row in rows:check(abs(float(row['area_sq_m'])-geoms[row['space_id']]['areaM2'])<1e-6,'CSV area assertion mismatch')
 with (PKG/'survey_controls.csv').open(newline='') as fh:
  for row in csv.DictReader(fh):
   x,y=inverse.transform(float(row['longitude']),float(row['latitude']));check(abs(x-origin[0]-float(row['local_x_m']))<1e-6 and abs(y-origin[1]-float(row['local_y_m']))<1e-6,'Control transformation mismatch')
 manifest=json.loads((PKG/'manifest.json').read_text())
 check({f['path'] for f in manifest['files']}=={p.name for p in PKG.iterdir() if p.is_file() and p.name!='manifest.json'},'Manifest inventory mismatch')
 for f in manifest['files']:
  raw=(PKG/f['path']).read_bytes();check(sha(raw)==f['sha256'] and len(raw)==f['bytes'],'Manifest hash/length mismatch')
 with zipfile.ZipFile(DATA/'neem-reference-dataset.zip') as z:
  check(z.testzip() is None,'ZIP CRC failure');check(set(z.namelist())=={p.name for p in PKG.iterdir() if p.is_file()},'ZIP file inventory mismatch')
  for name in z.namelist():check(z.read(name)==(PKG/name).read_bytes(),'ZIP source bytes changed')
 with zipfile.ZipFile(DATA/'neem-reference-gis.zip') as z:
  check(z.testzip() is None,'GIS ZIP CRC failure')
  for name in z.namelist():check(z.read(name)==(PKG/name).read_bytes(),'GIS ZIP source bytes changed')
 check(json.loads((PKG/'normalized.json').read_text())==d,'Package/scene normalized data differ')
 # Existing real app adapter, called as pure functions: no DB or network writes.
 sys.path.insert(0,str(REPO/'services/geo'))
 from geo.gis_inspection import inspect_gis
 from geo.area import normalize_area
 app_checks=[]
 for filename,kind in [('buildings.geojson','building'),('parcels.geojson','parcel'),('roads.geojson','road'),('open_areas.geojson','public_land'),('utilities.geojson','utility')]:
  raw=(PKG/filename).read_bytes();inspection=inspect_gis({'base64':base64.b64encode(raw).decode()});source=json.loads(raw)
  fields={'kind':kind,'idField':'object_id','nameField':'name'}
  if kind=='building':fields.update(heightField='height_m',heightUnit='m')
  result=normalize_area({'format':'geojson','data':source,'mapping':fields,'worldStatus':'synthetic','reference':{'sourceCrs':'EPSG:4326','analysisCrs':'EPSG:32643','origin':origin}})
  check(inspection['featureCount']==len(source['features']),'App inspection count mismatch')
  for row in result['features']:
   check(row['sourceKey'] in reimported and row['worldStatus']=='synthetic','App identity/classification mismatch');check(shape(row['geometry']).hausdorff_distance(shape(reimported[row['sourceKey']]['geometry']))<1e-6,'App local geometry changed')
   if kind=='building':check(row['height']['value']==geoms[row['sourceKey']]['heightM'],'App height changed')
  app_checks.append({'file':filename,'kind':kind,'featureCount':len(result['features']),'sourceCrs':inspection['sourceCrs']})
 report={'status':'passed','schema':'passed','objects':len(d['objects']),'buildings':len(buildings),'spaces':len(spaces),'sources':len(d['sources']),'sourceFilesRoundTripped':6,'roundTripObjectCount':len(reimported),'maxRoundTripErrorM':max_error,'hashesAndZipContents':'passed','pendingHeightPreserved':True,'existingAppPureAdapterChecks':app_checks,'limitations':['No live application ingestion or database writes performed.','Floor/space source adapter is this package round-trip; existing area adapter has no floor/space kind.','Existing app checks verify horizontal geometry and building-relative heights, not preservation of this custom vertical datum or complete raw properties.','ZIP is a package to extract or use with prototype adapter, not a Shapefile ZIP accepted by the existing native-GIS upload route.']}
 (DATA/'validation-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
