"""Author an explicitly fictional test copy. No database access or actual residents."""
import json,math
from pathlib import Path
from shapely.geometry import shape,mapping,box
from shapely.ops import transform
from shapely import affinity
from pyproj import Transformer
from PIL import Image,ImageDraw,ImageFont
root=Path('/tmp/uttam-output');out=root/'scenario';out.mkdir(exist_ok=True)
fwd=Transformer.from_crs(4326,32643,always_xy=True).transform
back=Transformer.from_crs(32643,4326,always_xy=True).transform
selection=json.load(open(root/'selection.json'))
original=json.load(open(root/'uttam-nagar-buildings.geojson'))
roads=json.load(open(root/'uttam-nagar-roads.geojson'))
chosen=selection['detailCandidates'][:3]
chosen_ids={v['osm_id']:chr(65+i) for i,v in enumerate(chosen)}
notice='SYNTHETIC TEST FIXTURE. Map-derived outline only. Heights, floors, rooms, people, parcels and test conflicts are invented. No real household, cadastral or official ULPIN claim.'
credit={'attribution':'© OpenStreetMap contributors','license':'ODbL-1.0','provenance':notice}
def fc(features):return {'type':'FeatureCollection','metadata':{'notice':notice,'license':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'© OpenStreetMap contributors','reference_bbox':selection['bbox']},'features':features}
def feature(key,name,geom,extra=None):return {'type':'Feature','properties':{'id':key,'name':name,**credit,**(extra or {})},'geometry':mapping(geom)}
buildings=[]
for i,item in enumerate(original['features']):
    key=item['properties']['osm_id'];letter=chosen_ids.get(key);floors=3 if letter else 2+(i%3)
    buildings.append(feature('demo-'+key,'DEMO Building '+letter if letter else 'DEMO outline '+key.split('/')[1],shape(item['geometry']),{'source_osm_id':key,'source_url':item['properties']['source_url'],'height':floors*3.2,'floors':floors,'height_basis':'Invented scenario height, not observed'}))
road_polygons=[]
for item in roads['features']:
    name=item['properties']['name'];width=6 if name in ('School Road','Arya Samaj Road') else 4
    polygon=transform(back,transform(fwd,shape(item['geometry'])).buffer(width/2,cap_style=2,join_style=2))
    road_polygons.append(feature('demo-road-'+item['properties']['osm_id'],'DEMO assumed width | '+name,polygon,{'source_osm_id':item['properties']['osm_id'],'assumed_width_m':width,'provenance':'Invented test width around OSM centreline, not surveyed road land'}))
parcels=[];plans=[];residents=[]
for i,candidate in enumerate(chosen):
    key=chr(65+i);polygon=transform(fwd,shape(candidate['geometry']));centre=polygon.centroid
    rectangle=list(polygon.minimum_rotated_rectangle.exterior.coords)
    a,b=max(zip(rectangle,rectangle[1:]),key=lambda ab:math.dist(*ab))
    angle=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))
    local=affinity.rotate(polygon,-angle,origin=centre).buffer(-.2,join_style=2)
    x0,y0,x1,y1=local.bounds;hall=min(1.3,(y1-y0)*.22)
    parts=[('C','DEMO common corridor',box(x0,y0,x1,y0+hall))]
    parts += [('R'+str(j+1),'DEMO room '+str(j+1),box(x0+(x1-x0)*j/3+.06,y0+hall+.12,x0+(x1-x0)*(j+1)/3-.06,y1))for j in range(3)]
    rooms=[]
    for suffix,label,part in parts:
        clipped=local.intersection(part)
        if clipped.geom_type!='Polygon' or clipped.interiors or clipped.area<2:raise RuntimeError('Room split requires explicit review')
        absolute=affinity.rotate(clipped,angle,origin=centre)
        if not polygon.covers(absolute.buffer(-.001)):raise RuntimeError('Room exceeds parent')
        rooms.append({'suffix':suffix,'label':label,'absolutePolygon':mapping(absolute),'area_m2':absolute.area,'previewPolygon':mapping(clipped)})
    parcels.append(feature('demo-parcel-'+key,'DEMO Parcel '+key,transform(back,polygon.buffer(.5,join_style=2)),{'demo_parcel_id':f'DEMO-UN-P{i+1:02}','provenance':'Invented half-metre buffer around mapped outline. NOT cadastral land boundary.'}))
    for floor in range(3):
        for room in rooms:
            alias=f'UN-{key}-{floor}-{room["suffix"]}'
            residents.append({'alias':alias,'building':key,'floor':floor,'room':room['suffix'],'party':f'DEMO Resident {key}{floor+1}{room["suffix"]} (fictional)' if room['suffix']!='C' else f'DEMO common-use group {key}{floor+1} (fictional)','common':room['suffix']=='C','lower':floor*3.2,'upper':(floor+1)*3.2})
    plans.append({'key':key,'source_osm_id':candidate['osm_id'],'demo_source_id':'demo-'+candidate['osm_id'],'floors':3,'outline':mapping(polygon),'rooms':rooms,'notice':notice})
    im=Image.new('RGB',(1400,1000),'white');draw=ImageDraw.Draw(im);font=ImageFont.load_default(size=23);title=ImageFont.load_default(size=34)
    draw.text((50,35),f'DEMO Building {key} | Invented typical floor plan',font=title,fill='#163d38')
    draw.text((50,90),'FICTIONAL INTERIOR - NOT A REAL HOUSEHOLD OR SURVEY',font=font,fill='#a12925')
    scale=min(1000/(x1-x0),660/(y1-y0));mx=700-(x1-x0)*scale/2
    def xy(p):return(mx+(p[0]-x0)*scale,200+(y1-p[1])*scale)
    for j,r in enumerate(rooms):
        g=shape(r['previewPolygon']);draw.polygon([xy(p)for p in g.exterior.coords],fill=['#e6dfc6','#dce9e2','#e0e9ef','#eee3d8'][j],outline='#355c51',width=4)
        x,y=xy(g.centroid.coords[0]);draw.text((x-90,y-15),r['label'],font=font,fill='#163d38');draw.text((x-55,y+18),f'{r["area_m2"]:.2f} m2',font=font,fill='#163d38')
    draw.text((50,905),'Assumed floors: Ground / First / Second. Assumed floor-to-floor height: 3.2 m.',font=font,fill='#354b48')
    draw.text((50,944),'Outline: OpenStreetMap contributors (ODbL). Rooms and occupants: invented.',font=font,fill='#354b48')
    im.save(out/f'DEMO-{key}-floor-plan.png')
outline=shape(plans[0]['outline']);cx,cy=outline.centroid.coords[0]
corridor=box(cx-22,cy-1.5,cx+22,cy+1.5);kiosk=box(cx-2,cy-2,cx+2,cy+2)
road_polygons.append(feature('DEMO-TEST-CORRIDOR','DEMO invented widening corridor | test only',transform(back,corridor),{'provenance':'Invented corridor through DEMO A for testing; not a real development or allegation.'}))
buildings.append(feature('DEMO-TEST-KIOSK','DEMO overlapping kiosk | test only',transform(back,kiosk),{'height':3.2,'floors':1,'provenance':'Invented overlapping kiosk for testing; not an existing structure.'}))
for file,items in [('demo-buildings.geojson',buildings),('demo-road-widths.geojson',road_polygons),('demo-parcels.geojson',parcels)]:json.dump(fc(items),open(out/file,'w'),indent=2)
json.dump({'notice':notice,'buildings':plans,'residents':residents,'expected_corridor_intersection_A_m2':outline.intersection(corridor).area,'expected_kiosk_intersection_A_m2':outline.intersection(kiosk).area},open(out/'interior-plan.json','w'),indent=2)
print(json.dumps({'buildings':len(buildings),'roadPolygons':len(road_polygons),'parcels':len(parcels),'floors':9,'spaces':len(residents),'fictionalOccupants':27,'corridorOverlapM2':outline.intersection(corridor).area,'kioskOverlapM2':outline.intersection(kiosk).area}))
