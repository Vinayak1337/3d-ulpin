"""Small deterministic mesh writer for fictional presentation assets."""
import json, struct, math
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

