"""Prepare a bounded OSM block and clearly separate authored demo layers.

Run inside the existing geo container. No host Python install is required.
This script does not touch application databases or call application writes.
"""
import json, hashlib, math, sys
from pathlib import Path
from shapely.geometry import Polygon, LineString, Point, mapping, shape, box
from shapely.ops import transform, unary_union, polygonize
from shapely import make_valid
from pyproj import Transformer

ROOT=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/uttam-data')
OUT=ROOT/'prepared';OUT.mkdir(parents=True,exist_ok=True)
raw=json.loads((ROOT/'uttam-nagar-osm-kumi.json').read_text())
delhi=json.loads((ROOT/'delhi-geocoder-boundary.json').read_text())
locality=json.loads((ROOT/'uttam-nagar-geocoder.json').read_text())[0]
forward=Transformer.from_crs(4326,32643,always_xy=True).transform
inverse=Transformer.from_crs(32643,4326,always_xy=True).transform
center=transform(forward,Point(float(locality['lon']),float(locality['lat'])))
buildings=[];roads=[];excluded=[]
for e in raw['elements']:
    if e['type']!='way' or not e.get('geometry'):continue
    coords=[(p['lon'],p['lat']) for p in e['geometry'] if p]
    tags=e.get('tags',{})
    if tags.get('building') and len(coords)>=4 and coords[0]==coords[-1]:
        g=transform(forward,make_valid(Polygon(coords)))
        if g.geom_type=='Polygon' and g.area>=9:buildings.append((e,g))
        else:excluded.append({'id':e['id'],'reason':'not a usable simple building polygon'})
    if tags.get('highway') and len(coords)>=2:
        g=transform(forward,LineString(coords))
        if g.length>0:roads.append((e,g))
network=[g for e,g in roads if e['tags']['highway'] in ['residential','living_street','unclassified','tertiary','secondary','primary','service','pedestrian']]
candidates=[]
for p in polygonize(unary_union(network)):
    if not 3500<=p.area<=22000 or p.distance(center)>550:continue
    contained=[(e,g) for e,g in buildings if p.contains(g.representative_point()) and g.intersection(p).area/g.area>.96]
    if 18<=len(contained)<=100:
        score=p.centroid.distance(center)+abs(len(contained)-45)*2
        candidates.append((score,p,contained))
if not candidates:raise RuntimeError('No suitable road-bounded block; inspect coverage instead of inventing a boundary')
_,block,selected=min(candidates,key=lambda t:t[0])
selected.sort(key=lambda t:t[0]['id'])
extent=block.buffer(18,join_style=2)
selected_roads=[(e,g.intersection(extent)) for e,g in roads if g.intersects(extent) and g.intersection(extent).length>3]
road_names=sorted(set(e['tags'].get('name','Unnamed '+e['tags']['highway']) for e,g in selected_roads))
def collection(features,notice):return {'type':'FeatureCollection','name':notice,'attribution':'© OpenStreetMap contributors','license':'ODbL-1.0','license_url':'https://www.openstreetmap.org/copyright','features':features}
def feature(g,properties):return {'type':'Feature','geometry':mapping(transform(inverse,g)),'properties':properties}
def save(name,data):
    path=OUT/name;path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');return path
boundary=next(x for x in delhi if x.get('addresstype')=='state')
save('delhi-boundary.geojson',collection([{'type':'Feature','geometry':boundary['geojson'],'properties':{'source_id':'osm/relation/'+str(boundary['osm_id']),'name':'Delhi administrative boundary (OSM)','boundary_meaning':'Administrative context only, not a parcel/title boundary','attribution':'© OpenStreetMap contributors','license':'ODbL-1.0'}}],'Delhi administrative boundary from OpenStreetMap'))
save('uttam-nagar-block-extent.geojson',collection([feature(block,{'source_id':'analysis-block-01','name':'Uttam Nagar road-bounded analytical block','meaning':'Derived from OSM street centreline polygonization; NOT a cadastral or administrative block','source_roads':road_names})],'Road-bounded analytical extent, not an official boundary'))
real_buildings=[]
for i,(e,g) in enumerate(selected,1):
    t=e['tags'];properties={'source_id':'osm-way-'+str(e['id']),'name':t.get('name',f'Uttam Nagar mapped building {i:02d}'),'osm_id':str(e['id']),'osm_url':f'https://www.openstreetmap.org/way/{e["id"]}','source_provider':'OpenStreetMap','attribution':'© OpenStreetMap contributors','license':'ODbL-1.0','source_tags':t,'evidence_note':'Community-mapped footprint. Occupancy, title, parcel boundary, floors and heights are not established by this outline.'}
    real_buildings.append(feature(g,properties))
save('uttam-nagar-buildings.geojson',collection(real_buildings,'Observed OSM footprints. No invented heights, owners or interiors.'))
save('uttam-nagar-road-centrelines.geojson',collection([feature(g,{'source_id':'osm-way-'+str(e['id']),'name':e['tags'].get('name','OSM '+e['tags']['highway']+' '+str(e['id'])),'osm_id':str(e['id']),'source_provider':'OpenStreetMap','attribution':'© OpenStreetMap contributors','license':'ODbL-1.0','source_tags':e['tags'],'geometry_meaning':'Road/path centreline clipped to analytical extent. Width and public-land boundary are unknown.'}) for e,g in selected_roads],'Observed road/path centrelines; no inferred legal road widths'))
demo_notice='FICTIONAL SCENARIO: source footprint shape from OSM; heights, parcels, rooms, residents and conflicts are authored for this prototype. No actual occupancy, title, approval or encroachment assertion.'
eligible=[]
for i,(e,g) in enumerate(selected,1):
    rect=g.minimum_rotated_rectangle
    if 55<=g.area<=350 and not g.interiors and g.area/rect.area>.94:
        eligible.append((abs(g.area-125),i,e,g))
if len(eligible)<3:raise RuntimeError('Need three suitable simple footprints for explicitly fictional floor layout')
primary=sorted(eligible)[:3]
primary_ids={e['id']:n+1 for n,(_,i,e,g) in enumerate(primary)}
demo_buildings=[]
for i,(e,g) in enumerate(selected,1):
    p=primary_ids.get(e['id']);h=9 if p else [6,9,12][i%3]
    demo_buildings.append(feature(g,{'source_id':f'demo-building-{i:02d}','name':f'DEMO Residence {p:02d} - fictional' if p else f'DEMO Context {i:02d} - fictional','source_osm_way':str(e['id']),'source_provider':'OpenStreetMap + authored demonstration','attribution':'© OpenStreetMap contributors','license':'ODbL-1.0','height_m':h,'floors':int(h/3),'world_status':'synthetic','notice':demo_notice}))
save('demo-buildings.geojson',collection(demo_buildings,demo_notice))
demo_roads=[]
for n,(e,g) in enumerate(selected_roads,1):
    road=g.buffer(2.25 if e['tags']['highway'] in ['footway','path','pedestrian'] else 3,cap_style=2,join_style=2)
    if road.geom_type not in ['Polygon','MultiPolygon']:continue
    demo_roads.append(feature(road,{'source_id':f'demo-road-{n:02d}','name':'DEMO width - '+e['tags'].get('name',e['tags']['highway']),'source_osm_way':str(e['id']),'source_provider':'OpenStreetMap + assumed demonstration width','attribution':'© OpenStreetMap contributors','license':'ODbL-1.0','notice':'Synthetic road-surface corridor around observed centreline. Width assumed 6m (paths 4.5m); not a surveyed road or right-of-way boundary.'}))
save('demo-road-widths.geojson',collection(demo_roads,'FICTIONAL widths around mapped centrelines; not legal road boundaries'))
demo_parcels=[];plans=[]
for n,(_,i,e,g) in enumerate(primary,1):
    demo_parcels.append(feature(g.buffer(1,join_style=2),{'source_id':f'demo-parcel-{n:02d}','name':f'DEMO Parcel {n:02d} - fictional','demo_identifier':f'DEMO-UN-P{n:02d}','notice':'Authored buffer for demonstration linkage only; no official cadastral evidence.'}))
    # A rotated, inset rectangular layout strictly contained in the mapped footprint.
    rect=g.minimum_rotated_rectangle
    center0=rect.centroid;corners=list(rect.exterior.coords)[:4]
    origin=corners[0];dx=corners[1][0]-origin[0];dy=corners[1][1]-origin[1];w=math.hypot(dx,dy);ux,uy=dx/w,dy/w
    dx2=corners[3][0]-origin[0];dy2=corners[3][1]-origin[1];d=math.hypot(dx2,dy2);vx,vy=dx2/d,dy2/d
    def ring(x,y,rw,rd):return [[origin[0]+(xx)*ux+(yy)*vx,origin[1]+xx*uy+yy*vy] for xx,yy in [(x,y),(x+rw,y),(x+rw,y+rd),(x,y+rd),(x,y)]]
    inset=.6
    layout=[('A','Living / sleeping room A',inset,inset,(w-2*inset)*.42,d-2*inset),('B','Living / sleeping room B',inset+(w-2*inset)*.58,inset,(w-2*inset)*.42,d-2*inset),('C','Common stairs and passage',inset+(w-2*inset)*.42,inset,(w-2*inset)*.16,d-2*inset)]
    rooms=[]
    for alias,name,x,y,rw,rd in layout:
        polygon=Polygon(ring(x,y,rw,rd))
        if not g.buffer(.01).covers(polygon):raise RuntimeError(f'Demo layout not contained in mapped footprint {e["id"]}')
        rooms.append({'suffix':alias,'name':name,'projected_ring':list(polygon.exterior.coords),'area_m2':polygon.area,'common':alias=='C'})
    plans.append({'demo_key':f'demo-building-{i:02d}','demo_number':n,'osm_way':str(e['id']),'floors':3,'floor_height':3,'rooms':rooms})
save('demo-parcels.geojson',collection(demo_parcels,'FICTIONAL parcel buffers. These are not cadastral/ownership boundaries.'))
# Introduce a bounded road crossing and a shed overlap without changing observed records.
target=primary[0][3];minx,miny,maxx,maxy=target.bounds;cy=(miny+maxy)/2
crossing=box(minx-4,cy-1.5,maxx+4,cy+1.5)
shed=box(minx+(maxx-minx)*.70,miny+(maxy-miny)*.65,maxx+2,maxy+2)
save('demo-conflict-road.geojson',collection([feature(crossing,{'source_id':'demo-crossing-01','name':'DEMO proposed crossing - fictional conflict','notice':'Deliberately authored synthetic road crossing a demo copy; no real project or encroachment alleged.'})],'FICTIONAL road overlap test'))
save('demo-conflict-shed.geojson',collection([feature(shed,{'source_id':'demo-shed-01','name':'DEMO overlapping shed - fictional conflict','height_m':3,'notice':'Deliberately authored synthetic shed intersecting a demo copy of a footprint.'})],'FICTIONAL building overlap test'))
save('demo-plan-spec.json',{'notice':demo_notice,'analysis_crs':'EPSG:32643','benchmark':'DEMO-UN-GROUND-0-NOT-SURVEYED','plans':plans,'expected_conflicts':{'target_key':plans[0]['demo_key'],'road_overlap_m2':target.intersection(crossing).area,'shed_overlap_m2':target.intersection(shed).area}})
report={'selection':'Road-centreline polygonization, chosen within 550m of OSM Uttam Nagar suburb node; not an official administrative block','source_locality':locality['display_name'],'block_area_m2':block.area,'center_lonlat':list(transform(inverse,block.centroid).coords)[0],'extent_lonlat':list(transform(inverse,extent).bounds),'buildings':len(selected),'road_path_features':len(selected_roads),'road_names':road_names,'detailed_demo_buildings':3,'demo_floors':9,'demo_spaces':27,'fictional_resident_rooms':18,'excluded_source_objects':excluded,'osm_timestamp':raw.get('osm3s',{}).get('timestamp_osm_base')}
save('selection-report.json',report)
print(json.dumps(report,ensure_ascii=False,indent=2))
