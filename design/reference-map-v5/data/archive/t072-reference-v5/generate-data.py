#!/usr/bin/env python3
"""Reproducible authored fictional neighborhood + source package; no app services."""
import csv, hashlib, io, json, math, pathlib, zipfile
from pyproj import Transformer
ROOT=pathlib.Path(__file__).resolve().parent; DATA=ROOT/'data'; PKG=ROOT/'dataset'
ORIGIN=[714000.0,3160000.0]
TO_WORLD=Transformer.from_crs('EPSG:32643','EPSG:4326',always_xy=True)
TO_LOCAL=Transformer.from_crs('EPSG:4326','EPSG:32643',always_xy=True)
FRAME='FRAME-NEEM-REFERENCE'; REV='fictional-v1'
VERTICAL_DATUM='DEMO-BM-01 fictional zero datum; not national MSL'
def encode(x):return (json.dumps(x,indent=2,ensure_ascii=False,allow_nan=False)+'\n').encode()
def digest(x):return hashlib.sha256(x).hexdigest()
def ring(r):return r if r[0]==r[-1] else r+[r[0]]
def area(r):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(r,r[1:])))/2

def main():
 DATA.mkdir(exist_ok=True);PKG.mkdir(exist_ok=True)
 d={'schemaVersion':'1.0.0','metadata':{'id':'NEEM-REFERENCE-FICTIONAL-01','title':'Neem Quarter · Reference neighborhood','classification':'synthetic','description':'Authored fictional geometry with synthetic WGS84 placement; no real properties or field survey.','focalObjectId':'B01','extent':[0,0,180,180],'officialIssuance':False},'frames':[{'id':FRAME,'name':'LOCAL-NEEM-REFERENCE-M','kind':'local_cartesian','horizontalUnit':'metre','verticalUnit':'metre','axisOrder':['east','north','up'],'nativeCrs':'EPSG:32643','verticalDatum':VERTICAL_DATUM,'geographicAnchor':{'method':'UTM translation','projectedCrs':'EPSG:32643','eastingM':ORIGIN[0],'northingM':ORIGIN[1],'classification':'synthetic_placement'}}],'objects':[],'geometries':[],'relations':[],'sources':[],'sourceRecords':[],'observations':[],'lineage':[],'identifierAssertions':[],'batches':[],'issues':[],'rights':[],'sceneDecoration':{'classification':'synthetic_visual_decoration','trees':[],'buildingStyles':{},'architecture':{'classification':'synthetic_visual_decoration','maxFacadeInsetM':0.9,'roofEquipmentWithinFootprint':True,'roofEquipment':{'classification':'synthetic_visual_decoration','maxHeightAboveRoofM':2.1,'withinFootprint':True,'analyticalGeometry':False},'analyticalGeometry':False},'parkPaths':[]}}
 groups={k:[] for k in ['buildings','parcels','floor_spaces','roads','utilities','open_areas']}
 def add(id,typ,label,coords,height=0,base=0,attrs=None,group='buildings',gtype='Polygon'):
  coords=[ring(coords)] if gtype=='Polygon' else coords
  a=area(coords[0]) if gtype=='Polygon' else None
  attrs=attrs or {};sid='SRC-'+group.upper();rid='SR-'+id;gid='G-'+id+'-v1'
  d['objects'].append({'id':id,'type':typ,'label':label,'systemId':'fictional:3d:'+id,'geometryId':gid,'status':'needs_review' if id=='B12' else 'ready','sourceRecordIds':[rid],'attributes':attrs})
  d['geometries'].append({'id':gid,'objectId':id,'version':1,'supersedesId':None,'frameId':FRAME,'nativeCrs':'EPSG:4326','verticalDatum':VERTICAL_DATUM,'type':gtype,'coordinates':coords,'baseElevationM':base,'heightM':height,'areaM2':a,'status':'draft','classification':'synthetic','sourceRecordIds':[rid],'lineageId':'LIN-'+id})
  def pos(p):
   lon,lat=TO_WORLD.transform(ORIGIN[0]+p[0],ORIGIN[1]+p[1]);return [lon,lat]
  world=[list(map(pos,r)) for r in coords] if gtype=='Polygon' else list(map(pos,coords))
  props={'object_id':id,'object_type':typ,'name':label,'classification':'synthetic','source_revision':REV,'height_m':height,'base_elevation_m':base,'area_sq_m':a,'frame_id':FRAME,**attrs}
  if gtype=='LineString' and coords and len(coords[0])==3:props['vertex_elevations_m']=[p[2] for p in coords]
  feature={'type':'Feature','id':id,'properties':props,'geometry':{'type':gtype,'coordinates':world}};groups[group].append(feature)
  d['sourceRecords'].append({'id':rid,'sourceId':sid,'sourceRevision':REV,'recordKey':id,'locator':group+'.geojson#'+id,'attributes':feature})
  raw=json.dumps(feature,sort_keys=True,separators=(',',':')).encode()
  d['lineage'].append({'id':'LIN-'+id,'operation':'wgs84_to_authored_local','inputSourceRecordIds':[rid],'inputGeometryIds':[],'outputGeometryId':gid,'parameters':{'from':'EPSG:4326','via':'EPSG:32643','axisOrder':'longitude,latitude','subtractProjectedOriginM':ORIGIN,'verticalTransform':'none; fictional zero datum','syntheticPlacement':True},'softwareVersion':'reference-map-v5/1','inputFingerprint':digest(raw),'reviewStatus':'fixture_only'})
  if typ in ['building','space']:
   for field,val,unit in [('heightM',height,'metre'),('areaM2',a,'square_metre')]:d['observations'].append({'id':'OBS-'+id+'-'+field,'objectId':id,'field':field,'value':val,'unit':unit,'method':'authored_synthetic' if val is not None else 'not_supplied','sourceRecordIds':[rid],'status':'fixture_only' if val is not None else 'unreviewed','observedAt':None,'uncertainty':None})
  return id
 def rel(a,b,kind='contains'):
  d['relations'].append({'id':f'REL-{len(d["relations"])+1:03d}','fromId':a,'toId':b,'kind':kind,'status':'fixture_only','sourceRecordIds':['SR-'+b],'validFrom':None,'validTo':None})
 placements=[(78,78)]+[(x,y) for y in [8,33] for x in [8,32,73,97,137,158]]+[(x,y) for y in [76,101] for x in [8,32,137,158]]+[(x,y) for y in [138,158] for x in [8,32,74]][:6]+[(98,138)]
 names=['Neem House','Peepal Residence','Corner House','Ashok Apartments','Mango Court','Garden Residence']
 focal=[[78,78],[94,78],[94,96],[88,96],[88,94],[78,94]]
 for i,(x,y) in enumerate(placements,1):
  bid=f'B{i:02d}';pid=f'P{i:02d}';w=16 if i==1 else [14,16,13,15,14,12][i%6];dep=18 if i==1 else [16,17,15,18,16][i%5]
  fp=focal if i==1 else ([[x,y],[x+w-2,y],[x+w,y+2],[x+w,y+dep],[x+3,y+dep],[x+3,y+dep-3],[x,y+dep-3]] if i%3==0 else [[x,y],[x+w,y],[x+w,y+dep-3],[x+w-3,y+dep-3],[x+w-3,y+dep],[x,y+dep]])
  floors=5 if i==1 else [3,4,5,4,6][i%5];height=None if i==12 else round(floors*3.1,1)
  parcel=[[x-2,y-2],[x+w+2,y-2],[x+w+2,y+dep+2],[x-2,y+dep+2]]
  add(pid,'parcel',f'Plot {i:02d}',parcel,attrs={'landUse':'residential','building_ids':bid},group='parcels')
  add(bid,'building','Neem House' if i==1 else f'{names[i%len(names)]} {i:02d}',fp,height,attrs={'use':'residential','floorCount':None if i==12 else floors,'address':f'{i:02d} Neem Quarter','parcel_id':pid})
  rel(pid,bid)
  d['sceneDecoration']['buildingStyles'][bid]={'palette':i%5,'style':['plaster','warm_concrete','brick_accent'][i%3],'frontEdge':0,'roofCore':i!=12,'hasBalconies':i%3!=0,'classification':'synthetic_visual_decoration'}
 for level in [-1,0,1,2,3,4]:
  fid='B01-FB' if level==-1 else f'B01-F{level}';base=round(level*3.1,1)
  add(fid,'floor','Basement' if level==-1 else ('Ground floor' if level==0 else f'Floor {level}'),focal,3.1,base,{'level':level,'buildingId':'B01'},'floor_spaces');rel('B01',fid)
  if level==-1:specs=[('C','Basement parking',[[78.3,78.3],[93.7,78.3],[93.7,95.7],[88.3,95.7],[88.3,93.7],[78.3,93.7]],'parking')]
  else:specs=[('U1',f'Apartment {level+1}01',[[78.3,78.3],[85.4,78.3],[85.4,93.7],[78.3,93.7]],'residential'),('U2',f'Apartment {level+1}02',[[86.6,78.3],[93.7,78.3],[93.7,95.7],[88.3,95.7],[88.3,93.7],[86.6,93.7]],'residential'),('C','Shared circulation',[[85.5,78.3],[86.5,78.3],[86.5,93.7],[85.5,93.7]],'common')]
  for suffix,label,poly,use in specs:
   sid=f'{fid}-{suffix}';add(sid,'space',label,poly,2.9,base,{'level':level,'floorId':fid,'buildingId':'B01','use':use,'bedrooms':2 if use=='residential' else None},'floor_spaces');rel(fid,sid)
 roads=[('R01','Neem Avenue',[[0,56],[180,56],[180,68],[0,68]],[[0,62],[180,62]],12),('R02','Park Road',[[55,0],[65,0],[65,180],[55,180]],[[60,0],[60,180]],10),('R03','Garden Lane',[[0,122],[180,122],[180,130],[0,130]],[[0,126],[180,126]],8),('R04','East Lane',[[120,0],[128,0],[128,180],[120,180]],[[124,0],[124,180]],8)]
 for id,label,poly,line,w in roads:add(id,'road',label,poly,0,0,{'widthM':w,'centerline':line,'centerlineFrameId':FRAME,'surface':'asphalt'},'roads')
 parks=[('PARK01','Neem Garden',[[99,70],[118,70],[118,120],[99,120]]),('PARK02','East Grove',[[132,136],[174,136],[174,175],[132,175]])]
 for id,label,poly in parks:add(id,'open_area',label,poly,0,0,{'use':'park'},'open_areas')
 add('UT01','utility','Water main',[[8,62,-2.2],[124,62,-2.2],[124,100,-2.2]],None,None,{'service':'water','diameterM':0.25,'depthM':2.2},'utilities',gtype='LineString')
 add('UT02','utility','Neem House service',[[86,62,-2.2],[86,78,-2.2]],None,None,{'service':'water','diameterM':0.12,'depthM':2.2},'utilities',gtype='LineString');rel('UT02','B01','serves');rel('UT02','P01','crosses')
 # Decorations are authored display data, not measured infrastructure.
 trees=[[x,y] for x in [103,113] for y in [75,85,97,109,116]]+[[x,y] for x in [137,146,157,168] for y in [141,152,165,171]]+[[x,71] for x in [6,25,44,137,151,171]]+[[x,133] for x in [8,28,46,75,94,110]]+[[68,y] for y in [8,27,44,82,104,147,171]]
 d['sceneDecoration']['trees']=trees
 d['sceneDecoration']['parkPaths']=[{'parkId':'PARK01','widthM':1.6,'path':[[108,70],[108,120]]},{'parkId':'PARK02','widthM':2,'path':[[132,156],[174,156]]}]
 d['sceneDecoration']['camera']={'focus':[87,89,7.5],'position':[205,225,155],'northAxis':[0,1,0]}
 d['issues']=[{'id':'ISSUE-01','code':'MISSING_BUILDING_HEIGHT','severity':'blocking','status':'open','objectIds':['B12'],'sourceRecordIds':['SR-B12'],'field':'heightM','title':'Building height is missing','description':'Known footprint; height and floor count are absent. Keep footprint-only display and exclude from solid analysis.','allowedActions':['defer','exclude_from_batch','attach_height_evidence'],'resolution':None}]
 d['identifierAssertions']=[{'id':'ID-P01','objectId':'P01','scheme':'official_2d_ulpin','value':None,'issuer':None,'status':'unavailable','sourceRecordIds':[],'note':'No official identifier supplied or issued.'}]
 d['rights']=[{'id':'RIGHT-01','kind':'access','label':'Fictional shared circulation','subjectObjectIds':[f'B01-F{i}-C' for i in range(5)],'beneficiary':'Fictional occupants','evidenceSourceRecordIds':['SR-B01-F0-C'],'status':'unverified','legalAuthority':None,'validFrom':None,'validTo':None,'note':'Synthetic design assertion, not legal evidence.'}]
 modalities={'buildings':'GIS','parcels':'GIS','floor_spaces':'plan','roads':'GIS','utilities':'utility','open_areas':'GIS'}
 for name,features in groups.items():
  filename=name+'.geojson';raw=encode({'type':'FeatureCollection','name':'FICTIONAL '+name,'features':features});(PKG/filename).write_bytes(raw)
  sid='SRC-'+name.upper();d['sources'].append({'id':sid,'label':filename,'modality':modalities[name],'mimeType':'application/geo+json','classification':'synthetic','representation':'original_file','revision':REV,'originalUri':'dataset/'+filename,'originalSha256':digest(raw),'byteSize':len(raw),'nativeCrs':'EPSG:4326','frameId':FRAME,'verticalDatum':VERTICAL_DATUM,'acquiredAt':None,'rasterMetadata':None,'pointCloudMetadata':None,'note':'Actual authored downloadable source bytes. WGS84 placement is synthetic, not real survey evidence.'})
  objs=[f['id'] for f in features];d['batches'].append({'id':'BATCH-'+name.upper(),'label':name.replace('_',' ').title(),'sourceIds':[sid],'objectIds':objs,'stage':'review' if 'B12' in objs else 'ready','idempotencyKey':'neem-reference:'+name+':'+digest(raw),'mappingVersion':'reference-map-v5/1','issueIds':['ISSUE-01'] if 'B12' in objs else [],'commitPolicy':'ready_objects_only_after_explicit_review','classification':'synthetic'})
 # Real schedule/control CSVs, original local master and reproducible import map.
 out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(['space_id','building_id','floor_id','level','name','use','area_sq_m','base_elevation_m','height_m','classification'])
 for o in d['objects']:
  if o['type']=='space':
   g=next(g for g in d['geometries'] if g['objectId']==o['id']);writer.writerow([o['id'],'B01',o['attributes']['floorId'],o['attributes']['level'],o['label'],o['attributes']['use'],round(g['areaM2'],6),g['baseElevationM'],g['heightM'],'synthetic'])
 (PKG/'floor_schedule.csv').write_text(out.getvalue())
 out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(['control_id','local_x_m','local_y_m','local_z_m','longitude','latitude','projected_crs','vertical_datum','classification'])
 for i,(x,y,z) in enumerate([(0,0,0),(180,0,0),(0,180,0),(180,180,0),(86,78,0)],1):
  lon,lat=TO_WORLD.transform(ORIGIN[0]+x,ORIGIN[1]+y);writer.writerow([f'CP{i:02d}',x,y,z,lon,lat,'EPSG:32643',VERTICAL_DATUM,'synthetic'])
 (PKG/'survey_controls.csv').write_text(out.getvalue())
 for filename,modality in [('floor_schedule.csv','plan'),('survey_controls.csv','survey_control')]:
  raw=(PKG/filename).read_bytes();d['sources'].append({'id':'SRC-'+filename.split('.')[0].upper(),'label':filename,'modality':modality,'mimeType':'text/csv','classification':'synthetic','representation':'original_file','revision':REV,'originalUri':'dataset/'+filename,'originalSha256':digest(raw),'byteSize':len(raw),'nativeCrs':'EPSG:4326' if modality=='survey_control' else None,'frameId':FRAME,'verticalDatum':VERTICAL_DATUM,'acquiredAt':None,'rasterMetadata':None,'pointCloudMetadata':None,'note':'Authored fictional supporting CSV; values are not real survey observations.'})
 (DATA/'reference-scene.json').write_bytes(encode(d))
 master={'scene_id':d['metadata']['id'],'revision':REV,'classification':'synthetic','design_note':'Independent authored fictional neighborhood, not derived real properties.','frame':d['frames'][0],'objects':d['objects'],'geometries':d['geometries'],'relations':d['relations'],'sceneDecoration':d['sceneDecoration']}
 (PKG/'MASTER_SCENE.json').write_bytes(encode(master));(PKG/'normalized.json').write_bytes(encode(d))
 mapping={'schemaVersion':'1','classification':'synthetic','fieldMapping':{'idField':'object_id','nameField':'name','heightField':'height_m','heightUnit':'m','kind':'building'},'sourceCrs':'EPSG:4326','canonicalFrame':d['frames'][0],'transformation':{'method':'EPSG4326 to EPSG32643 with always_xy; subtract projected origin','projectedOriginM':ORIGIN,'roundTripToleranceM':0.000001,'vertical':'per-feature authored base_elevation_m; utility vertex_elevations_m; no geoid transform'},'preserveNullHeight':True,'identityNamespace':d['metadata']['id'],'unmappedAttributes':'preserve entire source feature','fileRoles':{'buildings.geojson':'existing app building footprint import','parcels.geojson':'parcel layer','floor_spaces.geojson':'normalized floor/space adapter input','roads.geojson':'surface polygons with explicit local centerline metadata','utilities.geojson':'2D line + separate authored elevations','open_areas.geojson':'park polygons','floor_schedule.csv':'space assertions cross-check','survey_controls.csv':'synthetic frame check','MASTER_SCENE.json':'local authored baseline','normalized.json':'full normalized exchange snapshot'}}
 (PKG/'import-mapping.json').write_bytes(encode(mapping))
 schema=json.loads((ROOT.parent/'bulk-studio-v4/schema.json').read_text());schema['$id']='https://example.invalid/ulpin/reference-map-v5/schema/1.0.0';schema['$defs']['sceneDecoration']['additionalProperties']=True;(DATA/'schema.json').write_bytes(encode(schema));(PKG/'schema.json').write_bytes(encode(schema))
 (PKG/'README.md').write_text('''# Fictional Neem Quarter source package

All data is authored synthetic demonstration material. Geographic placement is fictional and conveys no relationship to real properties or official ULPINs.

Use buildings.geojson with the existing GIS import: kind=building, ID=object_id, name=name, height=height_m, heightUnit=m, worldStatus=synthetic. All GeoJSON geometry coordinates are WGS84 longitude/latitude. For exact canonical local coordinates retain EPSG:32643 analysis CRS with projected origin [714000,3160000] metres. See import-mapping.json. Null B12 height remains unknown.

Other native supported source layers: parcels.geojson (parcel), roads.geojson (road), open_areas.geojson (public_land), utilities.geojson (utility). Do not map height_m for these surface/line layers. Floor/space hierarchy and custom vertical datum require the normalized exchange adapter; the existing area importer does not support floor/space kinds. floor_spaces.geojson and floor_schedule.csv preserve explicit authored unit outlines and stated areas, unlike the supplied Drive specimen whose unit outlines were unavailable.

The ZIP is a dataset container, not a Shapefile ZIP. Extract a GeoJSON layer for the existing application, or load normalized.json with the isolated prototype. No app seed or database is included. MASTER_SCENE.json is the authored local baseline. schema.json validates normalized.json; manifest.json records SHA-256 and lengths of every other file. survey_controls.csv is a synthetic transformation check, not observed GNSS.
''')
 manifest={'datasetId':d['metadata']['id'],'revision':REV,'classification':'synthetic','notOfficialEvidence':True,'files':[{'path':p.name,'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size} for p in sorted(PKG.iterdir()) if p.is_file() and p.name!='manifest.json']}
 (PKG/'manifest.json').write_bytes(encode(manifest))
 for name,filenames in [('neem-reference-dataset.zip',[p.name for p in sorted(PKG.iterdir()) if p.is_file()]),('neem-reference-gis.zip',['buildings.geojson','parcels.geojson','roads.geojson','open_areas.geojson','import-mapping.json'])]:
  with zipfile.ZipFile(DATA/name,'w',zipfile.ZIP_DEFLATED) as z:
   for filename in filenames:
    info=zipfile.ZipInfo(filename,date_time=(2026,9,20,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,(PKG/filename).read_bytes())
 (DATA/'downloads.json').write_bytes(encode([{'label':name,'href':'data/'+name,'bytes':(DATA/name).stat().st_size,'sha256':digest((DATA/name).read_bytes())} for name in ['neem-reference-dataset.zip','neem-reference-gis.zip']]))
 print(json.dumps({'objects':len(d['objects']),'buildings':len(groups['buildings']),'floors':sum(o['type']=='floor' for o in d['objects']),'spaces':sum(o['type']=='space' for o in d['objects']),'trees':len(trees),'sources':len(d['sources']),'zipBytes':(DATA/'neem-reference-dataset.zip').stat().st_size}))
if __name__=='__main__':main()
