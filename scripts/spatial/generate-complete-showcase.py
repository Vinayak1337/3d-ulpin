"""Create a NEW fictional source bundle. Existing source receipts are never rewritten.
Run with .runtime/t079-venv/bin/python (requirements-complete-showcase.txt).
"""
from pathlib import Path
import csv, io, json, hashlib, zipfile
import numpy as np
from PIL import Image, ImageDraw
import rasterio
from rasterio.transform import from_origin
from rasterio.features import rasterize
import laspy, fiona
from shapely.geometry import shape, mapping, LineString
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'design/reference-map-v5/data/lake-view-complete'
OUT.mkdir(parents=True,exist_ok=True)
base=ROOT/'design/reference-map-v5/data/source-showcase-anchor'
manifest=json.loads((base/'source-manifest.json').read_text())
files={f['path']:(base/f['path']).read_bytes() for f in manifest['files']}
entries={f['path']:dict(f) for f in manifest['files']}
frame=manifest['frame']; revision='lake-view-complete-1'; extent=[-26,-26,194,204]
jbytes=lambda v:(json.dumps(v,indent=2,ensure_ascii=False)+'\n').encode()
sha=lambda b:hashlib.sha256(b).hexdigest()
def add(path,data,role='evidence',mime='application/json',objects=None,description=None):
 if isinstance(data,str):data=data.encode()
 files[path]=data;entries[path]={'path':path,'role':role,'mimeType':mime,'bytes':len(data),'sha256':sha(data)}
 if objects:entries[path]['objectIds']=objects
 if description:entries[path]['description']=description
 return path
def csvdata(rows,fields=None):
 stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=fields or list(rows[0]),lineterminator='\n',extrasaction='ignore');writer.writeheader();writer.writerows(rows);return stream.getvalue().encode()
def layer(role):return json.loads(files[f'{role}.geojson'])['features']
def pdf(title,lines,features=None):
 stream=io.BytesIO();c=canvas.Canvas(stream,pagesize=A4,invariant=1);c.setTitle(title);c.setFont('Helvetica-Bold',17);c.drawString(36,800,title);c.setFont('Helvetica',10)
 y=775
 for line in lines:
  if y<45:c.showPage();c.setFont('Helvetica',10);y=790
  c.drawString(36,y,str(line)[:102]);y-=16
 if features:
  geoms=[shape(f['geometry']) for f in features];bounds=geoms[0].bounds;scale=min(440/(bounds[2]-bounds[0]),420/(bounds[3]-bounds[1]))
  for idx,g in enumerate(geoms):
   for poly in [g] if g.geom_type=='Polygon' else g.geoms:
    path=c.beginPath()
    for ring in [poly.exterior,*poly.interiors]:
     points=list(ring.coords);path.moveTo(65+(points[0][0]-bounds[0])*scale,220+(points[0][1]-bounds[1])*scale)
     for x,z in points[1:]:path.lineTo(65+(x-bounds[0])*scale,220+(z-bounds[1])*scale)
     path.close()
    c.setStrokeColorRGB(.2,.4,.3);c.drawPath(path,fill=0,stroke=1)
  c.setFont('Helvetica',9);c.drawString(36,180,'All outlines use the named local metre frame. Diagram scale is for illustration.')
 c.save();return stream.getvalue()
parcels=layer('parcels');buildings=layer('buildings');floors=layer('floors');spaces=layer('spaces');roads=layer('roads');public=layer('public_land');utilities=layer('utilities')
bids=[f['id'] for f in buildings];obj_ids={f['id'] for fs in [parcels,buildings,floors,spaces,roads,public,utilities] for f in fs}
schedule=list(csv.DictReader(io.StringIO(files['floor-schedule.csv'].decode())));obj_ids.update(r['unit_id'] for r in schedule)
# Full MASTER v1 vocabulary from the provided source. These are freshly authored records.
master={'scene_id':'LV-COMPLETE-001','scene_name':'Lake View reference city','scene_version':'1.0.0','status':'synthetic_baseline','coordinate_reference_system':{'name':frame['name'],'units':'metres','axes':{'X':'Easting','Y':'Northing','Z':'elevation'},'horizontal_extent':extent,'vertical_reference':frame['verticalDatum']},'design_note':'Synthetic authored reference-style city. Not survey evidence or an official register.','roads':[],'lanes':[],'parcels':[],'buildings':[],'open_areas':[],'vegetation_zones':[],'parking_areas':[],'utility_features':{'drains':[],'poles':[],'other':[]},'community_structures':[],'building_appurtenances':{'roof_form':'flat synthetic roofs','boundary_walls':{'id':'LV-WALLS','coverage':'Synthetic parcel-edge display walls; not surveyed boundaries'},'water_tanks':{'typical_form':'Not separately authored','items':[]},'stairhead_rooms':{'id_prefix':'LV-CORE-','count':len(bids),'typical_height_m':1.8,'note':'Authored display envelope only'},'shop_frontages':{'id_prefix':'LV-SHOP-','count':0,'locations':'No shops authored in this residential scene'}},'vehicles':[],'terrain':{'id':'LV-TERRAIN','character':'Authored flat showcase plane','elevation_range_m':[0,0],'typical_road_grade_percent':0,'breaklines':[],'control_points':[]},'constraints':['Synthetic demonstration only.','All derived files use the same immutable local coordinates.','No official 2D or 3D identifiers are issued.','Shared-wall contact is not a positive-area conflict.']}
for f in roads:
 p=shape(f['geometry']);x0,y0,x1,y1=p.bounds;horizontal=x1-x0>y1-y0
 line=[[x0,(y0+y1)/2],[x1,(y0+y1)/2]] if horizontal else [[(x0+x1)/2,y0],[(x0+x1)/2,y1]]
 master['roads'].append({'id':f['id'],'name':f['properties']['name'],'type':'local_street','width_m':y1-y0 if horizontal else x1-x0,'centerline':line,'surface':'synthetic paved surface','drain_ids':[]})
for f in parcels:
 g=shape(f['geometry']);master['parcels'].append({'id':f['id'],'geometry':list(g.exterior.coords),'area_m2':g.area,'land_use':'residential','building_ids':[b['id'] for b in buildings if b['properties']['parcel_id']==f['id']]})
for f in buildings:
 g=shape(f['geometry']);p=f['properties'];master['buildings'].append({'id':f['id'],'parcel_id':p['parcel_id'],'footprint':list(g.exterior.coords),'footprint_dimensions_m':[g.bounds[2]-g.bounds[0],g.bounds[3]-g.bounds[1]],'footprint_area_m2':g.area,'floors':p['floor_count'],'height_m':p['height_m'],'base_elevation_m':p['base_elevation_m'],'type':'apartment','usage':'residential','basement':f['id']=='B01'})
for f in public:
 g=shape(f['geometry']);master['open_areas'].append({'id':f['id'],'type':'park','geometry':list(g.exterior.coords),'area_m2':g.area,'surface':'grass','parcel_id':None});master['vegetation_zones'].append({'id':'LV-PARK-TREES','type':'park_trees','geometry':list(g.exterior.coords),'area_m2':g.area,'canopy_height_m':7,'dominant_species':'fictional mixed trees','tree_count':sum(g.covers(__import__('shapely').geometry.Point(*t['position'])) for t in manifest['sceneDecoration']['trees'])})
# Source XYZ water alignment is preserved separately from the MASTER's observed XY drain vocabulary.
master['utility_features']['other']=[{'id':'UT01-ACCESS','type':'water_access','location':[98.5,60,-1.8],'alignment_id':'UT01'}]
master['vehicles']=[{'id':f'LV-CAR-{i+1}','class':'car','parking_area_id':None,'position':c['position']} for i,c in enumerate(manifest['sceneDecoration']['cars'])]
master['parking_areas']=[{'id':'LV-PK-01','type':'synthetic_curbside_display','geometry':[[19,98.7],[119,98.7],[119,101.7],[19,101.7],[19,98.7]],'capacity':3,'vehicle_ids':[v['id'] for v in master['vehicles'][:3]]}]
for vehicle in master['vehicles'][:3]:vehicle['parking_area_id']='LV-PK-01'
# Control CSV mirrors the supplied headers, without inventing geodetic coordinates.
controls=[]
for i,(x,y) in enumerate([(-20,-20),(90,-20),(185,-20),(-20,90),(90,90),(185,90),(-20,195),(90,195),(185,195)]):
 controls.append({'point_id':f'LV-CP-{i+1:02}','point_type':'synthetic_control','x':x,'y':y,'z':0,'horizontal_accuracy_m':0,'vertical_accuracy_m':0,'coordinate_frame':frame['name'],'vertical_reference':frame['verticalDatum'],'observation_datetime':'','monument_description':'Authored synthetic control; zero denotes exact fixture coordinates, not instrument accuracy.'})
master['terrain']['control_points']=[{'id':r['point_id'],'location':[r['x'],r['y'],r['z']]} for r in controls]
add('gnss-cors-survey-control.csv',csvdata(controls),'controls','text/csv')
add('MASTER_SCENE.json',jbytes(master),description='Provided MASTER v1 fields; geometry is read from the linked GeoJSON sources to retain explicit floor/space boundaries.')
# GeoPackages use engineering CRS WKT, not EPSG:4326.
wkt=f'LOCAL_CS["{frame["name"]}",LOCAL_DATUM["Synthetic origin",0],UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH]]'
for path,features,geom,properties in [('lake-view-parcels.gpkg',parcels,'Polygon',{'parcel_id':'str'}),('gnss-cors-survey-control.gpkg',[{'geometry':{'type':'Point','coordinates':[r['x'],r['y'],r['z']]},'properties':r} for r in controls],'3D Point',{'point_id':'str'})]:
 dest=OUT/path
 if dest.exists():dest.unlink()
 with fiona.open(dest,'w',driver='GPKG',schema={'geometry':geom,'properties':properties},crs_wkt=wkt,layer='parcels' if geom=='Polygon' else 'controls') as sink:
  for f in features:sink.write({'geometry':f['geometry'],'properties':{key:f['properties'][key] for key in properties}})
 add(path,dest.read_bytes(),mime='application/geopackage+sqlite3',description='Equivalent source representation; not independently re-extracted by the browser importer.')
add('lake-view-survey-control-report.pdf',pdf('Lake View - synthetic survey controls',[frame['name'],frame['verticalDatum'],'No GNSS observations or real survey accuracy are claimed.']+[f"{r['point_id']}: {r['x']}, {r['y']}, 0 m" for r in controls]),mime='application/pdf')
# Plans: exact focal floor and unit polygons, source-linked schedule for every building.
plan_records=[]
for f in floors:
 if f['properties'].get('building_id')!='B01':continue
 level=f['properties']['level'];fid=f['id'];units=[u for u in spaces if u['properties']['floor_id']==fid];name=f'plans/B01-level-{level}.pdf';linked=['B01',fid]+[u['id'] for u in units]
 add(name,pdf(f'B01 - {f["properties"]["name"]}',[f'Floor 3D ULPIN: {f["properties"]["internal_3d_id"]}',f'Local base: {f["properties"]["base_elevation_m"]} m; height: {f["properties"]["height_m"]} m','Authored fictional plan. No approval or title established.'],[f]+units),mime='application/pdf',objects=linked)
 plan_records.append({'buildingId':'B01','floorId':fid,'level':level,'path':name,'coordinateFrame':frame['name']})
 for row in schedule:
  if row['floor_id']==fid:
   row['source_plan_file']=name
   if level<0:row['unit_type']='parking'
add('floor-schedule.csv',csvdata(schedule),'floor_schedule','text/csv')
add('plans/floor-plan-manifest.json',jbytes({'schema':'floor-plan-manifest.v1','classification':'synthetic','plans':plan_records,'note':'Other buildings have authored floor boundaries and schedules, without PDF plans.'}),objects=['B01'])
poly=shape(buildings[0]['geometry']);coords=' '.join(f'{(x-68)*10:.2f},{(85-y)*10:.2f}' for x,y in poly.exterior.coords)
add('plans/B01-floor-plans.svg',f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 250 300"><title>Synthetic B01 floor footprint, local metres</title><polygon points="{coords}" fill="none" stroke="#315c43"/><text y="280" font-size="10">Fictional source plan; 10 SVG units per metre.</text></svg>',mime='image/svg+xml',objects=['B01'])
# Deterministic, measured-from-authored-shape rasters: same extent, north-up, same benchmark.
width,height=220,230;transform=from_origin(-26,204,1,1)
def raster(path,array):
 dest=OUT/path;dest.parent.mkdir(parents=True,exist_ok=True);bands=array if array.ndim==3 else array[np.newaxis,:,:]
 with rasterio.open(dest,'w',driver='GTiff',width=width,height=height,count=len(bands),dtype=bands.dtype,transform=transform,crs=wkt,compress='deflate') as ds:
  ds.write(bands);ds.update_tags(classification='synthetic',vertical_reference=frame['verticalDatum'],source_revision=revision)
 add(path,dest.read_bytes(),mime='image/tiff',description='Synthetic georeferenced source raster, retained; no raster-derived geometry inferred during this import.')
dem=np.zeros((height,width),dtype='float32');dsm=rasterize([(f['geometry'],f['properties']['height_m']) for f in buildings],out_shape=(height,width),transform=transform,fill=0,dtype='float32')
raster('elevation/lake-view-dem.tif',dem);raster('elevation/lake-view-dsm.tif',dsm)
colors=[(parcels,(192,201,181)),(public,(127,167,112)),(roads,(174,174,166)),(buildings,(226,229,222))]
channels=[]
for channel in range(3):
 shapes=[(f['geometry'],color[channel]) for features,color in colors for f in features];channels.append(rasterize(shapes,out_shape=(height,width),transform=transform,fill=[212,220,203][channel],dtype='uint8'))
rgb=np.stack(channels);raster('imagery/lake-view-orthomosaic.tif',rgb)
img=Image.fromarray(rgb.transpose(1,2,0));stream=io.BytesIO();img.save(stream,'JPEG',quality=92);add('imagery/lake-view-orthomosaic-preview.jpg',stream.getvalue(),mime='image/jpeg',description='Display-only preview; the corresponding GeoTIFF carries the placement.')
# LAS 1.4 / point format 7 and byte-equivalent coordinate LAZ representation.
y,x=np.mgrid[0:height,0:width];xyz=np.column_stack((x.ravel()-25.5,203.5-y.ravel(),dem.ravel()));classes=np.full(len(xyz),2,dtype='uint8')
roof_mask=dsm.ravel()>0;roof=xyz[roof_mask].copy();roof[:,2]=dsm.ravel()[roof_mask];xyz=np.vstack([xyz,roof]);classes=np.concatenate([classes,np.full(len(roof),6,dtype='uint8')])
header=laspy.LasHeader(point_format=7,version='1.4');header.scales=np.array([.001,.001,.001]);header.offsets=np.array([-26,-26,0]);header.system_identifier='ULPIN synthetic fixture';header.generating_software='T079 source generator'
import datetime
header.creation_date=datetime.date(2026,9,21)
cloud=laspy.LasData(header);cloud.x=xyz[:,0];cloud.y=xyz[:,1];cloud.z=xyz[:,2];cloud.classification=classes
for suffix in ['las','laz']:
 dest=OUT/f'lidar/lake-view-pointcloud.{suffix}';dest.parent.mkdir(exist_ok=True);cloud.write(dest);add(str(dest.relative_to(OUT)),dest.read_bytes(),mime='application/vnd.las' if suffix=='las' else 'application/octet-stream',description='Synthetic point samples of the same ground and roof surfaces; original retained, not automatically segmented.')
add('lidar/lake-view-pointcloud-manifest.json',jbytes({'lasVersion':'1.4','pointFormat':7,'pointCount':len(xyz),'bounds':{'min':xyz.min(axis=0).tolist(),'max':xyz.max(axis=0).tolist()},'densityPointsPerSqM':len(xyz)/(width*height),'classificationCodes':[2,6],'coordinateFrame':frame['name'],'verticalReference':frame['verticalDatum'],'classification':'synthetic','generationMethod':'Deterministic 1 m ground and roof samples from immutable authored polygons; no sensor observations.'}))
# Parties/rights are separate from residents. Documents support fictional assertions, not legal ownership.
parties=[{'party_id':f'LV-PARTY-{bid}','name':f'Fictional Owner {bid}','classification':'synthetic'} for bid in bids]
rights=[{'right_id':f'LV-RIGHT-{bid}','object_id':bid,'party_id':f'LV-PARTY-{bid}','right_type':'ownership','document_path':'records/fictional-property-schedule.pdf','classification':'synthetic'} for bid in bids]
for f in floors:
 fid=f['id'];party_id=f'LV-PARTY-{fid}';parties.append({'party_id':party_id,'name':f'Fictional Leaseholder {fid}','classification':'synthetic'})
 rights.append({'right_id':f'LV-RIGHT-{fid}','object_id':fid,'party_id':party_id,'right_type':'common_use' if f['properties']['level']<0 else 'lease','document_path':'records/fictional-property-schedule.pdf','classification':'synthetic'})
parties.append({'party_id':'LV-PARTY-UTILITY','name':'Fictional Water Operator','classification':'synthetic'})
rights.append({'right_id':'LV-RIGHT-UTILITY','object_id':'UT01','party_id':'LV-PARTY-UTILITY','right_type':'utility_easement','document_path':'records/fictional-property-schedule.pdf','classification':'synthetic'})
add('records/fictional-property-schedule.pdf',pdf('Fictional property assertions',['DEMONSTRATION ONLY. This is not title evidence.','Occupants are listed separately and are not presumed to be owners.']+[f'{r["right_id"]}: {r["object_id"]} / {r["party_id"]} / {r["right_type"]}' for r in rights]),mime='application/pdf',objects=[r['object_id'] for r in rights])
add('records/parties.csv',csvdata(parties),'parties','text/csv');add('records/rights.csv',csvdata(rights),'rights','text/csv')
# Normalized v1 schema family, keeping source IDs/provenance and all supplied vocabulary.
def source_format(path):return {'.geojson':'GeoJSON','.gpkg':'GeoPackage','.tif':'GeoTIFF','.jpg':'JPEG','.las':'LAS','.laz':'LAZ','.pdf':'PDF','.csv':'CSV','.svg':'SVG','.docx':'DOCX','.json':'JSON','.md':'Markdown'}.get(Path(path).suffix,Path(path).suffix[1:])
def asset_type(path):
 if path=='MASTER_SCENE.json':return 'master_scene'
 if path.startswith('gnss-'):return 'control_points'
 if path.startswith('elevation/'):return 'elevation'
 if path.startswith('lidar/'):return 'lidar'
 if path.startswith('imagery/'):return 'imagery'
 if path.startswith('plans/'):return 'floor_plan'
 if Path(path).suffix in ['.geojson','.gpkg']:return 'gis_vector'
 return 'schedule' if path.endswith('.csv') else 'document'
def provenance(path,obj):return [{'sourceFile':path,'sourceFormat':source_format(path),'sourceObjectId':obj,'sourceRevision':revision,'processingStep':'deterministic source conversion','transformation':'none','timestamp':None,'reviewStatus':'unreviewed_synthetic'}]
def normalized(name,schema,records):add(f'normalized/{name}.json',jbytes({'schema':schema,'coordinateFrame':frame['name'],'horizontalUnit':'metre','verticalUnit':'metre','records':records}),description='Equivalent normalized v1 records; primary source files are used to build this draft.')
normalized('parcels','canonical.parcels.v1',[{'canonicalParcelId':f['id'],'sourceParcelId':f['id'],'blockId':'LV-COMPLETE-001','geometry':f['geometry'],'areaSqM':shape(f['geometry']).area,'landUse':'residential','occupancyType':'residential','buildingIds':[b['id'] for b in buildings if b['properties']['parcel_id']==f['id']],'sourceAssetIds':['parcels.geojson'],'sourceRevision':revision,'reviewStatus':'unreviewed','provenance':provenance('parcels.geojson',f['id'])} for f in parcels])
normalized('buildings','canonical.buildings.v1',[{'canonicalBuildingId':f['id'],'canonicalParcelIds':[f['properties']['parcel_id']],'geometry':f['geometry'],'footprintAreaSqM':shape(f['geometry']).area,'heightM':f['properties']['height_m'],'baseElevationM':0,'floorCount':f['properties']['floor_count'],'buildingType':'apartment','useType':'residential','basement':f['id']=='B01','sourceAssetIds':['buildings.geojson'],'supportingAssetIds':['floor-schedule.csv'],'sourceRevision':revision,'reviewStatus':'unreviewed','provenance':provenance('buildings.geojson',f['id'])} for f in buildings])
normalized('roads','canonical.roads.v1',[{'roadId':r['id'],'name':r['name'],'geometry':{'type':'LineString','coordinates':r['centerline']},'widthM':r['width_m'],'provenance':provenance('MASTER_SCENE.json',r['id'])} for r in master['roads']])
unit_shapes={f['id']:f for f in spaces}
normalized('floor_spaces','canonical.floor-spaces.v1',[{'buildingId':r['building_id'],'floorId':r['floor_id'],'floorName':r['floor_name'],'level':int(r['level']),'unitId':r['unit_id'],'unitType':r['unit_type'],'areaSqM':shape(unit_shapes[r['unit_id']]['geometry']).area if r['unit_id'] in unit_shapes else None,'sourcePlanFile':r['source_plan_file'],'geometryReference':{'type':'source_unit_polygon' if r['unit_id'] in unit_shapes else 'schedule_only','coordinateFrame':frame['name'],'geometry':unit_shapes.get(r['unit_id'],{}).get('geometry'),'note':'Authored unit polygon supplied.' if r['unit_id'] in unit_shapes else 'No unit polygon source exists.'},'roomCount':None,'bedroomCount':None,'bathroomCount':None,'reviewStatus':'unreviewed','provenance':provenance('floor-schedule.csv',r['unit_id'])} for r in schedule])
normalized('control_points','canonical.control-points.v1',[{'controlPointId':r['point_id'],'x':r['x'],'y':r['y'],'z':r['z'],'horizontalAccuracyM':0,'verticalAccuracyM':0,'coordinateFrame':frame['name'],'verticalReference':frame['verticalDatum'],'observationDatetime':None,'sourceAssetId':'gnss-cors-survey-control.csv','provenance':provenance('gnss-cors-survey-control.csv',r['point_id'])} for r in controls])
normalized('elevation_surfaces','canonical.elevation-surfaces.v1',[{'surfaceId':kind.upper(),'sourceFile':f'elevation/lake-view-{kind}.tif','format':'GeoTIFF','width':width,'height':height,'pixelSizeM':1,'bounds':extent,'coordinateFrame':frame['name'],'verticalReference':frame['verticalDatum'],'minElevationM':0,'maxElevationM':float(values.max()),'affineTransform':list(transform)[:6]} for kind,values in [('dem',dem),('dsm',dsm)]])
normalized('imagery_assets','canonical.imagery-assets.v1',[{'assetId':'ORTHO','sourceFile':'imagery/lake-view-orthomosaic.tif','format':'GeoTIFF','width':width,'height':height,'resolutionM':1,'coverage':extent,'coordinateFrame':frame['name'],'acquisitionTime':None,'generationMethod':'deterministic source render','affineTransform':list(transform)[:6]},{'assetId':'PREVIEW','sourceFile':'imagery/lake-view-orthomosaic-preview.jpg','format':'JPEG','coverage':None,'resolutionM':None,'coordinateFrame':None,'status':'non_authoritative_preview'}])
normalized('lidar_assets','canonical.lidar-assets.v1',[{'assetId':suffix.upper(),'sourceFile':f'lidar/lake-view-pointcloud.{suffix}','format':suffix.upper(),'pointCount':len(xyz),'classificationCodes':[2,6],'bounds':[xyz.min(axis=0).tolist(),xyz.max(axis=0).tolist()],'coordinateFrame':frame['name'],'verticalReference':frame['verticalDatum'],'equivalentTo':'LAS' if suffix=='laz' else None} for suffix in ['las','laz']])
relationships=[{'fromId':f['properties']['parcel_id'],'relationship':'contains_building','toId':f['id']} for f in buildings]+[{'fromId':bid,'relationship':'covered_by_asset','toId':'records/fictional-property-schedule.pdf'} for bid in bids]
add('normalized/dataset-links.json',jbytes({'relationships':relationships}))
for name in ['parcels','buildings','roads']:
 path=f'normalized/{name}.json';payload=json.loads(files[path])
 for row in payload['records']:
  if name=='parcels':
   row['sourceParcelIdentifiers']=[row.pop('sourceParcelId')];row['sourceRevisionId']=row.pop('sourceRevision');row['geometryStatus']='authored_synthetic';row['sourceAssetIds']=['parcels.geojson','lake-view-parcels.gpkg']
  if name=='buildings':
   row.update(sourceBuildingId=row['canonicalBuildingId'],floorPlanIds=[p['path'] for p in plan_records if p['buildingId']==row['canonicalBuildingId']],imageryAssetIds=['imagery/lake-view-orthomosaic.tif'],lidarAssetIds=['lidar/lake-view-pointcloud.las','lidar/lake-view-pointcloud.laz'],elevationAssetIds=['elevation/lake-view-dem.tif','elevation/lake-view-dsm.tif'],geometryStatus='authored_synthetic')
   row['sourceRevisionId']=row.pop('sourceRevision')
  if name=='roads':row.update(sourceRoadId=row['roadId'],roadType='local_street',sourceAssetIds=['roads.geojson','MASTER_SCENE.json'],reviewStatus='unreviewed_synthetic')
 add(path,jbytes(payload))
# Exact field spellings/container shapes rechecked against the supplied Drive JSON (21 Sep).
for name in ['control_points','imagery_assets','lidar_assets','elevation_surfaces']:
 path=f'normalized/{name}.json';payload=json.loads(files[path]);records=payload['records']
 for row in records:
  row['sourceRevision']=revision
  if name=='control_points':
   row['canonicalControlPointId']=row.pop('controlPointId');row['sourcePointId']=row['canonicalControlPointId'];row['observationDateTime']=row.pop('observationDatetime');row['reviewStatus']='unreviewed_synthetic'
  else:row['qualityStatus']='unreviewed_synthetic'
  if name=='imagery_assets':
   row.update(type='synthetic_orthomosaic' if row['assetId']=='ORTHO' else 'preview',width=width,height=height,resolution={'x':1,'y':1,'unit':'metre'} if row['assetId']=='ORTHO' else None,acquisitionDateTime=None,processingHistory=['deterministic source render'])
   if row['assetId']=='PREVIEW':row['qualityStatus']='non_authoritative_preview'
   for key in ['resolutionM','acquisitionTime','generationMethod','status']:row.pop(key,None)
  if name=='elevation_surfaces':
   row['assetId']=row.pop('surfaceId');row['type']=row['assetId'];row['pixelSize']={'x':1,'y':1,'unit':'metre'};row['minimumElevation']=row.pop('minElevationM');row['maximumElevation']=row.pop('maxElevationM');row.pop('pixelSizeM',None)
  if name=='lidar_assets':
   row.update(pointDataFormat=7,lasVersion='1.4',bounds=dict(zip(['min_x','min_y','min_z','max_x','max_y','max_z'],[*xyz.min(axis=0).tolist(),*xyz.max(axis=0).tolist()])),classificationSummary={'2':int((classes==2).sum()),'6':int((classes==6).sum())},estimatedPointDensity=len(xyz)/(width*height),representationStatus='primary_source' if row['format']=='LAS' else 'compressed_equivalent')
   row.pop('classificationCodes',None);row.pop('equivalentTo',None)
  if name!='control_points':row['assetId']=row['sourceFile']
 payload={'schema':payload['schema'],**({'coordinateFrame':frame['name']} if name=='control_points' else {}),'records':records}
 add(path,jbytes(payload),description='Provided normalized v1 field names; synthetic values are computed from this package.')
links=json.loads(files['normalized/dataset-links.json']);links.update(schema='canonical.dataset-links.v1',coordinateFrame=frame['name'])
links['relationships'] += [{'fromId':f['properties']['building_id'],'relationship':'has_floor','toId':f['id']} for f in floors]
links['relationships'] += [{'fromId':r['point_id'],'relationship':'controls_asset','toId':path} for r in controls for path in ['imagery/lake-view-orthomosaic.tif','lidar/lake-view-pointcloud.las','elevation/lake-view-dem.tif','elevation/lake-view-dsm.tif']]
add('normalized/dataset-links.json',jbytes(links))
# Computed example findings remain review items; never mark them accepted automatically.
findings=[]
for b in buildings:
 geom=shape(b['geometry']);parcel=next(p for p in parcels if p['id']==b['properties']['parcel_id']);outside=geom.difference(shape(parcel['geometry']))
 if outside.area>1e-6:findings.append({'code':'OUTSIDE_PARCEL','buildingId':b['id'],'otherId':parcel['id'],'areaM2':outside.area,'geometry':mapping(outside),'status':'needs_review'})
 for road in roads:
  overlap=geom.intersection(shape(road['geometry']))
  if overlap.area>1e-6:findings.append({'code':'ROAD_OVERLAP','buildingId':b['id'],'otherId':road['id'],'areaM2':overlap.area,'geometry':mapping(overlap),'status':'needs_review'})
add('validation/conflict-summary.json',jbytes({'classification':'synthetic','method':'positive-area polygon intersection in the shared local metre frame','findings':findings,'legalDecision':None}))
add('validation/floor-plan-validation.json',jbytes({'classification':'synthetic','planCount':len(plan_records),'source':'floors.geojson and spaces.geojson','status':'generated_from_same_shapes','independentApproval':False}))
add('validation/final-consistency-report.json',jbytes({'classification':'synthetic','status':'WARNING','buildingCount':len(buildings),'controlCount':len(controls),'findings':len(findings),'warnings':['Source assertions are unreviewed.','Do not equate retained binary originals with automatically extracted geometry.']}))
add('validation/final-report.md',f"# Synthetic source report\n\n{len(buildings)} buildings, {len(floors)} floors, {len(findings)} computed findings.\n\nB01 has intentional road/parcel intersection examples. No source correction or recording was performed.\n",mime='text/markdown')
add('normalized/README.md','# Normalized v1 exchange files\nEquivalent source records in the observed provided schema family. The browser reads primary source vectors and CSV schedules; it does not double-import these equivalent representations.\n',mime='text/markdown')
from docx import Document
report_doc=Document();report_doc.add_heading('Lake View - complete fictional dataset',0);report_doc.add_paragraph('Synthetic demonstration only. This is a new authored reconstruction of the reference-style city, not a survey or official property record.')
report_doc.add_heading('One source geometry, multiple formats',1);report_doc.add_paragraph(f"{len(buildings)} buildings, {len(floors)} floors, {len(schedule)} spaces, nine controls and {len(xyz)} synthetic points.")
report_doc.add_paragraph('GeoJSON and schedules build the interactive map. MASTER and normalized v1 JSON provide compatible source structures. GeoPackage, PDF/SVG plans, LAS/LAZ, GeoTIFF and JPEG are retained originals with fingerprints.')
report_doc.add_heading('Review',1);report_doc.add_paragraph('B01 intentionally crosses its parcel edge and a road. Resident occupancy is separate from fictional rights and parties. Full recording remains in the saved workflow; this source importer opens a draft preview.')
stream=io.BytesIO();report_doc.save(stream);add('Lake_View_3D_ULPIN_Dataset_Report.docx',stream.getvalue(),mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
# Catalog excludes itself and the integrity manifest to avoid a hash cycle.
add('normalized/source_assets.json',jbytes({'schema':'canonical.source-assets.v1','coordinateFrame':frame['name'],'assets':[{'assetId':path,'sourceFile':path,'sourceFormat':source_format(path),'assetType':asset_type(path),'exists':True,'fileSizeBytes':len(data),'sha256':sha(data),'sourceRevision':revision,'provenance':provenance(path,path)[0]} for path,data in files.copy().items() if not path.startswith('normalized/')]}))
report={'classification':'synthetic','buildings':len(buildings),'parcels':len(parcels),'floors':len(floors),'spaces':len(schedule),'controlPoints':9,'pointCount':len(xyz),'warnings':['Schedule-only spaces have no invented polygons.','PDF/LAS/LAZ/raster originals are retained, not automatically extracted by the browser importer.','Reference city is an authored reconstruction, not data recovered from an image.','No legal ownership or official identifier issuance.'],'geometryInput':['parcels.geojson','buildings.geojson','floors.geojson','spaces.geojson','roads.geojson','utilities.geojson','public_land.geojson','floor-schedule.csv']}
add('normalized/normalization-report.json',jbytes(report))
add('README.md',f'''# Lake View complete fictional source showcase

Download this ZIP, choose Import in Studio, select it and choose Review on map.
The ZIP contains actual GeoJSON/CSV, GPKG, PDF/SVG, LAS/LAZ and GeoTIFF/JPEG files.
All are new synthetic data derived from one authored city. Earlier originals are unchanged.

The map is built from source vectors and schedules, not a prebuilt normalized.json.
MASTER and normalized v1 families mirror the observed supplied schemas. Added fields
are our own documented extensions (base elevations, exact unit polygons, rights).
Binary evidence is retained with hashes; importing it does not prove extraction.

Frame: {frame['name']}. Vertical reference: {frame['verticalDatum']}.
49 buildings; floor IDs follow DEMO-3D-ANCHOR-B01:floorNumber.
Building B01 intentionally intersects its parcel edge and road; inspect its findings.
Resident schedules, fictional parties and rights are separate. Every right links a document.
The full saved processing/review/record workflow uses Batches and requires local services.
This browser source import creates a draft preview, not a recorded database entry.
''',mime='text/markdown')
manifest.update(sourceRevision=revision,files=list(entries.values()))
manifest['metadata'].update(title='Lake View · complete fictional source dataset',description='Reference-style city built from original source vectors and schedules, with supporting source formats and separate fictional rights/occupants.',datasetPackage='lake-view-complete-1')
files['source-manifest.json']=jbytes(manifest)
files['manifest.json']=jbytes({'schemaVersion':'source-integrity/1','classification':'synthetic','files':[{'path':p,'bytes':len(v),'sha256':sha(v)} for p,v in files.items()]})
for name,data in files.items():
 path=OUT/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
archive=ROOT/'apps/web/public/reference/lake-view-complete.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name,data in files.items():
  info=zipfile.ZipInfo(name,(2026,9,21,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
print(json.dumps({'archive':str(archive),'members':len(files),'compressedBytes':archive.stat().st_size,'expandedBytes':sum(map(len,files.values())),**report}))
