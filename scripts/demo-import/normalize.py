"""Bounded NYC profile only. stdin JSON -> actual normalized batches as NDJSON.
Vectors use the geo image; mixed uploads use the isolated requirements.txt environment. No AI provider.
"""
import sys, json, uuid, math
from shapely.geometry import shape, mapping
from shapely import make_valid, __version__ as shapely_version
from shapely.ops import transform
from shapely.validation import explain_validity
from pyproj import Transformer, __version__ as proj_version

payload = json.load(sys.stdin)
area_id = payload['areaId']
namespace = uuid.UUID(area_id)
def uid(value):
    h = uuid.uuid5(namespace, value).hex
    return str(uuid.UUID('d30d' + h[4:]))
def emit(value):
    print(json.dumps(value, separators=(',', ':'), allow_nan=False), flush=True)

layers = payload['layers']
# One UTM frame for this bounded New York profile. Origin derived from all uploaded geometry.
projection = Transformer.from_crs('EPSG:4326', 'EPSG:32618', always_xy=True)
valid = []; rejected = []; repaired = []; total = 0; bounds = []
for layer in layers:
    if layer.get('format') in ('laz', 'geotiff'): continue
    seen = set()
    for index, feature in enumerate(layer['document']['features']):
        total += 1
        props = feature.get('properties') or {}
        key = str(props.get('doitt_id') if layer['layer'] == 'building' else props.get('socrata_row_id') or feature.get('id') or '')
        try:
            if not key or key == 'None' or key in seen: raise ValueError('Missing or duplicate source identifier')
            seen.add(key)
            geom = shape(feature['geometry'])
            if geom.geom_type not in ('Polygon', 'MultiPolygon') or geom.is_empty: raise ValueError('Expected nonempty Polygon/MultiPolygon')
            repair = None
            if not geom.is_valid:
                reason = explain_validity(geom)
                fixed = make_valid(geom)
                before = transform(projection.transform, geom); after = transform(projection.transform, fixed)
                drift = before.hausdorff_distance(after)
                delta = abs(before.area - after.area)
                if fixed.geom_type not in ('Polygon','MultiPolygon') or not fixed.is_valid or fixed.is_empty or drift > 0.001 or delta > max(0.0001, abs(before.area)*1e-8):
                    raise ValueError(reason + '; no boundary-preserving polygon repair qualified')
                repair = dict(sourceKey=key,sourceFeatureIndex=index,layer=layer['layer'],reason=reason,method='Shapely '+shapely_version+' make_valid',areaDeltaM2=delta,boundaryHausdorffM=drift,originalRetained=True)
                repaired.append(repair);geom=fixed
            x0,y0,x1,y1 = geom.bounds
            if not (-75 < x0 <= x1 < -73 and 40 < y0 <= y1 < 42): raise ValueError('Outside the NYC profile coordinate range')
            g = transform(projection.transform, geom)
            valid.append((layer,index,feature,key,g,repair)); bounds.append(g.bounds)
        except Exception as exc:
            rejected.append(dict(featureIndex=total-1, sourceFeatureIndex=index, sourceKey=key, layer=layer['layer'], code='INVALID_GEOMETRY', reason=str(exc)))
if not valid: raise ValueError('No valid polygon features in the upload')
ox = min(b[0] for b in bounds); oy = min(b[1] for b in bounds)
anchor = Transformer.from_crs('EPSG:32618','EPSG:4326',always_xy=True).transform(ox,oy)
reference = dict(sourceCrs='EPSG:4326',analysisCrs='EPSG:32618',origin=[ox,oy],anchor=list(anchor),transformVersion='nyc-context-demo/1; pyproj '+proj_version,verticalReference='building-relative roof heights; context surfaces have no qualified elevation')
reports=[]; observations={}
binary=[layer for layer in layers if layer.get('format') in ('laz','geotiff')]
if binary:
    from multimodal import fuse
    reports,observations=fuse(binary,valid,payload['outputDir'])
message = f'{len(valid)} of {total} uploaded features accepted; {len(rejected)} skipped; {len(repaired)} repaired for display. Originals retained unchanged.'
if reports: message += ' LiDAR/raster evidence linked to overlapping buildings. Available imagery and derived-surface previews are context only; original points and DEM samples remain evidence.'
emit(dict(type='metadata',reference=reference,datasets=reports,total=total,quarantine=dict(version='gis-quarantine/1',total=total,accepted=len(valid),rejected=len(rejected),complete=not rejected,message=message,rejections=rejected,repairs=repaired,sourceSha256=payload['hash'],sourceId=payload['packageId'],sourceRevision=1)))
batch=[]
# Surfaces first; building batches then grow onto them. No invented delay or geometry.
valid.sort(key=lambda row: row[0]['layer']=='building')
for layer,index,feature,key,geom,repair in valid:
    props = feature.get('properties') or {}; family=layer['layer']; sub=str(props.get('sub_code',''))
    subtype = 'court' if family=='parks' and sub.startswith('491') else 'greenstreet' if family=='parks' and sub=='498500' else family
    # Existing renderer vocabulary only; original type remains explicit in provenance/properties.
    kind = 'building' if family=='building' else 'road' if family in ('roadbed','sidewalk') or subtype=='court' else 'public_land'
    fid=uid(layer['dataset']+':'+key); source_id=layer['sourceId']
    evidence=[dict(sourceRevisionId=source_id,featureId=key,jsonPointer=f'/features/{index}')]
    raw_height=props.get('height_roof'); height=None
    if family=='building' and raw_height not in (None,''):
        h=float(raw_height)
        if math.isfinite(h) and h>0: height=h*0.3048
    height_info=dict(value=height,state='source_supported' if height is not None else 'unknown',unit='m',evidence=evidence,reference=reference['verticalReference'])
    if height is not None: height_info.update(originalValue=raw_height,originalUnit='ft',method='height_roof × 0.3048',meaning='Source roof height above building ground')
    local=transform(lambda x,y,z=None:(x-ox,y-oy),geom)
    name=props.get('name') or props.get('park_name') or ('Building '+key if family=='building' else '')
    p=dict(props); p.update(sourceLayer=family,sourceSubtype=subtype,displayClass=kind)
    if family=='water': p['land_cover']='water'
    if repair: p['geometryRepair']=repair
    if (family,key) in observations: p['spatialObservations']=observations[(family,key)]
    row=dict(id=fid,areaId=area_id,kind=kind,name=str(name),identifier=('DOITT ' if family=='building' else layer['dataset']+' / ')+key,sourceKey=key,revision=0,geometry=mapping(local),sourceGeometry=feature['geometry'],sourceFeatureIndex=index,sourceRevisionId=source_id,datasetNamespace='nyc-oti-'+layer['dataset'],sourceReference=reference,properties=p,height=height_info,areaM2=geom.area,evidence=evidence,worldStatus='observed',geometryRole='observed_roof_projection' if family=='building' else 'context_surface',representation='physical_exterior',semantics=dict(sourceDate=props.get('last_edited_date'),evidenceState='source_supported'),displayState='unrecorded_proposal',proposalPackageId=payload['packageId'])
    batch.append(row)
    if len(batch)>=96:
        emit(dict(type='chunk',features=batch));batch=[]
if batch: emit(dict(type='chunk',features=batch))
emit(dict(type='complete'))
