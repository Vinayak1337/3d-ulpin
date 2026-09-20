/** Authored synthetic display assets. Never used for cadastral measurements. */
export function createEnvironment(data, { THREE, geometryFor, detail = 'full' }) {
  const dense = data.sceneDecoration?.urbanForm === 'dense_plotted';
  const group = new THREE.Group(); group.name = 'Synthetic streets and landscape';
  const layerRefs = Object.fromEntries(['parcels','roads','publicLand','trees','utilities','utilityGuides'].map(k => [k,new THREE.Group()]));
  Object.entries(layerRefs).forEach(([k,g])=>{g.name=k;group.add(g)});
  let seed=721; const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const textures=[]; const materials=[];
  function texture(base,variation,tile=16,pavers=false){
    if(typeof document==='undefined')return null;
    const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');if(!ctx)return null;
    const im=ctx.createImageData(256,256);
    for(let i=0;i<im.data.length;i+=4){const n=(random()-.5)*variation;for(let k=0;k<3;k++)im.data[i+k]=base[k]+n;im.data[i+3]=255}ctx.putImageData(im,0,0);
    if(pavers){ctx.strokeStyle='rgba(60,60,52,.22)';ctx.lineWidth=1;for(let y=0;y<256;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(256,y);ctx.stroke();for(let x=(y/32%2)*32;x<256;x+=64){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+32);ctx.stroke()}}}
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/tile,1/tile);t.anisotropy=8;textures.push(t);return t;
  }
  const mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.94,...extra});materials.push(m);return m};
  const grass=mat('#ffffff',{map:texture([141,155,119],38,9)}),asphalt=mat('#ffffff',{map:texture([104,107,105],30,8)}),paving=mat('#ffffff',{map:texture([183,180,164],25,5,true)}),soil=mat('#8e9670'),wall=mat('#c0bcae'),white=mat('#e6e2cc'),metal=mat('#59645d');
  function mesh(geo,material,parent=group){const m=new THREE.Mesh(geo,material);m.receiveShadow=true;parent.add(m);return m}
  function rect(x,y,w,h,z,material,parent=group){const g=new THREE.PlaneGeometry(w,h);g.rotateX(-Math.PI/2);const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w,uv.getY(i)*h);const m=mesh(g,material,parent);m.position.set(x,z,-y);return m}
  function shape(poly){const s=new THREE.Shape(poly[0].map(p=>new THREE.Vector2(p[0],p[1])));for(const ring of poly.slice(1))s.holes.push(new THREE.Path(ring.map(p=>new THREE.Vector2(p[0],p[1]))));return s}
  function surface(poly,z,material,parent){const geo=new THREE.ShapeGeometry(shape(poly));geo.rotateX(-Math.PI/2);return mesh(geo,material,parent).translateY(z)}
  function line(points,z,color,parent,closed=false){const p=points.map(a=>new THREE.Vector3(a[0],z,-a[1]));if(closed)p.push(p[0]);const g=new THREE.BufferGeometry().setFromPoints(p);const m=new THREE.LineBasicMaterial({color,transparent:true,opacity:1});materials.push(m);const l=new THREE.Line(g,m);parent.add(l);return l}
  const polygons = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const closedRing = ring => ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  function inRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  const inside = (p, rings) => inRing(p, rings[0]) && !rings.slice(1).some(ring => inRing(p, ring));
  const extent=data.metadata.extent||[0,0,180,180],cx=(extent[0]+extent[2])/2,cy=(extent[1]+extent[3])/2;
  const surfaceObjects=data.objects.filter(o=>polygons(geometryFor(o)).length);
  const bases=surfaceObjects.filter(o=>['parcel','road','open_area'].includes(o.type)).map(o=>geometryFor(o).baseElevationM).filter(Number.isFinite);
  if(!bases.length)bases.push(...surfaceObjects.filter(o=>o.type==='building').map(o=>geometryFor(o).baseElevationM).filter(Number.isFinite));
  const groundBase=bases.length?Math.min(...bases):0;
  const ground=rect(cx,cy,extent[2]-extent[0]+140,extent[3]-extent[1]+140,groundBase-.13,data.sceneDecoration?.ground==='paved'?paving:grass);
  ground.name='Synthetic display ground · not surveyed terrain';
  const roadParts=[];
  function identifySurface(mesh, object, geometry) {
    mesh.userData={objectId:object.id,geometryId:geometry.id,syntheticDecoration:false,displayRole:geometry.displayRole||'source_surface'};
    return mesh;
  }
  for(const object of surfaceObjects){
    const geometry=geometryFor(object),base=Number.isFinite(geometry.baseElevationM)?geometry.baseElevationM:0;
    for(const poly of polygons(geometry)){
      if(object.type==='parcel'){
        identifySurface(surface(poly,base+.018,dense?paving:(random()>.35?grass:paving),layerRefs.parcels),object,geometry);
        poly.forEach(ring=>line(ring,base+.78,'#ffffff',layerRefs.parcels,true));
        if(detail==='full'&&data.sceneDecoration?.plotWalls!==false){
          const ring=closedRing(poly[0]);
          for(let i=0;i<ring.length;i++){
            const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<1)continue;
            const gap=i===0?Math.min(3.2,len*.6):0,span=(len-gap)/2;
            for(const offset of gap?[span/2,len-span/2]:[len/2]){
              const length=gap?span:len,m=mesh(new THREE.BoxGeometry(length,.68,.12),wall,layerRefs.parcels);
              m.position.set(a[0]+(b[0]-a[0])*offset/len,base+.4,-(a[1]+(b[1]-a[1])*offset/len));
              m.rotation.y=Math.atan2(b[1]-a[1],b[0]-a[0]);m.castShadow=true;
              m.userData={syntheticDecoration:true,objectId:object.id,displayRole:'illustrative_boundary_wall'};
            }
          }
        }
      }
      if(object.type==='open_area'){
        identifySurface(surface(poly,base+.04,grass,layerRefs.publicLand),object,geometry);
        poly.forEach(ring=>line(ring,base+.1,'#c3bca1',layerRefs.publicLand,true));
      }
      if(object.type==='road'){
        identifySurface(surface(poly,base+.07,asphalt,layerRefs.roads),object,geometry);
        roadParts.push({object,geometry,poly,base});
      }
    }
  }
  // A source centreline is displayed as its exact line, never as a guessed road corridor.
  for(const object of data.objects.filter(o=>o.type==='road')){const geometry=geometryFor(object);if(geometry?.type!=='LineString')continue;const points=geometry.coordinates.map(p=>new THREE.Vector3(p[0],Number.isFinite(p[2])?p[2]:Number.isFinite(geometry.baseElevationM)?geometry.baseElevationM:.06,-p[1]));const roadLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#546469'}));materials.push(roadLine.material);roadLine.name='Source road centreline · corridor unavailable';roadLine.userData={objectId:object.id,geometryId:geometry.id,syntheticDecoration:false,displayRole:'source_centerline'};layerRefs.roads.add(roadLine);}
  // Pavement strips follow source edges, including rotated, concave and multipart
  // roads. Each strip is admitted only wholly inside the supplied road polygon.
  // Junction interiors stay open. These decorations never define road geometry.
  function isInsideStrip(corners, road) {
    for(let i=0;i<corners.length;i++){
      const a=corners[i],b=corners[(i+1)%corners.length];
      for(let j=0;j<=4;j++)if(!inside([a[0]+(b[0]-a[0])*j/4,a[1]+(b[1]-a[1])*j/4],road.poly))return false;
    }
    if(road.poly.slice(1).some(ring=>ring.some(p=>inRing(p,corners))))return false;
    return true;
  }
  const streetLamps=[];
  for(const road of roadParts){
    const ring=closedRing(road.poly[0]),curbWidth=dense?.3:1.05;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.5)continue;
      const tx=(b[0]-a[0])/length,ty=(b[1]-a[1])/length;
      let nx=-ty,ny=tx;
      if(!inside([(a[0]+b[0])/2+nx*.015,(a[1]+b[1])/2+ny*.015],road.poly)){nx=-nx;ny=-ny;}
      const steps=Math.ceil(length/2);
      for(let j=0;j<steps;j++){
        const start=j*length/steps+.025,end=(j+1)*length/steps-.025;
        const corners=[[start,.025],[end,.025],[end,curbWidth],[start,curbWidth]].map(([u,v])=>[a[0]+tx*u+nx*v,a[1]+ty*u+ny*v]);
        if(!isInsideStrip(corners,road))continue;
        const mid=[a[0]+tx*(start+end)/2+nx*curbWidth/2,a[1]+ty*(start+end)/2+ny*curbWidth/2];
        if(roadParts.some(other=>other!==road&&Math.abs(other.base-road.base)<.2&&inside(mid,other.poly)))continue;
        const curb=surface([[...corners,corners[0]]],road.base+.105,paving,layerRefs.roads);
        curb.userData={syntheticDecoration:true,objectId:road.object.id,displayRole:'illustrative_pavement'};
        if(!dense&&detail==='full'&&j%14===6)streetLamps.push({p:mid,base:road.base,normal:[nx,ny]});
      }
    }
    // A rectangular source corridor may receive center markings at any rotation.
    // Irregular corridors need an authored centerline; no bounding-box guess.
    if(ring.length===4&&road.poly.length===1){
      const [a,b,c,d]=ring,ab=[b[0]-a[0],b[1]-a[1]],bc=[c[0]-b[0],c[1]-b[1]],l=Math.hypot(...ab),w=Math.hypot(...bc);
      const rectangle=Math.abs(ab[0]*bc[0]+ab[1]*bc[1])<1e-5*l*w&&Math.hypot(d[0]-(a[0]+bc[0]),d[1]-(a[1]+bc[1]))<1e-5;
      if(rectangle&&Math.min(l,w)>=6){
        const long=l>=w?ab:bc,short=l>=w?bc:ab,span=Math.max(l,w),angle=Math.atan2(long[1],long[0]);
        for(let t=4;t<span-3;t+=7){
          const x=a[0]+short[0]/2+long[0]*t/span,y=a[1]+short[1]/2+long[1]*t/span;
          if(roadParts.some(other=>other!==road&&Math.abs(other.base-road.base)<.2&&inside([x,y],other.poly)))continue;
          const marking=rect(x,y,3,.1,road.base+.12,white,layerRefs.roads);marking.rotation.y=angle;
          marking.userData={syntheticDecoration:true,objectId:road.object.id,displayRole:'illustrative_road_marking'};
        }
      }
    }
  }
  // Consolidate coplanar decoration per road identity/material. Long source
  // boundaries must not create a draw call for each two-metre pavement strip.
  for(const role of ['illustrative_pavement','illustrative_road_marking']){
    const bins=new Map();
    for(const child of layerRefs.roads.children){
      if(child.userData.displayRole!==role)continue;
      const key=child.userData.objectId;
      if(!bins.has(key))bins.set(key,[]);bins.get(key).push(child);
    }
    for(const [objectId,meshes] of bins){
      if(meshes.length<2)continue;
      const positions=[],normals=[],uvs=[],vector=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
      for(const source of meshes){
        source.updateMatrix();normalMatrix.getNormalMatrix(source.matrix);
        const geo=source.geometry,index=geo.index,position=geo.attributes.position,normal=geo.attributes.normal,uv=geo.attributes.uv;
        for(let i=0;i<(index?.count??position.count);i++){
          const n=index?index.getX(i):i;
          vector.fromBufferAttribute(position,n).applyMatrix4(source.matrix);positions.push(vector.x,vector.y,vector.z);
          vector.fromBufferAttribute(normal,n).applyNormalMatrix(normalMatrix);normals.push(vector.x,vector.y,vector.z);
          uvs.push(uv.getX(n),uv.getY(n));
        }
        layerRefs.roads.remove(source);source.geometry.dispose();
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      const combined=mesh(geometry,meshes[0].material,layerRefs.roads);
      combined.userData={syntheticDecoration:true,objectId,displayRole:role};
    }
  }
  // Instanced canopy clusters. Small irregular leaf volumes give soft, dense crowns.
  const authoredTrees=data.sceneDecoration?.trees||[];
  const treeRecords=authoredTrees.map(t=>({p:Array.isArray(t)?t:(t.position||t.coordinates||[t.x,t.y]),h:t.heightM||t.height||6,r:t.radiusM||t.radius||2.6,base:Number.isFinite(t.baseElevationM)?t.baseElevationM:Array.isArray(t.position)&&Number.isFinite(t.position[2])?t.position[2]:groundBase}));
  const dummy=new THREE.Object3D();
  if(detail==='full'&&treeRecords.length&&typeof document!=='undefined'){
    const leafColors=['#627b43','#7c914f','#93a761','#4f703f','#a4af6b'];
    const leafCanvas=document.createElement('canvas');leafCanvas.width=leafCanvas.height=256;const leafCtx=leafCanvas.getContext('2d');
    for(let j=0;j<160;j++){const a=random()*Math.PI*2,r=Math.sqrt(random())*104,x=128+Math.cos(a)*r,y=128+Math.sin(a)*r;leafCtx.save();leafCtx.translate(x,y);leafCtx.rotate(random()*Math.PI*2);leafCtx.fillStyle=['#869757','#728745','#a3af69','#5d7c43','#94a35d'][j%5];leafCtx.beginPath();leafCtx.ellipse(0,0,10+random()*14,7+random()*7,0,0,Math.PI*2);leafCtx.fill();leafCtx.restore();}
    const leafTexture=new THREE.CanvasTexture(leafCanvas);leafTexture.colorSpace=THREE.SRGBColorSpace;leafTexture.anisotropy=4;textures.push(leafTexture);
    const geo=new THREE.PlaneGeometry(2,2);const trunkGeo=new THREE.CylinderGeometry(.11,.21,1,6);
    const trunks=new THREE.InstancedMesh(trunkGeo,mat('#70664e'),treeRecords.length);trunks.castShadow=true;layerRefs.trees.add(trunks);
    const clusters=48;const count=treeRecords.length*clusters;const leaves=new THREE.InstancedMesh(geo,mat('#ffffff',{roughness:.96,map:leafTexture,alphaTest:.25,side:THREE.DoubleSide}),count);leaves.castShadow=leaves.receiveShadow=true;layerRefs.trees.add(leaves);
    const coreCount=8;const cores=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),mat('#ffffff'),treeRecords.length*coreCount);cores.castShadow=cores.receiveShadow=true;layerRefs.trees.add(cores);
    treeRecords.forEach((t,i)=>{const [x,y]=t.p;dummy.position.set(x,t.base+t.h*.36,-y);dummy.scale.set(1,t.h*.72,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
      for(let j=0;j<coreCount;j++){const a=j*2.399963,v=random()*2-1,r=Math.cbrt(random())*t.r*.79,hr=Math.sqrt(1-v*v)*r;dummy.position.set(x+Math.cos(a)*hr,t.base+t.h*.67+v*r*.88,-y+Math.sin(a)*hr);const scale=t.r*(.18+random()*.07);dummy.scale.set(scale,scale*.85,scale);dummy.rotation.set(random()*3,random()*6,random()*3);dummy.updateMatrix();cores.setMatrixAt(i*coreCount+j,dummy.matrix);cores.setColorAt(i*coreCount+j,new THREE.Color(leafColors[(i+j)%leafColors.length]));}
      for(let j=0;j<clusters;j++){const angle=j*2.399963, v=random()*2-1,rad=Math.cbrt(random())*t.r, horizontal=Math.sqrt(1-v*v)*rad;
        dummy.position.set(x+Math.cos(angle)*horizontal,t.base+t.h*.67+v*rad*.88,-y+Math.sin(angle)*horizontal);
        const leaf=t.r*(.18+random()*.14);dummy.scale.set(leaf,leaf*(.6+random()*.6),leaf);dummy.rotation.set(random()*3,random()*6,random()*3);dummy.updateMatrix();leaves.setMatrixAt(i*clusters+j,dummy.matrix);leaves.setColorAt(i*clusters+j,new THREE.Color().setScalar(.83+random()*.24))}

    });
  }
  // Cars, lamps and park paths establish scale without becoming cadastral records.
  if(detail==='full'){
    const carColors=['#ebe7dc','#b4babe','#776e65','#466575','#bfc7c3'];
    const wheelMat=mat('#2e3030'),glass=mat('#53646b',{roughness:.28,metalness:.2});
    const cars=data.sceneDecoration?.cars||[];
    for(const [i,c] of cars.entries()){const p=c.position||c.coordinates||[c.x,c.y];if(!p||!Number.isFinite(p[0]))continue;const car=new THREE.Group();car.position.set(p[0],Number.isFinite(c.baseElevationM)?c.baseElevationM:Number.isFinite(p[2])?p[2]:groundBase,-p[1]);car.rotation.y=-(c.rotation||c.heading||0)*Math.PI/180;layerRefs.roads.add(car);const body=mesh(new THREE.BoxGeometry(1.72,.65,3.9),mat(carColors[i%5]),car);body.position.y=.65;body.castShadow=true;const cabin=mesh(new THREE.BoxGeometry(1.48,.65,2.08),glass,car);cabin.position.set(0,1.22,-.15);cabin.castShadow=true;const roof=mesh(new THREE.BoxGeometry(1.5,.08,1.75),body.material,car);roof.position.set(0,1.57,-.15);for(const x of [-.88,.88])for(const z of [-1.15,1.15]){const wheel=mesh(new THREE.CylinderGeometry(.31,.31,.14,10),wheelMat,car);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.33,z)}}
    for(const lampRecord of streetLamps){
      const [x,y]=lampRecord.p,base=lampRecord.base;
      const pole=mesh(new THREE.CylinderGeometry(.045,.065,5.2,6),metal,layerRefs.roads);pole.position.set(x,base+2.7,-y);pole.castShadow=true;
      const lamp=mesh(new THREE.BoxGeometry(.7,.12,.24),white,layerRefs.roads);lamp.position.set(x+lampRecord.normal[0]*.24,base+5.3,-y-lampRecord.normal[1]*.24);
      pole.userData=lamp.userData={syntheticDecoration:true,displayRole:'illustrative_street_lamp'};
    }
  }
  if(detail==='full')for(const path of data.sceneDecoration?.parkPaths||[]){for(let i=1;i<path.path.length;i++){const a=path.path[i-1],b=path.path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);const m=rect((a[0]+b[0])/2,(a[1]+b[1])/2,length,path.widthM,(Number.isFinite(path.baseElevationM)?path.baseElevationM:groundBase)+.095,paving,layerRefs.trees);m.rotation.y=Math.atan2(b[1]-a[1],b[0]-a[0]);}}
  for(const object of data.objects.filter(o=>o.type==='utility')){
    const geometry=geometryFor(object);
    if(geometry?.type!=='LineString'||geometry.coordinates.length<2||geometry.coordinates.some(p=>!Number.isFinite(p[2])&&!Number.isFinite(geometry.baseElevationM)))continue;
    const points=geometry.coordinates.map(p=>new THREE.Vector3(p[0],p[2]??geometry.baseElevationM,-p[1]));
    const guideMaterial=new THREE.LineDashedMaterial({color:'#2787c7',dashSize:1.5,gapSize:.7,depthTest:false,transparent:true,opacity:15});materials.push(guideMaterial);
    const guide=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,groundBase+.16,p.z))),guideMaterial);guide.computeLineDistances();guide.renderOrder=8;guide.userData={objectId:object.id,geometryId:geometry.id,displayRole:'surface_projection_of_underground_alignment',syntheticDecoration:true};layerRefs.utilityGuides.add(guide);
    const diameter=object.attributes?.diameterM;
    const radius=Number.isFinite(diameter)&&diameter>0&&diameter<=20?diameter/2:null;
    // Each straight segment retains the exact source alignment. Curved smoothing
    // could displace a pipe through a parcel or building and is not permitted.
    if(radius!==null){
      const pipeMaterial=mat('#3284aa',{depthTest:false,transparent:true,opacity:16});
      for(let i=1;i<points.length;i++){
        const start=points[i-1],end=points[i],length=start.distanceTo(end);if(length<1e-6)continue;
        const pipe=mesh(new THREE.CylinderGeometry(radius,radius,length,12),pipeMaterial,layerRefs.utilities);
        pipe.position.copy(start).add(end).multiplyScalar(.5);
        pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.clone().sub(start).normalize());
        pipe.userData={objectId:object.id,geometryId:geometry.id,displayRole:geometry.displayRole||'source_alignment',diameterM:diameter,syntheticDecoration:false};pipe.renderOrder=8;
      }
    }else{
      const material=new THREE.LineBasicMaterial({color:'#3284aa',depthTest:false,transparent:true,opacity:.9});materials.push(material);
      const alignment=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),material);
      alignment.userData={objectId:object.id,geometryId:geometry.id,displayRole:'alignment_only_unknown_diameter',syntheticDecoration:false};alignment.renderOrder=8;layerRefs.utilities.add(alignment);
    }
  }
  group.traverse(object=>{
    if((object.isMesh||object.isLine)&&object.userData.syntheticDecoration===undefined)object.userData={...object.userData,syntheticDecoration:true,displayRole:'illustrative_environment'};
  });
  const displayBounds=new THREE.Box3();
  Object.values(layerRefs).forEach(layer=>displayBounds.expandByObject(layer));
  if(displayBounds.isEmpty())displayBounds.set(new THREE.Vector3(extent[0],groundBase,-extent[3]),new THREE.Vector3(extent[2],groundBase,-extent[1]));
  layerRefs.utilities.visible=false;
  return {group,layerRefs,bounds:displayBounds,stats:{trees:treeRecords.length,authored:true},setUnderground(enabled){ground.material.transparent=enabled;ground.material.opacity=enabled?.38:1;layerRefs.utilities.visible=enabled},dispose(){const gs=new Set();group.traverse(o=>{if(o.geometry)gs.add(o.geometry)});gs.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}};
}
