"""Authored fictional neighborhood: originals and presentation meshes, never computed results."""
import json, struct, math, hashlib
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'fixtures/reference-neighborhood'
ASSETS=ROOT/'apps/web/public/scene-assets/reference'
OUT.mkdir(exist_ok=True); ASSETS.mkdir(parents=True,exist_ok=True)
BUILDINGS=[
 dict(key='A',name='12 Lake View Road',x=14,y=14,w=20,d=18,floors=4,color='#d6c7b4',roof='terrace'),
 dict(key='B',name='18 Lake View Road',x=46,y=14,w=18,d=20,floors=3,color='#c9d2cf',roof='gable'),
 dict(key='C',name='24 Lake View Road',x=78,y=14,w=20,d=18,floors=5,color='#e5d6c4',roof='terrace'),
 dict(key='D',name='2 Park Lane',x=110,y=14,w=16,d=20,floors=3,color='#cbd0d4',roof='gable'),
 dict(key='E',name='7 Garden Walk',x=14,y=66,w=18,d=16,floors=2,color='#e1d9c9',roof='gable'),
 dict(key='F',name='11 Garden Walk',x=46,y=66,w=20,d=20,floors=4,color='#d7c8bf',roof='terrace'),
 dict(key='G',name='15 Garden Walk',x=78,y=66,w=16,d=18,floors=3,color='#ced5cd',roof='terrace'),
 dict(key='H',name='6 Park Lane',x=110,y=66,w=18,d=20,floors=4,color='#ddd6c5',roof='gable')]
# glTF uses X=east, Y=up, Z=-north; Cesium's model loader transforms to ENU.
class Mesh:
 def __init__(self): self.groups={}
 def quad(self,points,color):
  pos,norm=self.groups.setdefault(color,([],[]))
  u=[points[1][i]-points[0][i] for i in range(3)];v=[points[2][i]-points[0][i] for i in range(3)]
  n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]; l=math.sqrt(sum(x*x for x in n)) or 1;n=[x/l for x in n]
  for idx in [0,1,2,0,2,3]: pos.extend(points[idx]);norm.extend(n)
 def box(self,x,y,z,w,d,h,color):
  a=(x,z,-y);b=(x+w,z,-y);c=(x+w,z,-y-d);e=(x,z,-y-d)
  A=(x,z+h,-y);B=(x+w,z+h,-y);C=(x+w,z+h,-y-d);E=(x,z+h,-y-d)
  for face in [(a,b,B,A),(b,c,C,B),(c,e,E,C),(e,a,A,E),(A,B,C,E),(e,c,b,a)]:self.quad(face,color)
 def save(self,target):
  buf=bytearray();views=[];access=[];prims=[];mats=[]
  def attr(data):
   start=len(buf);buf.extend(struct.pack('<'+'f'*len(data),*data)); views.append(dict(buffer=0,byteOffset=start,byteLength=len(data)*4,target=34962));
   triples=[data[i:i+3] for i in range(0,len(data),3)];access.append(dict(bufferView=len(views)-1,componentType=5126,count=len(triples),type='VEC3',min=[min(p[i] for p in triples) for i in range(3)],max=[max(p[i] for p in triples) for i in range(3)]));return len(access)-1
  for color,(p,n) in self.groups.items():
   rgb=[int(color[i:i+2],16)/255 for i in (1,3,5)];rgb=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
   mats.append(dict(pbrMetallicRoughness=dict(baseColorFactor=rgb+[1],metallicFactor=.05,roughnessFactor=.8),doubleSided=True))
   prims.append(dict(attributes=dict(POSITION=attr(p),NORMAL=attr(n)),material=len(mats)-1))
  doc=dict(asset=dict(version='2.0',generator='3D ULPIN fictional demonstration asset'),scene=0,scenes=[dict(nodes=[0])],nodes=[dict(mesh=0)],meshes=[dict(primitives=prims)],materials=mats,buffers=[dict(byteLength=len(buf))],bufferViews=views,accessors=access)
  js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);buf+=b'\0'*((-len(buf))%4)
  target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(buf))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(buf),0x004e4942)+buf)

def rooms(b):
 w,d=b['w'],b['d']; left=(w-3)/2
 return [('01','Living / dining',.3,.3,left-.3,d/2-.4),('02','Bedroom',.3,d/2+.1,left-.3,d/2-.4),('03','Studio',left+3,.3,left-.3,d/2-.4),('04','Bedroom / study',left+3,d/2+.1,left-.3,d/2-.4),('C','Common hall & stairs',left,.3,3,d-.6)]
def plans(b,revision=1):
 target=OUT/(f"{b['key']}-floor-plans.pdf" if revision==1 else f"{b['key']}-floor-plans-revision-{revision}.pdf"); c=canvas.Canvas(str(target),pagesize=(1000,760),invariant=1)
 for f in range(b['floors']):
  c.setFillColor(HexColor('#203d37'));c.setFont('Helvetica-Bold',20);c.drawString(55,713,b['name']);c.setFont('Helvetica',11);c.drawString(55,693,(f"Revision {revision} | " if b['key']=='D' else "")+f"{'Ground floor' if f==0 else 'Floor '+str(f)} | Authored demonstration plan | metres")
  scale=min(700/b['w'],500/b['d']);ox=(1000-b['w']*scale)/2;oy=115
  def line(x1,y1,x2,y2,width=1):c.setLineWidth(width);c.line(ox+x1*scale,oy+y1*scale,ox+x2*scale,oy+y2*scale)
  c.setStrokeColor(HexColor('#344644'));c.setFillColor(HexColor('#fcfcf8'));c.setLineWidth(4);c.rect(ox,oy,b['w']*scale,b['d']*scale,fill=1)
  for alias,name,x,y,w,d in rooms(b):
   c.setFillColor(HexColor('#edf2ec' if alias=='C' else '#faf8f2'));c.setLineWidth(2);c.rect(ox+x*scale,oy+y*scale,w*scale,d*scale,fill=1)
   c.setFillColor(HexColor('#344644'));c.setFont('Helvetica-Bold',10);c.drawCentredString(ox+(x+w/2)*scale,oy+(y+d/2)*scale,name);c.setFont('Helvetica',9);c.drawCentredString(ox+(x+w/2)*scale,oy+(y+d/2)*scale-16,f"{w:.2f} x {d:.2f} m")
   if alias=='C':
    for n in range(12):line(x+.3,y+.5+n*.23,x+w-.3,y+.5+n*.23,.6)
   else:
    # Door opening and swing are authored symbols, not inferred extraction.
    door_x=x+w-.95;c.setStrokeColor(HexColor('#ffffff'));line(door_x,y,door_x+.85,y,4);c.setStrokeColor(HexColor('#344644'));line(door_x,y,door_x,y+.85,.8);c.arc(ox+(door_x-.85)*scale,oy+(y-.85)*scale,ox+(door_x+.85)*scale,oy+(y+.85)*scale,0,90)
  c.setStrokeColor(HexColor('#577d91'));c.setLineWidth(3)
  for x in range(2,int(b['w'])-1,4):line(x,0,x+1.6,0,3);line(x,b['d'],x+1.6,b['d'],3)
  c.setStrokeColor(HexColor('#61716a'));line(0,-1.1,b['w'],-1.1,.7)
  for x in [0,b['w']]:line(x,-.5,x,-1.6,.7)
  c.setFont('Helvetica',10);c.setFillColor(HexColor('#344644'));c.drawCentredString(500,oy-27,f"{b['w']:.2f} m")
  c.setFont('Helvetica',9);c.drawString(55,58,f"Level {f*3.2:.2f}–{(f+1)*3.2:.2f} m | BM-LAKEVIEW-DEMO | Sheet {f+1}/{b['floors']}")
  c.setFillColor(HexColor('#9c633c'));c.drawString(55,40,'FICTIONAL DEMONSTRATION • NOT A SURVEY, APPROVAL OR OWNERSHIP RECORD')
  c.setStrokeColor(HexColor('#dce4df'));c.line(55,78,945,78);c.showPage()
 c.save();doc=pdfium.PdfDocument(str(target))
 if revision==1:
  for f,page in enumerate(doc):page.render(scale=1.4).to_pil().save(OUT/f"{b['key']}-floor-{f}.png")

for b in BUILDINGS:
 m=Mesh();w,d,h=b['w'],b['d'],b['floors']*3.2
 m.box(0,0,0,w,d,h,b['color'])
 for f in range(b['floors']):
  z=f*3.2
  m.box(-.22,-.22,z+.15,w+.44,d+.44,.18,'#f0eee6')
  for x in range(2,int(w)-1,4):
   for y in [-.10,d-.02]:
    m.box(x-.12,y-.06,z+.95,1.65,.22,1.65,'#eeeae1');m.box(x,y-.12,z+1.05,1.4,.24,1.4,'#506b79');m.box(x+.65,y-.14,z+1.05,.08,.27,1.4,'#cad4d5')
  for y in range(2,int(d)-1,4):
   for x in [-.1,w-.03]:m.box(x,y,z+1.05,.23,1.5,1.4,'#516a77')
  if f>0:
   m.box(w/2-2,-1.2,z,4,1.3,.2,'#e9e5db');m.box(w/2-2,-1.2,z+.2,4,.13,.85,'#bac4c0')
 m.box(w/2-1,-.2,0,2,.3,2.35,'#485e5a');m.box(w/2-1.6,-1.4,2.5,3.2,1.5,.18,'#dedbd1')
 if b['roof']=='terrace':
  m.box(-.2,-.2,h,w+.4,d+.4,.25,'#eeece4')
  for x,y,bw,bd in [(0,0,w,.2),(0,d-.2,w,.2),(0,0,.2,d),(w-.2,0,.2,d)]:m.box(x,y,h+.25,bw,bd,.65,'#d3d2c8')
  m.box(w/2-2,d/2-2,h+.2,4,4,1.8,b['color']);m.box(w/2-2.2,d/2-2.2,h+2,4.4,4.4,.18,'#ebe9df')
 else:
  m.quad([(-.6,h, .6),(w+.6,h,.6),(w+.6,h+2.5,-d/2),(-.6,h+2.5,-d/2)],'#718079')
  m.quad([(-.6,h+2.5,-d/2),(w+.6,h+2.5,-d/2),(w+.6,h,-d-.6),(-.6,h,-d-.6)],'#5e706b')
 target=ASSETS/f"{b['key']}.glb";m.save(target);b['assetHash']=hashlib.sha256(target.read_bytes()).hexdigest();b['rooms']=[dict(alias=a,name=n,x=x,y=y,w=w,d=d) for a,n,x,y,w,d in rooms(b)]
 if b['key'] in 'ABCD':plans(b)
plans(BUILDINGS[3],2)
# Streetscape is a separate authored presentation mesh; it does not enter checks.
land=Mesh()
land.box(-5,-5,-.15,153,113,.12,'#a8b698')
land.box(0,39,0,142,18,.1,'#dad8cb');land.box(0,42,.11,142,12,.04,'#65706e')
land.box(129,0,0,16,104,.1,'#dad8cb');land.box(132,0,.11,10,104,.04,'#65706e')
for x in range(2,130,7):land.box(x,47.8,.17,3,.18,.02,'#eae6cf')
for y in range(2,101,7):land.box(136.8,y,.17,.18,3,.02,'#eae6cf')
for b in BUILDINGS:
 land.box(b['x']-3,b['y']-3,-.01,b['w']+6,b['d']+6,.10,'#b9c3a5')
 land.box(b['x']+b['w']/2-1,b['y']-3,.11,2,3,.06,'#d7d5c9')
# Low-poly canopies with deterministic variation, modeled as display-only landscaping.
def tree(x,y,r=2.0):
 land.box(x-.15,y-.15,0,.3,.3,2.6,'#786c52')
 for row in range(6):
  p0=-math.pi/2+row*math.pi/6;p1=p0+math.pi/6
  for col in range(9):
   q0=col*2*math.pi/9;q1=q0+2*math.pi/9
   def vertex(p,q):return (x+r*math.cos(p)*math.cos(q),3.3+r*1.25*math.sin(p),-y-r*math.cos(p)*math.sin(q))
   color=['#6f8952','#7e975a','#587948','#8ba568'][(col+row)%4]
   land.quad([vertex(p0,q0),vertex(p0,q1),vertex(p1,q1),vertex(p1,q0)],color)
for x in range(4,130,8):
 tree(x,38,1.7);tree(x,60,1.7);tree(x,98,2.5)
for y in range(5,95,9):tree(5,y,2)
for x in range(20,120,20):
 land.box(x,92,.12,3,1,.55,'#897c60')
for x in range(120,131,2):land.box(x,43,.18,.75,10,.02,'#eae7db')
target=ASSETS/'landscape.glb';land.save(target)
landscapeHash=hashlib.sha256(target.read_bytes()).hexdigest()
(OUT/'spec.json').write_text(json.dumps(dict(name='Lake View · demonstration',origin=[520000,3150000],benchmark='BM-LAKEVIEW-DEMO',landscapeHash=landscapeHash,buildings=BUILDINGS),indent=2)+'\n')
(OUT/'README.md').write_text('# Lake View demonstration neighborhood\n\nAll geometry, plans, names and display assets are authored fictional inputs. No survey, statutory, ownership, observed-utility or geographic claim. Display placement uses a separate synthetic EPSG:32643 location. Run scripts/reference/generate.py to recreate originals and presentation GLBs; run pnpm demo:seed to import, process, review and persist them. Metrics and findings are computed by the application, not this generator.\n')
print('Generated eight building assets, one streetscape, and matching original plans for the fictional neighborhood.')
