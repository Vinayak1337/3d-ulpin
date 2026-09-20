#!/usr/bin/env python3
"""Reproducible authored fictional neighborhood + source package; no app services."""
import csv, hashlib, io, json, math, pathlib, zipfile
from pyproj import Transformer
import shapely
from shapely.geometry import shape, mapping as shape_mapping
from shapely.ops import unary_union
ROOT=pathlib.Path(__file__).resolve().parent; DATA=ROOT/'data'; PKG=ROOT/'dataset'
ORIGIN=[714000.0,3160000.0]
TO_WORLD=Transformer.from_crs('EPSG:32643','EPSG:4326',always_xy=True)
TO_LOCAL=Transformer.from_crs('EPSG:4326','EPSG:32643',always_xy=True)
FRAME='FRAME-NEEM-REFERENCE'; REV='fictional-dense-v2'
VERTICAL_DATUM='DEMO-BM-01 fictional zero datum; not national MSL'
def encode(x):return (json.dumps(x,indent=2,ensure_ascii=False,allow_nan=False)+'\n').encode()
def digest(x):return hashlib.sha256(x).hexdigest()
def ring(r):return r if r[0]==r[-1] else r+[r[0]]
def area(r):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(r,r[1:])))/2

def main():
 DATA.mkdir(exist_ok=True);PKG.mkdir(exist_ok=True)
 d={'schemaVersion':'1.0.0','metadata':{'id':'NEEM-DENSE-FICTIONAL-02','title':'Neem Gali · Dense fictional block','classification':'synthetic','description':'Authored fictional geometry with synthetic WGS84 placement; no real properties or field survey.','focalObjectId':'B01','extent':[0,0,120,115],'officialIssuance':False},'frames':[{'id':FRAME,'name':'LOCAL-NEEM-REFERENCE-M','kind':'local_cartesian','horizontalUnit':'metre','verticalUnit':'metre','axisOrder':['east','north','up'],'nativeCrs':'EPSG:32643','verticalDatum':VERTICAL_DATUM,'geographicAnchor':{'method':'UTM translation','projectedCrs':'EPSG:32643','eastingM':ORIGIN[0],'northingM':ORIGIN[1],'classification':'synthetic_placement'}}],'objects':[],'geometries':[],'relations':[],'sources':[],'sourceRecords':[],'observations':[],'lineage':[],'identifierAssertions':[],'batches':[],'issues':[],'rights':[],'sceneDecoration':{'classification':'synthetic_visual_decoration','urbanForm':'dense_plotted','ground':'paved','plotWalls':False,'trees':[],'buildingStyles':{},'architecture':{'classification':'synthetic_visual_decoration','maxFacadeInsetM':0.9,'roofEquipmentWithinFootprint':True,'roofEquipment':{'classification':'synthetic_visual_decoration','maxHeightAboveRoofM':2.1,'withinFootprint':True,'analyticalGeometry':False},'analyticalGeometry':False},'parkPaths':[]}}
 groups={k:[] for k in ['buildings','parcels','floor_spaces','roads','utilities','open_areas']}
 def add(id,typ,label,coords,height=0,base=0,attrs=None,group='buildings',gtype='Polygon'):
  coords=[ring(coords)] if gtype=='Polygon' else coords
  a=area(coords[0]) if gtype=='Polygon' else None
  attrs=attrs or {};sid='SRC-'+group.upper();rid='SR-'+id;gid='G-'+id+'-v1'
  d['objects'].append({'id':id,'type':typ,'label':label,'systemId':'fictional:dense:3d:'+id,'geometryId':gid,'status':'needs_review' if id=='B12' else 'ready','sourceRecordIds':[rid],'attributes':attrs})
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
 # 84 regular 8x16m cells; two focal cells become one plot, one becomes pocket public land.
 regular=[(x,y) for y in [0,19,38,57,76,95] for x in list(range(0,56,8))+list(range(64,120,8)) if (x,y) not in [(40,38),(48,38),(64,38)]]
 placements=[(40,38)]+regular
 names=['Neem House','Gali Residence','Corner House','Ashok House','Mango House','Courtyard House']
 def remap_focal(poly):return [[round(x-78+40,8),round((y-78)*17/18+37,8)] for x,y in poly]
 focal=remap_focal([[78,78],[94,78],[94,96],[88,96],[88,94],[78,94]])
 for i,(x,y) in enumerate(placements,1):
  bid=f'B{i:02d}';pid=f'P{i:02d}';w=16 if i==1 else 8;dep=16
  # Full side-wall attachment; small entrance/rear notches vary the actual polygons.
  if i==1:fp=focal
  elif i%4==0:fp=[[x,y+.25],[x+8,y+.25],[x+8,y+16],[x+5,y+16],[x+5,y+15],[x+2,y+15],[x+2,y+16],[x,y+16]]
  elif i%4==1:fp=[[x,y],[x+3,y],[x+3,y+.6],[x+5,y+.6],[x+5,y],[x+8,y],[x+8,y+16],[x,y+16]]
  else:fp=[[x,y+.2],[x+8,y+.2],[x+8,y+16],[x,y+16]]
  if i==3:fp=[[round(px-.6,8),py] for px,py in fp] # Deliberate 0.6m intrusion into adjacent B02.
  floors=5 if i==1 else [3,4,5,4][i%4];height=None if i==12 else round(floors*3.1,1)
  parcel=[[x,y],[x+w,y],[x+w,y+dep],[x,y+dep]]
  add(pid,'parcel',f'Plot {i:02d}',parcel,attrs={'landUse':'residential','building_ids':bid},group='parcels')
  add(bid,'building','Neem House' if i==1 else f'{names[i%len(names)]} {i:02d}',fp,height,attrs={'use':'residential','floorCount':None if i==12 else floors,'address':f'{i:02d} Neem Gali','parcel_id':pid})
  rel(pid,bid)
  d['sceneDecoration']['buildingStyles'][bid]={'palette':i%5,'style':['plaster','warm_concrete','brick_accent'][i%3],'frontEdge':0,'roofCore':i!=12,'hasBalconies':i%3!=0,'classification':'synthetic_visual_decoration'}
 for level in [-1,0,1,2,3,4]:
  fid='B01-FB' if level==-1 else f'B01-F{level}';base=round(level*3.1,1)
  add(fid,'floor','Basement' if level==-1 else ('Ground floor' if level==0 else f'Floor {level}'),focal,3.1,base,{'level':level,'buildingId':'B01'},'floor_spaces');rel('B01',fid)
  if level==-1:specs=[('C','Basement parking',[[78.3,78.3],[93.7,78.3],[93.7,95.7],[88.3,95.7],[88.3,93.7],[78.3,93.7]],'parking')]
  else:specs=[('U1',f'Apartment {level+1}01',[[78.3,78.3],[85.4,78.3],[85.4,93.7],[78.3,93.7]],'residential'),('U2',f'Apartment {level+1}02',[[86.6,78.3],[93.7,78.3],[93.7,95.7],[88.3,95.7],[88.3,93.7],[86.6,93.7]],'residential'),('C','Shared circulation',[[85.5,78.3],[86.5,78.3],[86.5,93.7],[85.5,93.7]],'common')]
  for suffix,label,poly,use in specs:
   sid=f'{fid}-{suffix}';add(sid,'space',label,remap_focal(poly),2.9,base,{'level':level,'floorId':fid,'buildingId':'B01','use':use,'bedrooms':2 if use=='residential' else None},'floor_spaces');rel(fid,sid)
 roads=[('R01','Collector street',[[56,0],[64,0],[64,115],[56,115]],[[60,0],[60,115]],8)]
 for n,y in enumerate([16,35,54,73,92,112],2):roads.append((f'R{n:02d}',f'Gali {n-1}',[[0,y],[120,y],[120,y+3],[0,y+3]],[[0,y+1.5],[120,y+1.5]],3))
 for id,label,poly,line,w in roads:add(id,'road',label,poly,0,0,{'widthM':w,'centerline':line,'centerlineFrameId':FRAME,'surface':'paved','streetClass':'collector' if id=='R01' else 'gali'},'roads')
 add('PARK01','open_area','Pocket public court',[[64,38],[72,38],[72,54],[64,54]],0,0,{'use':'pocket_public_area'},'open_areas')
 add('UT01','utility','Water main',[[60,0,-2.2],[60,115,-2.2]],None,None,{'service':'water','diameterM':0.25,'depthM':2.2},'utilities',gtype='LineString')
 add('UT02','utility','Neem House service',[[60,36.5,-2.2],[48,36.5,-2.2],[48,38,-2.2]],None,None,{'service':'water','diameterM':0.12,'depthM':2.2},'utilities',gtype='LineString');rel('UT02','B01','serves');rel('UT02','P01','crosses')
 trees=[[68,42],[68,50]]
 d['sceneDecoration']['trees']=trees
 d['sceneDecoration']['cars']=[{'position':[59,12],'heading':0},{'position':[61,80],'heading':0},{'position':[59,103],'heading':0}]
 d['sceneDecoration']['parkPaths']=[]
 d['sceneDecoration']['camera']={'focus':[49,46,7.5],'position':[142,165,112],'northAxis':[0,1,0]}
 d['issues']=[{'id':'ISSUE-01','code':'MISSING_BUILDING_HEIGHT','severity':'blocking','status':'open','objectIds':['B12'],'sourceRecordIds':['SR-B12'],'field':'heightM','title':'Building height is missing','description':'Known footprint; height and floor count are absent. Keep footprint-only display and exclude from solid analysis.','allowedActions':['defer','exclude_from_batch','attach_height_evidence'],'resolution':None}]
 # Exact planar checks in the declared local metre frame, never arbitrary red painting.
 gs={g['objectId']:g for g in d['geometries']};objs={o['id']:o for o in d['objects']}
 polys={oid:shape({'type':g['type'],'coordinates':g['coordinates']}) for oid,g in gs.items() if g['type']=='Polygon'}
 bids=[o['id'] for o in d['objects'] if o['type']=='building'];rids=[o['id'] for o in d['objects'] if o['type']=='road']
 pairs=[];outside=[];road_hits=[];adj={bid:set() for bid in bids};tol=1e-7
 def evidence(kind,bid,other,result,inputids):
  overlap=None
  if kind=='building_overlap':
   a,b=gs[bid],gs[other]
   if all(v is not None for v in [a['baseElevationM'],a['heightM'],b['baseElevationM'],b['heightM']]):overlap=max(0,min(a['baseElevationM']+a['heightM'],b['baseElevationM']+b['heightM'])-max(a['baseElevationM'],b['baseElevationM']))
  polygon=shape_mapping(result);multi=polygon if polygon['type']=='MultiPolygon' else {'type':'MultiPolygon','coordinates':[polygon['coordinates']]}
  return {'frameId':FRAME,'verticalDatum':VERTICAL_DATUM,'method':'shapely','softwareVersion':shapely.__version__,'computedFromGeometryIds':inputids,'geometryRefs':[{'objectId':k,'geometryId':gs[k]['id'],'version':gs[k]['version']} for k in [bid,other]],'areaM2':result.area,'volumeM3':result.area*overlap if overlap is not None else None,'verticalRelation':'overlap' if overlap is not None else 'surface','overlapHeightM':overlap,'toleranceM':.001,'areaToleranceM2':.000001,'intersectionGeometry':multi,'legalFinding':False,'otherObjectId':other,'relation':kind}
 def issue(code,bid,other,result,title,kind):
  ev=evidence(kind,bid,other,result,[gs[bid]['id'],gs[other]['id']])
  d['issues'].append({'id':f'spatial:{code}:{bid}:{other}','origin':'spatial-preview','code':code,'severity':'blocking','status':'open','objectIds':[bid,other],'sourceRecordIds':['SR-'+bid,'SR-'+other],'field':'geometry','title':title,'description':'Computed positive-area spatial conflict in authored fictional geometry. It is not an ownership or legal finding.','allowedActions':['defer','exclude_from_batch','attach_source_evidence','correct_mapping'],'resolution':None,'evidence':ev})
  objs[bid]['status']='needs_review'
  if objs[other]['type']=='building':objs[other]['status']='needs_review'
 for i,a in enumerate(bids):
  for b in bids[i+1:]:
   hit=polys[a].intersection(polys[b]);shared=polys[a].boundary.intersection(polys[b].boundary).length
   if hit.area>tol:
    pairs.append({'fromId':a,'toId':b,'classification':'positive_area_overlap','areaM2':hit.area,'sharedBoundaryLengthM':shared,'intersectionGeometry':shape_mapping(hit)})
    issue('BUILDING_OVERLAP',a,b,hit,f'{a} and {b} footprints overlap','building_overlap');adj[a].add(b);adj[b].add(a)
   elif shared>tol:
    pairs.append({'fromId':a,'toId':b,'classification':'shared_boundary','areaM2':0,'sharedBoundaryLengthM':shared,'intersectionGeometry':shape_mapping(hit)})
    adj[a].add(b);adj[b].add(a)
 for bid in bids:
  pid=objs[bid]['attributes']['parcel_id'];diff=polys[bid].difference(polys[pid])
  if diff.area>tol:
   outside.append({'buildingId':bid,'parcelId':pid,'areaM2':diff.area,'geometry':shape_mapping(diff)});issue('OUTSIDE_PARCEL',bid,pid,diff,f'{bid} extends beyond its linked plot','outside_parcel')
  for rid in rids:
   hit=polys[bid].intersection(polys[rid])
   if hit.area>tol:
    road_hits.append({'buildingId':bid,'roadId':rid,'areaM2':hit.area,'geometry':shape_mapping(hit)});issue('ROAD_OVERLAP',bid,rid,hit,f'{bid} overlaps the lane by {hit.area:.2f} m²','road_overlap')
 blocks=[];seen=set()
 for bid in bids:
  if bid in seen:continue
  component=[];todo=[bid]
  while todo:
   current=todo.pop()
   if current in seen:continue
   seen.add(current);component.append(current);todo.extend(sorted(adj[current]-seen))
  component=sorted(component);union=unary_union([polys[k] for k in component])
  blocks.append({'id':f'BLOCK-{len(blocks)+1:02d}','objectIds':component,'computedFromGeometryIds':[gs[k]['id'] for k in component],'unionGeometry':shape_mapping(union),'areaM2':union.area,'classification':'derived_building_union','identityPolicy':'Display grouping only; individual object IDs retained.'})
 d['spatialChecks']={'frameId':FRAME,'method':'shapely','softwareVersion':shapely.__version__,'toleranceM2':tol,'buildingPairs':pairs,'parcelEncroachments':outside,'roadOverlaps':road_hits,'blocks':blocks}
 (DATA/'spatial-checks.json').write_bytes(encode(d['spatialChecks']));(PKG/'spatial-checks.json').write_bytes(encode(d['spatialChecks']))
 d['identifierAssertions']=[{'id':'ID-P01','objectId':'P01','scheme':'official_2d_ulpin','value':None,'issuer':None,'status':'unavailable','sourceRecordIds':[],'note':'No official identifier supplied or issued.'}]
 d['rights']=[{'id':'RIGHT-01','kind':'access','label':'Fictional shared circulation','subjectObjectIds':[f'B01-F{i}-C' for i in range(5)],'beneficiary':'Fictional occupants','evidenceSourceRecordIds':['SR-B01-F0-C'],'status':'unverified','legalAuthority':None,'validFrom':None,'validTo':None,'note':'Synthetic design assertion, not legal evidence.'}]
 modalities={'buildings':'GIS','parcels':'GIS','floor_spaces':'plan','roads':'GIS','utilities':'utility','open_areas':'GIS'}
 for name,features in groups.items():
  filename=name+'.geojson';raw=encode({'type':'FeatureCollection','name':'FICTIONAL '+name,'features':features});(PKG/filename).write_bytes(raw)
  sid='SRC-'+name.upper();d['sources'].append({'id':sid,'label':filename,'modality':modalities[name],'mimeType':'application/geo+json','classification':'synthetic','representation':'original_file','revision':REV,'originalUri':'dataset/'+filename,'originalSha256':digest(raw),'byteSize':len(raw),'nativeCrs':'EPSG:4326','frameId':FRAME,'verticalDatum':VERTICAL_DATUM,'acquiredAt':None,'rasterMetadata':None,'pointCloudMetadata':None,'note':'Actual authored downloadable source bytes. WGS84 placement is synthetic, not real survey evidence.'})
  objs=[f['id'] for f in features];d['batches'].append({'id':'BATCH-'+name.upper(),'label':name.replace('_',' ').title(),'sourceIds':[sid],'objectIds':objs,'stage':'review' if any(set(i['objectIds'])&set(objs) for i in d['issues']) else 'ready','idempotencyKey':'neem-reference:'+name+':'+digest(raw),'mappingVersion':'reference-map-v5/1','issueIds':[i['id'] for i in d['issues'] if set(i['objectIds'])&set(objs)],'commitPolicy':'ready_objects_only_after_explicit_review','classification':'synthetic'})
 # Real schedule/control CSVs, original local master and reproducible import map.
 out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(['space_id','building_id','floor_id','level','name','use','area_sq_m','base_elevation_m','height_m','classification'])
 for o in d['objects']:
  if o['type']=='space':
   g=next(g for g in d['geometries'] if g['objectId']==o['id']);writer.writerow([o['id'],'B01',o['attributes']['floorId'],o['attributes']['level'],o['label'],o['attributes']['use'],round(g['areaM2'],6),g['baseElevationM'],g['heightM'],'synthetic'])
 (PKG/'floor_schedule.csv').write_text(out.getvalue())
 out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(['control_id','local_x_m','local_y_m','local_z_m','longitude','latitude','projected_crs','vertical_datum','classification'])
 for i,(x,y,z) in enumerate([(0,0,0),(120,0,0),(0,115,0),(120,115,0),(48,38,0)],1):
  lon,lat=TO_WORLD.transform(ORIGIN[0]+x,ORIGIN[1]+y);writer.writerow([f'CP{i:02d}',x,y,z,lon,lat,'EPSG:32643',VERTICAL_DATUM,'synthetic'])
 (PKG/'survey_controls.csv').write_text(out.getvalue())
 for filename,modality in [('floor_schedule.csv','plan'),('survey_controls.csv','survey_control')]:
  raw=(PKG/filename).read_bytes();d['sources'].append({'id':'SRC-'+filename.split('.')[0].upper(),'label':filename,'modality':modality,'mimeType':'text/csv','classification':'synthetic','representation':'original_file','revision':REV,'originalUri':'dataset/'+filename,'originalSha256':digest(raw),'byteSize':len(raw),'nativeCrs':'EPSG:4326' if modality=='survey_control' else None,'frameId':FRAME,'verticalDatum':VERTICAL_DATUM,'acquiredAt':None,'rasterMetadata':None,'pointCloudMetadata':None,'note':'Authored fictional supporting CSV; values are not real survey observations.'})
 (DATA/'reference-scene.json').write_bytes(encode(d))
 master={'scene_id':d['metadata']['id'],'revision':REV,'classification':'synthetic','design_note':'Independent authored fictional neighborhood, not derived real properties.','frame':d['frames'][0],'objects':d['objects'],'geometries':d['geometries'],'relations':d['relations'],'sceneDecoration':d['sceneDecoration'],'spatialChecks':d['spatialChecks']}
 (PKG/'MASTER_SCENE.json').write_bytes(encode(master));(PKG/'normalized.json').write_bytes(encode(d))
 mapping={'schemaVersion':'1','classification':'synthetic','fieldMapping':{'idField':'object_id','nameField':'name','heightField':'height_m','heightUnit':'m','kind':'building'},'sourceCrs':'EPSG:4326','canonicalFrame':d['frames'][0],'transformation':{'method':'EPSG4326 to EPSG32643 with always_xy; subtract projected origin','projectedOriginM':ORIGIN,'roundTripToleranceM':0.000001,'vertical':'per-feature authored base_elevation_m; utility vertex_elevations_m; no geoid transform'},'preserveNullHeight':True,'identityNamespace':d['metadata']['id'],'unmappedAttributes':'preserve entire source feature','fileRoles':{'buildings.geojson':'existing app building footprint import','parcels.geojson':'parcel layer','floor_spaces.geojson':'normalized floor/space adapter input','roads.geojson':'surface polygons with explicit local centerline metadata','utilities.geojson':'2D line + separate authored elevations','open_areas.geojson':'park polygons','floor_schedule.csv':'space assertions cross-check','survey_controls.csv':'synthetic frame check','MASTER_SCENE.json':'local authored baseline','normalized.json':'full normalized exchange snapshot'}}
 (PKG/'import-mapping.json').write_bytes(encode(mapping))
 schema=json.loads((ROOT.parent/'bulk-studio-v4/schema.json').read_text());schema['$id']='https://example.invalid/ulpin/reference-map-v5/dense-schema/1.0.0';schema['$defs']['sceneDecoration']['additionalProperties']=True
 localGeometry={'type':'object','required':['type','coordinates'],'properties':{'type':{'enum':['Point','LineString','MultiLineString','Polygon','MultiPolygon']},'coordinates':{'type':'array'}},'additionalProperties':False}
 evidenceSchema={'type':'object','required':['frameId','verticalDatum','method','softwareVersion','computedFromGeometryIds','geometryRefs','areaM2','volumeM3','verticalRelation','overlapHeightM','toleranceM','areaToleranceM2','intersectionGeometry','legalFinding','otherObjectId','relation'],'properties':{'frameId':{'type':'string'},'verticalDatum':{'type':'string'},'method':{'const':'shapely'},'softwareVersion':{'type':'string'},'computedFromGeometryIds':{'type':'array','items':{'type':'string'},'minItems':2},'geometryRefs':{'type':'array','items':{'type':'object','required':['objectId','geometryId','version'],'properties':{'objectId':{'type':'string'},'geometryId':{'type':'string'},'version':{'type':'integer','minimum':1}},'additionalProperties':False}},'areaM2':{'type':'number','exclusiveMinimum':0},'volumeM3':{'type':['number','null'],'minimum':0},'verticalRelation':{'enum':['overlap','surface','unknown']},'overlapHeightM':{'type':['number','null'],'minimum':0},'toleranceM':{'type':'number','minimum':0},'areaToleranceM2':{'type':'number','minimum':0},'intersectionGeometry':localGeometry,'legalFinding':{'const':False},'otherObjectId':{'type':'string'},'relation':{'enum':['building_overlap','road_overlap','outside_parcel']}},'additionalProperties':False}
 schema['$defs']['issue']['properties']['origin']={'const':'spatial-preview'}
 schema['$defs']['issue']['properties']['evidence']=evidenceSchema
 pairSchema={'type':'object','required':['fromId','toId','classification','areaM2','sharedBoundaryLengthM','intersectionGeometry'],'properties':{'fromId':{'type':'string'},'toId':{'type':'string'},'classification':{'enum':['shared_boundary','positive_area_overlap']},'areaM2':{'type':'number','minimum':0},'sharedBoundaryLengthM':{'type':'number','minimum':0},'intersectionGeometry':localGeometry},'additionalProperties':False,'allOf':[{'if':{'properties':{'classification':{'const':'shared_boundary'}}},'then':{'properties':{'areaM2':{'const':0}}}}]}
 def regionSchema(other):return {'type':'object','required':['buildingId',other,'areaM2','geometry'],'properties':{'buildingId':{'type':'string'},other:{'type':'string'},'areaM2':{'type':'number','exclusiveMinimum':0},'geometry':localGeometry},'additionalProperties':False}
 blockSchema={'type':'object','required':['id','objectIds','computedFromGeometryIds','unionGeometry','areaM2','classification','identityPolicy'],'properties':{'id':{'type':'string'},'objectIds':{'type':'array','minItems':1,'uniqueItems':True,'items':{'type':'string'}},'computedFromGeometryIds':{'type':'array','minItems':1,'uniqueItems':True,'items':{'type':'string'}},'unionGeometry':localGeometry,'areaM2':{'type':'number','exclusiveMinimum':0},'classification':{'const':'derived_building_union'},'identityPolicy':{'type':'string'}},'additionalProperties':False}
 schema['properties']['spatialChecks']={'type':'object','required':['frameId','method','softwareVersion','toleranceM2','buildingPairs','parcelEncroachments','roadOverlaps','blocks'],'properties':{'frameId':{'type':'string'},'method':{'const':'shapely'},'softwareVersion':{'type':'string'},'toleranceM2':{'type':'number','minimum':0},**{k:{'type':'array','items':definition} for k,definition in [('buildingPairs',pairSchema),('parcelEncroachments',regionSchema('parcelId')),('roadOverlaps',regionSchema('roadId')),('blocks',blockSchema)]}},'additionalProperties':False}
 schema['required'].append('spatialChecks');(DATA/'schema.json').write_bytes(encode(schema));(PKG/'schema.json').write_bytes(encode(schema))
 (PKG/'README.md').write_text('''# Fictional Neem Gali dense source package

All data is authored synthetic demonstration material. This dense T073 specimen replaces the active layout; the prior T072 scene and ZIP are archived separately. Shared walls are valid zero-area contacts; building overlap, road overlap and parcel encroachment are computed in spatial-checks.json and issues[].evidence. Union blocks group render geometry while preserving independent building identities. Geographic placement is fictional and conveys no relationship to real properties or official ULPINs.

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
 print(json.dumps({'objects':len(d['objects']),'buildings':len(groups['buildings']),'floors':sum(o['type']=='floor' for o in d['objects']),'spaces':sum(o['type']=='space' for o in d['objects']),'trees':len(trees),'sources':len(d['sources']),'zipBytes':(DATA/'neem-reference-dataset.zip').stat().st_size,'issues':len(d['issues']),'sharedWalls':sum(p['classification']=='shared_boundary' for p in pairs),'positiveBuildingOverlaps':sum(p['classification']=='positive_area_overlap' for p in pairs),'roadOverlaps':len(road_hits),'parcelEncroachments':len(outside),'unionBlocks':len(blocks)}))
if __name__=='__main__':main()
