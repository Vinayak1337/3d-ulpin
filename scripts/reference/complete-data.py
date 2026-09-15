"""Additive fictional inputs. Existing plans, properties and history are untouched."""
import json, hashlib
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from mesh import Mesh
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'fixtures/complete-demo'; OUT.mkdir(exist_ok=True)
base=json.loads((ROOT/'fixtures/reference-neighborhood/spec.json').read_text())
spec={
 'name':'Lake View complete demo', 'worldStatus':'synthetic',
 'origin':base['origin'], 'crs':'EPSG:32643', 'benchmark':base['benchmark'],
 'notice':'Entirely fictional training data. Demo parcel IDs are not government-issued ULPINs. Overlaps are geometric checks, not legal findings.',
 'additions':[
  {'key':'R3','kind':'road','name':'Fictional Lake View widening corridor','x':0,'y':30,'w':104,'d':12,'geometryRole':'public_road_land'},
  {'key':'K1','kind':'building','name':'Fictional service kiosk','x':62,'y':28,'w':6,'d':8,'height':3.2,'geometryRole':'observed_ground_occupation'}
 ],
 'parcelIds':[{'parcelKey':'P-'+b['key'],'propertyKey':b['key'],'value':'DEMO-LV-P0'+str(i+1)} for i,b in enumerate(base['buildings'])]
}
def feature(b):
 x,y=spec['origin'][0]+b['x'],spec['origin'][1]+b['y'];w,d=b['w'],b['d']
 return {'type':'Feature','properties':b,'geometry':{'type':'Polygon','coordinates':[[[x,y],[x+w,y],[x+w,y+d],[x,y+d],[x,y]]]}}
for b in spec['additions']:
 (OUT/(b['key']+'.arcgis.json')).write_text(json.dumps({'spatialReference':{'wkid':32643},'features':[{'attributes':b,'geometry':{'rings':feature(b)['geometry']['coordinates']}}]},indent=2)+'\n')
(OUT/'parcel-identifiers.csv').write_text('parcel_key,property_key,demo_2d_ulpin,scope\n'+''.join(f"{p['parcelKey']},{p['propertyKey']},{p['value']},Fictional training identifier - not officially issued\n" for p in spec['parcelIds']))
m=Mesh();m.box(0,0,0,6,8,3.2,'#dad4c1');m.box(-.2,-.2,3.2,6.4,8.4,.25,'#647a71')
for x in [1,3.8]:
 m.box(x,-.03,1.2,1.3,.06,1.3,'#7098a1');m.box(x,7.98,1.2,1.3,.06,1.3,'#7098a1')
m.box(5.98,2,0,.06,1.4,2.3,'#584d42');m.box(5.9,1.8,2.5,.9,1.8,.15,'#647a71')
asset=ROOT/'apps/web/public/scene-assets/complete-demo/kiosk.glb';asset.parent.mkdir(exist_ok=True);m.save(asset)
spec['kioskAssetHash']=hashlib.sha256(asset.read_bytes()).hexdigest()
(OUT/'spec.json').write_text(json.dumps(spec,indent=2)+'\n')
c=canvas.Canvas(str(OUT/'site-and-identity-schedule.pdf'),pagesize=(1000,760),invariant=1)
c.setFillColor(HexColor('#203d37'));c.setFont('Helvetica-Bold',24);c.drawString(44,711,'Lake View | complete training block')
c.setFont('Helvetica',11);c.drawString(44,690,'FICTIONAL DEMO - Not a survey, ownership record or government-issued ULPIN')
ox,oy,scale=54,200,5
for x,y,w,d in [(0,42,140,12),(132,0,10,99)]:
 c.setFillColor(HexColor('#ccd1cc'));c.rect(ox+x*scale,oy+y*scale,w*scale,d*scale,stroke=0,fill=1)
for b in base['buildings']:
 c.setFillColor(HexColor('#edf3ec'));c.setStrokeColor(HexColor('#587b72'));c.rect(ox+(b['x']-3)*scale,oy+(b['y']-3)*scale,(b['w']+6)*scale,(b['d']+6)*scale,fill=1)
 c.setFillColor(HexColor(b['color']));c.rect(ox+b['x']*scale,oy+b['y']*scale,b['w']*scale,b['d']*scale,fill=1)
 c.setFillColor(HexColor('#203d37'));c.drawCentredString(ox+(b['x']+b['w']/2)*scale,oy+(b['y']+b['d']/2)*scale,b['key'])
for b in spec['additions']:
 c.setStrokeColor(HexColor('#b95646'));c.setFillColor(HexColor('#b95646'));c.setLineWidth(2);c.rect(ox+b['x']*scale,oy+b['y']*scale,b['w']*scale,b['d']*scale,fill=0);c.drawString(ox+b['x']*scale,oy+(b['y']+b['d'])*scale+5,b['key'])
c.setFont('Helvetica-Bold',11);c.drawString(44,166,'Authored additions: R3 road widening corridor; K1 service kiosk')
c.setFont('Helvetica',10);c.drawString(44,149,'The application calculates overlaps from these inputs. This sheet contains no claimed computed results.')
c.drawString(44,132,'Grid: EPSG:32643; origin 520000, 3150000 m; vertical benchmark BM-LAKEVIEW-DEMO.')
for i,p in enumerate(spec['parcelIds']):
 c.drawString(44+(i%4)*225,102-(i//4)*20,p['parcelKey']+'  |  '+p['value'])
c.drawString(44,44,'Existing matching floor plans and level schedules remain in the Lake View source packet.');c.showPage();c.save()
print('Authored site plan, parcel schedule, two spatial layers and kiosk presentation mesh.')
