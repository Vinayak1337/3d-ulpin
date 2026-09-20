import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name) => {
  const shapes = { layers:'<path d="m3 7 9-5 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',building:'<path d="M5 21V3h14v18M2 21h20M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',target:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',pipe:'<path d="M3 4v6h7v10h6V4H3Zm-2 0h4M1 10h4m5 10v3m6-3v3"/>',chevron:'<path d="m8 4 8 8-8 8"/>',check:'<path d="m5 12 4 4L19 6"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.2"/>',parcel:'<path d="m4 5 15-2 2 15-15 3-2-16Z"/><path d="m8 8 7-1 2 8-8 2-1-9Z"/>',source:'<path d="M6 2h8l5 5v15H6V2Zm8 0v6h5M9 12h7m-7 4h7"/>',floor:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>' };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.building}</svg>`;
};

/** Standalone, synthetic local-metre scene. Original fixture geometry is never mutated. */
export function mountMap(container, data, { onSelect, onRegister, onReview } = {}) {
  const objects = data.objects || [];
  const geometries = new Map((data.geometries || []).map(g => [g.id, g]));
  const objectById = new Map(objects.map(o => [o.id, o]));
  const geometryFor = (o) => geometries.get(o?.geometryId) || (data.geometries || []).find(g => g.objectId === o?.id);
  const buildings = objects.filter(o => o.type === 'building' && geometryFor(o)?.type === 'Polygon');
  const state = { selectedId: buildings.find(o => o.id === 'B01')?.id || buildings[0]?.id || null, inspectorOpen: true, mode: '3d', floor: 'all', space: 'none', floorMode: 'below', explode: false, section: false, sectionHeight: 100, underground: false, layers: { buildings: true, parcels: true, roads: true, trees: true, utilities: true } };
  let disposed = false, frameId, pointerStart, renderer;
  const cleanups = [];
  const listen = (el, event, handler, options) => { el.addEventListener(event, handler, options); cleanups.push(() => el.removeEventListener(event, handler, options)); };
  const selected = () => objectById.get(state.selectedId);
  const relationsFrom = (id, kind) => (data.relations || []).filter(r => r.fromId === id && (!kind || r.kind === kind)).map(r => objectById.get(r.toId)).filter(Boolean);
  const floorsFor = (id) => {
    const contained = relationsFrom(id, 'contains').filter(o => o.type === 'floor');
    return (contained.length ? contained : objects.filter(o => o.type === 'floor' && (o.parentId === id || o.id.startsWith(id + '-F')))).sort((a,b) => (geometryFor(a)?.baseElevationM || 0) - (geometryFor(b)?.baseElevationM || 0));
  };
  const issuesFor = id => (data.issues || []).filter(i => i.objectId === id || i.targetId === id || i.objectIds?.includes(id) || i.affectedObjectIds?.includes(id));
  const parcelFor = id => {
    const relation = (data.relations || []).find(r => r.kind === 'occupies' && r.fromId === id && objectById.get(r.toId)?.type === 'parcel');
    return objectById.get(relation?.toId) || objects.find(o => o.type === 'parcel' && relationsFrom(o.id, 'contains').some(child => child.id === id));
  };

  container.classList.add('bm-root');
  container.innerHTML = `<section class="bm-stage" aria-label="Interactive fictional neighborhood map">
    <div class="bm-canvas" tabindex="0" role="application" aria-label="3D neighborhood. Drag to orbit, right drag to pan, scroll to zoom. Press F to fit or Escape to reset floor tools."></div>
    <div class="bm-top-tools">
      <div class="bm-tool-group"><button class="bm-button" data-action="properties" aria-expanded="false">${icon('search')}<span>Find a property</span></button><button class="bm-button" data-action="layers" aria-expanded="false">${icon('layers')}<span>Layers</span></button></div>
      <div class="bm-segment" aria-label="Map perspective"><button data-mode="3d" aria-pressed="true">3D</button><button data-mode="2d" aria-pressed="false">2D</button></div>
    </div>
    <div class="bm-nav-tools"><button class="bm-button" data-action="fit" title="Fit neighborhood (F)">${icon('fit')}<span>Fit</span></button><button class="bm-button bm-north" data-action="north" title="Face north" aria-label="Face north"><span class="bm-north-arrow">↑</span><span>N</span></button></div>
    <div class="bm-property-pop bm-popover" hidden><div class="bm-pop-heading"><strong>Properties in this block</strong><button class="bm-icon-button" data-action="close-pop" aria-label="Close property search">${icon('close')}</button></div><label class="bm-search">${icon('search')}<input type="search" placeholder="Name, reference or source…" aria-label="Search block properties"/></label><div class="bm-property-list"></div><p class="bm-pop-note">Select a footprint or choose a property here.</p></div>
    <div class="bm-layers-pop bm-popover" hidden><div class="bm-pop-heading"><strong>Map layers</strong><button class="bm-icon-button" data-action="close-pop" aria-label="Close layers">${icon('close')}</button></div>${[['buildings','Buildings'],['parcels','Parcel boundaries'],['roads','Roads'],['trees','Landscape decoration'],['utilities','Utility alignment']].map(([key,label])=>`<label class="bm-layer-option"><span>${label}</span><input type="checkbox" data-layer="${key}" checked/></label>`).join('')}<p class="bm-pop-note">A fictional scene in local metres. Tree crowns and façade detail are visual decoration.</p></div>
    <div class="bm-selected-label" hidden></div>
    <div class="bm-scene-bottom"><button class="bm-button bm-underground" data-action="underground" aria-pressed="false">${icon('pipe')}<span>Underground</span></button><div class="bm-utility-note" hidden>Utility alignment · x-ray view</div><div class="bm-scene-caption"><span class="bm-caption-dot"></span>Fictional demonstration<span class="bm-frame-label">Local metres · DEMO-BM-01</span></div></div>
    <div class="bm-zoom"><button data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button></div>
    <div class="bm-live sr-only" aria-live="polite"></div>
  </section><aside class="bm-inspector" aria-label="Selected property"></aside>`;
  const $ = selector => container.querySelector(selector);
  const stage = $('.bm-stage');
  const canvasHost = $('.bm-canvas');
  const inspector = $('.bm-inspector');
  const live = text => { $('.bm-live').textContent = text; };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e7ebdf');
  scene.fog = new THREE.Fog('#e7ebdf', 420, 930);
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 1800);
  const controlsState = { cameraOffset: new THREE.Vector3(155, 185, 205) };
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch (error) {
    canvasHost.innerHTML = '<div class="bm-render-error"><strong>The interactive scene needs WebGL.</strong><p>Use Find a property to explore the same fictional records.</p></div>';
    live('WebGL is unavailable. Property search and the inspector remain available.');
  }
  let controls;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    canvasHost.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .085;
    controls.maxPolarAngle = Math.PI / 2.12;
    controls.minDistance = 28;
    controls.maxDistance = 650;
    controls.screenSpacePanning = true;
  }
  scene.add(new THREE.HemisphereLight('#fffef4', '#78847a', 1.65));
  const sun = new THREE.DirectionalLight('#fff9e6', 2.4);
  sun.position.set(-120, 190, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 1, far: 550 });
  sun.shadow.normalBias = .22;
  sun.shadow.bias = -.0005;
  scene.add(sun);
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness:.88, metalness:0, ...extra});
  const buildingGroup = new THREE.Group(), parcelGroup = new THREE.Group(), roadGroup = new THREE.Group(), treeGroup = new THREE.Group(), utilityGroup = new THREE.Group();
  scene.add(buildingGroup, parcelGroup, roadGroup, treeGroup, utilityGroup);
  const spaceHighlight = new THREE.Group(); scene.add(spaceHighlight);
  const buildingEntries = new Map(), pickables = [], clippingPlane = new THREE.Plane(new THREE.Vector3(0,-1,0), 100);
  const groundMaterial = material('#c8d0b9');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800,1800), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.4;
  ground.receiveShadow = true;
  scene.add(ground);

  function shapeFrom(coordinates) {
    if (!coordinates?.[0]?.length) return null;
    const shape = new THREE.Shape(coordinates[0].map(p => new THREE.Vector2(p[0],p[1])));
    coordinates.slice(1).forEach(ring => shape.holes.push(new THREE.Path(ring.map(p => new THREE.Vector2(p[0],p[1])))));
    return shape;
  }
  function flatPolygon(geo, mat, elevation=.01) {
    const shape = shapeFrom(geo?.coordinates);
    if (!shape) return null;
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape),mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = elevation;
    mesh.receiveShadow = true;
    return mesh;
  }
  function ringLine(ring,y,color,opacity=1) {
    const points = ring.map(p => new THREE.Vector3(p[0],y,-p[1]));
    if (points.length && !points[0].equals(points[points.length-1])) points.push(points[0].clone());
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity}));
  }
  const extent = new THREE.Box3();
  buildings.forEach(o => geometryFor(o).coordinates.flat().forEach(p=>extent.expandByPoint(new THREE.Vector3(p[0],0,-p[1]))));
  if (extent.isEmpty()) extent.set(new THREE.Vector3(0,0,-190), new THREE.Vector3(240,0,0));
  const center = extent.getCenter(new THREE.Vector3()), size = extent.getSize(new THREE.Vector3()), span = Math.max(size.x,size.z,80);
  sun.target.position.copy(center); scene.add(sun.target);
  sun.position.add(center);
  const plotMat = material('#becbb0');
  const plotAlt = material('#c8d1b8');
  objects.filter(o=>o.type === 'parcel').forEach((o,i)=>{
    const geo=geometryFor(o); if(geo?.type!=='Polygon')return;
    const mesh=flatPolygon(geo,i%3?plotMat:plotAlt,0); if(mesh)parcelGroup.add(mesh);
    geo.coordinates.forEach(ring=>parcelGroup.add(ringLine(ring,.09,'#f8faf2')));
  });
  const roadMat = material('#687871'), curbMat = material('#cbd2c1');
  function lineRibbon(points, width, y, mat) {
    if(points.length<2)return;
    for(let i=1;i<points.length;i++){
      const a=new THREE.Vector3(points[i-1][0],y,-points[i-1][1]),b=new THREE.Vector3(points[i][0],y,-points[i][1]);
      const length=a.distanceTo(b);if(!length)continue;
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,length),mat);
      mesh.rotation.set(-Math.PI/2,0,Math.atan2(b.x-a.x,-(b.z-a.z)));
      mesh.position.copy(a.clone().add(b).multiplyScalar(.5)); mesh.receiveShadow=true; roadGroup.add(mesh);
    }
  }
  objects.filter(o=>o.type==='road').forEach(o=>{
    const geo=geometryFor(o); if(!geo)return;
    const width=o.attributes?.widthM || geo.widthM || 9;
    if(geo.type==='LineString'){
      lineRibbon(geo.coordinates,width+2.4,.12,curbMat);
      lineRibbon(geo.coordinates,width,.24,roadMat);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(geo.coordinates.map(p=>new THREE.Vector3(p[0],.27,-p[1])));
      const line = new THREE.Line(lineGeo,new THREE.LineDashedMaterial({color:'#dde0cf',dashSize:2,gapSize:2.7,linewidth:1}));line.computeLineDistances();roadGroup.add(line);
      const midpoint=geo.coordinates.reduce((sum,p)=>[sum[0]+p[0]/geo.coordinates.length,sum[1]+p[1]/geo.coordinates.length],[0,0]);
      addWorldLabel(o.label || 'Road',midpoint, .31,'road');
    } else if(geo.type==='Polygon'){const mesh=flatPolygon(geo,roadMat,.04);if(mesh)roadGroup.add(mesh);}
  });
  function addWorldLabel(text, coordinate, elevation, kind) {
    // Canvas-rendered road names are presentation labels, never measurements.
    const cv=document.createElement('canvas');cv.width=1024;cv.height=128;
    const ctx=cv.getContext('2d');ctx.font='600 58px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=kind==='road'?'#edf0e7':'#4e634f';ctx.fillText(text,512,64);
    const texture=new THREE.CanvasTexture(cv);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(38,4.75),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set(coordinate[0],elevation,-coordinate[1]);roadGroup.add(mesh);
  }
  function addBuilding(o) {
    const geo=geometryFor(o),outer=geo.coordinates[0];
    const group=new THREE.Group();group.userData.objectId=o.id;buildingGroup.add(group);
    const floors=floorsFor(o.id),height=Number.isFinite(geo.heightM)&&geo.heightM>0?geo.heightM:null,base=geo.baseElevationM||0;
    const entry={object:o,geo,group,floors,segments:[],materials:[],outline:[],height};buildingEntries.set(o.id,entry);
    const shape=shapeFrom(geo.coordinates);if(!shape)return;
    if(height===null){
      const footprint=flatPolygon(geo,material('#aca58b',{transparent:true,opacity:.66}),base+.1);footprint.userData.objectId=o.id;group.add(footprint);pickables.push(footprint);entry.materials.push({mat:footprint.material,role:'footprint'});
      geo.coordinates.forEach(ring=>group.add(ringLine(ring,base+.13,'#8d815c')));return;
    }
    // Only supplied floor records or supplied building height determine vertical geometry.
    const segments=floors.length?floors.map((floor,i)=>({floor,id:floor.id,base:geometryFor(floor)?.baseElevationM??base,height:geometryFor(floor)?.heightM,index:i,geometry:geometryFor(floor)})):[{id:o.id,base,height,index:0,geometry:geo}];
    segments.forEach(segment=>{
      if(!Number.isFinite(segment.height)||segment.height<=0)return;
      const part=new THREE.Group();part.position.y=segment.base;group.add(part);
      const partShape=shapeFrom(segment.geometry?.coordinates || geo.coordinates);
      const extrusion=new THREE.ExtrudeGeometry(partShape,{depth:Math.max(segment.height-.08,.1),bevelEnabled:false,steps:1});extrusion.rotateX(-Math.PI/2);
      const wallMat=material('#c9c7b7'),roofMat=material('#e4e2d4');
      wallMat.clippingPlanes=[clippingPlane];roofMat.clippingPlanes=[clippingPlane];
      const mesh=new THREE.Mesh(extrusion,[roofMat,wallMat]);mesh.position.y=.06;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.objectId=o.id;part.add(mesh);pickables.push(mesh);
      entry.materials.push({mat:wallMat,role:'wall'},{mat:roofMat,role:'roof'});
      const band=flatPolygon(segment.geometry||geo,material('#e5e4d7'),segment.height-.01);if(band){band.material.clippingPlanes=[clippingPlane];part.add(band);entry.materials.push({mat:band.material,role:'band'});}
      // Window panels are deliberately schematic exterior decoration, not source-derived openings.
      const decorativeRows=segment.floor?1:Math.max(1,Number(o.attributes?.floorCount)||1);
      const windowMat=material('#71858a',{roughness:.45});windowMat.clippingPlanes=[clippingPlane];entry.materials.push({mat:windowMat,role:'window'});
      const rings=segment.geometry?.coordinates || geo.coordinates;
      rings.forEach(ring=>{for(let i=1;i<ring.length;i++){
        const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=-(b[1]-a[1]),length=Math.hypot(dx,dz),count=Math.floor((length-1)/3.2);
        if(count<1||segment.height<2)return;
        for(let row=0;row<decorativeRows;row++)for(let w=0;w<count;w++){
          const t=(w+1)/(count+1),panel=new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.25,length/(count+1)*.45),Math.min(1.35,segment.height/decorativeRows*.44),.12),windowMat);
          panel.position.set(a[0]+dx*t,segment.height/decorativeRows*(row+.54),-a[1]+dz*t);panel.rotation.y=-Math.atan2(dz,dx);part.add(panel);
        }
      }});
      entry.segments.push({...segment,group:part});
    });
    geo.coordinates.forEach(ring=>{const line=ringLine(ring,base+height+.08,'#205e48');line.visible=false;group.add(line);entry.outline.push(line);});
    const bounds=new THREE.Box3().setFromObject(group);entry.anchor=bounds.getCenter(new THREE.Vector3());entry.anchor.y=base+height+2;
  }
  buildings.forEach(addBuilding);
  // Optional decoration supplied by the synthetic fixture, separate from canonical geometry.
  const trees=data.sceneDecoration?.trees || [];
  const trunkMat=material('#7c765a'),leafMats=['#668454','#7f9864','#526e49'].map(c=>material(c));
  trees.forEach((tree,i)=>{
    const point=Array.isArray(tree)?tree:(tree.position || tree.coordinates || [tree.x,tree.y]);if(!Number.isFinite(point[0])||!Number.isFinite(point[1]))return;
    const height=tree.heightM || tree.height || 5.4,radius=tree.radiusM || tree.radius || 2.5;
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.25,.38,height*.65,5),trunkMat);trunk.position.set(point[0],height*.33,-point[1]);trunk.castShadow=true;treeGroup.add(trunk);
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(radius,1),leafMats[i%3]);crown.position.set(point[0],height*.75,-point[1]);crown.scale.set(1,1.15,1);crown.castShadow=true;crown.receiveShadow=true;treeGroup.add(crown);
  });
  objects.filter(o=>['utility','utility_segment','pipeline'].includes(o.type)).forEach(o=>{
    const geo=geometryFor(o);if(geo?.type!=='LineString')return;
    const points=geo.coordinates.map(p=>new THREE.Vector3(p[0],Number.isFinite(p[2])?p[2]:geo.baseElevationM||-2,-p[1]));
    if(points.length<2)return;
    const curve=new THREE.CatmullRomCurve3(points,false,'catmullrom',0);
    const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(20,points.length*8),.55,8,false),material('#3a92b4',{emissive:'#164657',emissiveIntensity:.2}));tube.material.transparent=true;tube.material.depthTest=false;tube.material.depthWrite=false;tube.renderOrder=20;utilityGroup.add(tube);
    points.forEach(p=>{const marker=new THREE.Mesh(new THREE.SphereGeometry(.85,12,8),material('#69bad4'));marker.position.copy(p);marker.material.transparent=true;marker.material.depthTest=false;marker.material.depthWrite=false;marker.renderOrder=21;utilityGroup.add(marker);});
  });
  utilityGroup.visible=false;

  function fit() {
    const aspect=camera.aspect || 1;
    const distance=span*1.46*Math.max(1,1.28/aspect);
    camera.position.copy(center).add(state.mode==='2d'?new THREE.Vector3(0,distance,.01):new THREE.Vector3(distance*.57,distance*.76,distance*.68));
    if(controls){controls.target.copy(center);controls.update();}else camera.lookAt(center);
  }
  function setMode(mode) {
    if(!['2d','3d'].includes(mode)||mode===state.mode)return;
    state.mode=mode;
    container.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
    if(controls){
      const distance=camera.position.distanceTo(controls.target);
      if(mode==='2d'){controlsState.cameraOffset.copy(camera.position).sub(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(0,distance,.001));controls.enableRotate=false;controls.mouseButtons.LEFT=THREE.MOUSE.PAN;controls.touches.ONE=THREE.TOUCH.PAN;}
      else {camera.position.copy(controls.target).add(controlsState.cameraOffset.clone().normalize().multiplyScalar(distance));controls.enableRotate=true;controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;controls.touches.ONE=THREE.TOUCH.ROTATE;}
      controls.update();
    }
    live(mode==='2d'?'Plan view. Drag to pan.':'3D view. Drag to orbit.');
  }
  function updateScene() {
    spaceHighlight.children.slice().forEach(child=>{child.geometry?.dispose();child.material?.dispose();spaceHighlight.remove(child);});
    if(state.floor!=='all'){
      const entry=buildingEntries.get(state.selectedId),index=entry?.floors.findIndex(f=>f.id===state.floor)||0;
      relationsFrom(state.floor,'contains').filter(o=>['space','unit'].includes(o.type)).forEach(space=>{
        const spaceGeo=geometryFor(space);if(spaceGeo?.type!=='Polygon')return;
        const floorGeo=geometryFor(objectById.get(state.floor));
        const elevation=(floorGeo?.baseElevationM||0)+(floorGeo?.heightM||0)+.18+(state.explode?index*3:0);
        const active=space.id===state.space;
        const spaceMesh=flatPolygon(spaceGeo,material(active?'#438567':'#a9c49c',{transparent:true,opacity:active?.94:.75,side:THREE.DoubleSide}),elevation);
        if(spaceMesh)spaceHighlight.add(spaceMesh);
        spaceGeo.coordinates.forEach(ring=>spaceHighlight.add(ringLine(ring,elevation+.05,active?'#23543d':'#567c48')));
      });
    }
    buildingGroup.visible=state.layers.buildings;parcelGroup.visible=state.layers.parcels;roadGroup.visible=state.layers.roads;treeGroup.visible=state.layers.trees&&!state.underground;
    utilityGroup.visible=state.underground&&state.layers.utilities;
    groundMaterial.transparent=state.underground;groundMaterial.opacity=state.underground?.22:1;groundMaterial.depthWrite=!state.underground;
    parcelGroup.children.forEach(child=>{if(child.isMesh){child.material.transparent=state.underground;child.material.opacity=state.underground?.16:1;child.material.depthWrite=!state.underground;}});
    roadGroup.children.forEach(child=>{if(child.isMesh&&!child.material.map){child.material.transparent=state.underground;child.material.opacity=state.underground?.32:1;child.material.depthWrite=!state.underground;}});
    clippingPlane.constant=state.section?state.sectionHeight:10000;
    buildingEntries.forEach(entry=>{
      const active=entry.object.id===state.selectedId;
      entry.materials.forEach(({mat,role})=>{
        const colors=active?{wall:'#79a58a',roof:'#bdd1b6',band:'#d6e4c9',window:'#315e51',footprint:'#85a78d'}:{wall:'#c9c7b7',roof:'#e4e2d4',band:'#e7e5d8',window:'#71858a',footprint:'#aca58b'};
        mat.color.set(colors[role]);mat.transparent=state.underground||role==='footprint';mat.opacity=state.underground?.46:role==='footprint'?.66:1;
      });
      const selectedFloorIndex=entry.floors.findIndex(f=>f.id===state.floor);
      entry.segments.forEach(segment=>{
        segment.group.visible=!active||state.floor==='all'||(state.floorMode==='isolate'?segment.index===selectedFloorIndex:segment.index<=selectedFloorIndex);
        segment.group.position.y=segment.base+(active&&state.explode?segment.index*3:0);
      });
      entry.outline.forEach(line=>{line.visible=active&&state.floor==='all'&&!state.section&&!state.explode;});
    });
    $('.bm-underground').setAttribute('aria-pressed',String(state.underground));
    $('.bm-utility-note').hidden=!state.underground;
    spaceHighlight.visible=state.layers.buildings;
  }
  function renderList(query='') {
    const q=query.toLowerCase();const matches=buildings.filter(o=>`${o.label} ${o.id} ${o.systemId} ${o.attributes?.address||''}`.toLowerCase().includes(q));
    $('.bm-property-list').innerHTML=matches.length?matches.map(o=>`<button class="bm-property-row" data-select="${esc(o.id)}" aria-pressed="${o.id===state.selectedId}">${icon('building')}<span><strong>${esc(o.label)}</strong><small>${esc(o.id)} · ${geometryFor(o).heightM===null?'Height unresolved':esc(o.attributes?.use || 'Building')}</small></span>${o.id===state.selectedId?icon('check'):icon('chevron')}</button>`).join(''):'<p class="bm-empty">No matching property. Try a name or B01–B12.</p>';
  }
  function renderInspector() {
    const o=selected();if(!o){inspector.innerHTML='<p class="bm-empty">Select a building to inspect its record.</p>';return;}
    const geo=geometryFor(o),floors=floorsFor(o.id),parcel=parcelFor(o.id),issues=issuesFor(o.id),hasHeight=Number.isFinite(geo?.heightM);
    const count=issues.length || (o.status==='needs_review'||o.status==='needs-review'?1:0);
    const floor=objectById.get(state.floor),spaces=floor?relationsFrom(floor.id,'contains').filter(child=>['space','unit'].includes(child.type)):[];
    const sourceRefs=o.sourceRecordIds || o.sourceIds || [];
    const sourceText=sourceRefs.length?sourceRefs.join(', '):'Generated demonstration fixture';
    const address=o.attributes?.address || o.address || 'Lake View demonstration block';
    inspector.innerHTML=`<div class="bm-inspector-heading"><div class="bm-eyebrow">${icon('building')}Selected building <span>${esc(o.id)}</span><button class="bm-icon-button bm-close-inspector" data-action="close-inspector" aria-label="Close inspector" title="Close inspector">${icon('close')}</button></div><h2>${esc(o.label)}</h2><p>${esc(address)}</p><div class="bm-status"><span></span>${o.status==='recorded'?'Recorded in prototype':'Draft'} · ${hasHeight?'illustrative geometry':'Footprint only · height unresolved'}</div></div>
      <div class="bm-inspector-scroll">
      <button class="bm-parcel-link" data-action="parcel"><span>${icon('parcel')}Linked parcel</span><strong>${esc(parcel?.id || 'Not linked')}</strong>${icon('chevron')}</button>
      <div class="bm-parcel-details" hidden>${parcel?`<strong>${esc(parcel.label || parcel.id)}</strong><p>Parcel assertion: ${esc(parcel.systemId || parcel.id)}.</p><p>Separate from the building’s proposed 3D ID. This fixture does not issue official identifiers.</p>`:'No parcel link is supplied for this building.'}</div>
      ${count?`<button class="bm-review-link ${issues.some(issue=>issue.severity==='blocking')?'bm-blocking':''}" data-action="review"><span class="bm-review-sign">!</span><span><strong>${count} ${count===1?'check needs':'checks need'} review</strong><small>Inspect source and geometry checks</small></span>${icon('chevron')}</button>`:''}
      <section class="bm-model-controls"><div class="bm-section-heading"><h3>Explore the building</h3><button class="bm-text-button" data-action="focus">${icon('target')}Focus</button></div>
      <label class="bm-field-label" for="bm-floor">Floor</label><select id="bm-floor" class="bm-select" ${!floors.length?'disabled':''}><option value="all">${floors.length?`All ${floors.length} floors`:'No floor geometry supplied'}</option>${floors.map((f,i)=>`<option value="${esc(f.id)}" ${state.floor===f.id?'selected':''}>${esc(f.label || (i===0?'Ground floor':`Floor ${i}`))}</option>`).join('')}</select>
      <div class="bm-floor-options" ${state.floor==='all'?'hidden':''}><div class="bm-segment"><button data-floor-mode="below" aria-pressed="${state.floorMode==='below'}">Hide above</button><button data-floor-mode="isolate" aria-pressed="${state.floorMode==='isolate'}">Isolate floor</button></div><p>Proposed floor ID: ${esc(floor?.systemId || '')}</p>${spaces.length?`<label class="bm-field-label" for="bm-space">Space on this floor</label><select id="bm-space" class="bm-select"><option value="none">Choose a space (${spaces.length})</option>${spaces.map(space=>`<option value="${esc(space.id)}" ${state.space===space.id?'selected':''}>${esc(space.label)}</option>`).join('')}</select>${state.space!=='none'?`<p>Proposed space ID: ${esc(objectById.get(state.space)?.systemId || state.space)}</p>`:''}`:''}</div>
      <label class="bm-switch-row"><span>${icon('floor')}Separate floors</span><input type="checkbox" class="bm-switch" data-control="explode" ${state.explode?'checked':''} ${floors.length<2?'disabled':''}/></label>
      <label class="bm-switch-row"><span>${icon('layers')}Section cut</span><input type="checkbox" class="bm-switch" data-control="section" ${state.section?'checked':''} ${!hasHeight?'disabled':''}/></label>
      <div class="bm-section-slider" ${!state.section?'hidden':''}><label for="bm-cut">Cut elevation <output>${state.sectionHeight.toFixed(1)} m</output></label><input id="bm-cut" type="range" min="0" max="${Math.max(geo?.heightM || 1,1)}" step="0.1" value="${state.sectionHeight}"/><p>Local demonstration benchmark. Applies to the scene.</p></div>
      ${!hasHeight?'<p class="bm-uncertainty">Height is not supplied. Only the known footprint is shown.</p>':''}
      </section>
      <details class="bm-detail"><summary>Identity & source ${icon('chevron')}</summary><dl><dt>Proposed building ID</dt><dd>${esc(o.systemId || o.id)}</dd>${floor?`<dt>Selected floor ID</dt><dd>${esc(floor.systemId || floor.id)}</dd>`:''}<dt>Geometry revision</dt><dd>${esc(geo?.id || 'Unavailable')}</dd><dt>Source records</dt><dd>${esc(sourceText)}</dd><dt>Coordinate frame</dt><dd>${esc(geo?.frameId || 'FRAME-DEMO')} · local metres</dd></dl><p class="bm-detail-note">Synthetic geometry for this prototype. Shading, windows and trees are illustration. No survey or official identity is asserted.</p></details>
      <details class="bm-detail"><summary>Map controls ${icon('chevron')}</summary><p>Drag to orbit · right drag to pan · scroll to zoom. In 2D, drag to pan.</p><p><kbd>F</kbd> Fit block <kbd>Esc</kbd> Reset floor tools</p></details>
      </div><div class="bm-inspector-footer"><button class="bm-primary" data-action="register">Open property register ${icon('arrow')}</button><button class="bm-secondary-action" data-action="review">Review source & geometry</button></div>`;
  }
  function setInspectorOpen(open) {
    state.inspectorOpen=Boolean(open);inspector.hidden=!state.inspectorOpen;container.classList.toggle('bm-inspector-closed',!state.inspectorOpen);
  }
  function select(id, notify=true, focus=notify) {
    if(!buildingEntries.has(id))return;
    setInspectorOpen(true);
    state.selectedId=id;state.floor='all';state.space='none';state.explode=false;state.section=false;state.sectionHeight=Math.max((geometryFor(selected())?.heightM || 10)*.6,.1);
    renderInspector();renderList($('.bm-search input').value);updateScene();
    live(`${selected().label} selected. ${geometryFor(selected())?.heightM===null?'Height unresolved; showing footprint only.':''}`);
    if(focus)focusSelected();
    if(notify)onSelect?.(id,selected());
  }
  function closePopovers() {
    $('.bm-property-pop').hidden=true;$('.bm-layers-pop').hidden=true;container.querySelectorAll('[data-action="properties"],[data-action="layers"]').forEach(button=>button.setAttribute('aria-expanded','false'));
  }
  function focusSelected() {
    const entry=buildingEntries.get(state.selectedId);if(!entry||!controls)return;
    const box=new THREE.Box3().setFromObject(entry.group),target=box.getCenter(new THREE.Vector3());
    const width=box.getSize(new THREE.Vector3()).length(),offset=camera.position.clone().sub(controls.target).normalize().multiplyScalar(Math.max(width*2,58));
    controls.target.copy(target);camera.position.copy(target).add(offset);controls.update();
  }
  listen(container,'click',event=>{
    const element=event.target.closest('button');if(!element)return;
    if(element.dataset.select){select(element.dataset.select);closePopovers();canvasHost.focus();return;}
    if(element.dataset.mode){setMode(element.dataset.mode);return;}
    if(element.dataset.floorMode){state.floorMode=element.dataset.floorMode;renderInspector();updateScene();return;}
    const action=element.dataset.action;
    if(action==='close-inspector'){setInspectorOpen(false);canvasHost.focus();live('Inspector closed. Select a building to reopen it.');}
    else if(action==='properties'||action==='layers'){
      if(action==='properties')setInspectorOpen(true);
      const pop=action==='properties'?$('.bm-property-pop'):$('.bm-layers-pop'),wasHidden=pop.hidden;closePopovers();pop.hidden=!wasHidden;element.setAttribute('aria-expanded',String(wasHidden));if(wasHidden&&action==='properties')$('.bm-search input').focus();
    }else if(action==='close-pop'){closePopovers();}
    else if(action==='fit'){fit();live('Neighborhood fitted to the view.');}
    else if(action==='north'&&controls){const offset=camera.position.clone().sub(controls.target),distance=offset.length();camera.position.copy(controls.target).add(new THREE.Vector3(0,state.mode==='2d'?distance:distance*.78,state.mode==='2d'?.001:distance*.63));controls.update();}
    else if(action==='zoom-in'||action==='zoom-out'){if(controls){const offset=camera.position.clone().sub(controls.target).multiplyScalar(action==='zoom-in'?.78:1.28);offset.setLength(Math.max(controls.minDistance,Math.min(controls.maxDistance,offset.length())));camera.position.copy(controls.target).add(offset);controls.update();}}
    else if(action==='focus'){focusSelected();}
    else if(action==='underground'){state.underground=!state.underground;updateScene();live(state.underground?'Underground utility alignment revealed. Ground surfaces are transparent.':'Ground view restored.');}
    else if(action==='parcel'){const details=$('.bm-parcel-details');details.hidden=!details.hidden;const parcel=parcelFor(state.selectedId);if(parcel){const geo=geometryFor(parcel);if(geo)live(`Linked parcel ${parcel.id}. ${geo.areaM2 ? `${geo.areaM2} square metres in synthetic fixture.`:''}`);}}
    else if(action==='register'){onRegister?.(state.selectedId,selected());}
    else if(action==='review'){onReview?.(state.selectedId,selected());}
  });
  listen(container,'input',event=>{
    const element=event.target;
    if(element.matches('.bm-search input'))renderList(element.value);
    if(element.id==='bm-cut'){state.sectionHeight=Number(element.value);$('.bm-section-slider output').textContent=`${state.sectionHeight.toFixed(1)} m`;updateScene();}
  });
  listen(container,'change',event=>{
    const element=event.target;
    if(element.dataset.layer){state.layers[element.dataset.layer]=element.checked;updateScene();}
    if(element.dataset.control){state[element.dataset.control]=element.checked;renderInspector();updateScene();}
    if(element.id==='bm-space'){state.space=element.value;renderInspector();updateScene();live(state.space==='none'?'Space selection cleared.':`${objectById.get(state.space)?.label} selected.`);}
    if(element.id==='bm-floor'){state.floor=element.value;state.space='none';renderInspector();updateScene();live(element.value==='all'?'Showing all floors.':`Showing ${objectById.get(element.value)?.label || element.value}.`);}
  });
  listen(container,'keydown',event=>{
    if(event.key==='Escape'){closePopovers();state.floor='all';state.space='none';state.explode=false;state.section=false;renderInspector();updateScene();canvasHost.focus();live('Floor tools reset.');}
    if(event.key.toLowerCase()==='f'&&!event.target.matches('input,select,textarea')){event.preventDefault();fit();}
  });
  if(renderer){
    listen(renderer.domElement,'pointerdown',event=>{pointerStart={x:event.clientX,y:event.clientY};});
    listen(renderer.domElement,'pointerup',event=>{
      if(!pointerStart||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5||event.button!==0)return;
      const rect=renderer.domElement.getBoundingClientRect(),pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
      const hit=ray.intersectObjects(pickables,false).find(hit=>{let visible=true;for(let parent=hit.object;parent;parent=parent.parent)visible=visible&&parent.visible;return visible&&(!state.section||hit.point.y<=state.sectionHeight);});
      if(hit)select(hit.object.userData.objectId,true,false);else closePopovers();
    });
  }
  function resize() {
    const rect=stage.getBoundingClientRect();camera.aspect=Math.max(rect.width,1)/Math.max(rect.height,1);camera.updateProjectionMatrix();renderer?.setSize(rect.width,rect.height,false);
  }
  const observer=new ResizeObserver(resize);observer.observe(stage);cleanups.push(()=>observer.disconnect());
  resize();fit();select(state.selectedId,false);
  function animate(){
    if(disposed)return;
    controls?.update();
    const entry=buildingEntries.get(state.selectedId),label=$('.bm-selected-label');
    if(entry&&state.layers.buildings&&renderer){
      const anchor=entry.anchor?.clone() || new THREE.Box3().setFromObject(entry.group).getCenter(new THREE.Vector3());
      const activeSegment=entry.segments.find(segment=>segment.id===state.floor);
      if(activeSegment)anchor.y=activeSegment.base+activeSegment.height+2+(state.explode?activeSegment.index*3:0);
      else if(state.explode)anchor.y+=Math.max(entry.floors.length-1,0)*3;
      if(state.section)anchor.y=Math.min(anchor.y,state.sectionHeight+2);
      anchor.project(camera);const width=stage.clientWidth,height=stage.clientHeight;
      label.hidden=anchor.z>1||anchor.x<-1||anchor.x>1||anchor.y<-1||anchor.y>1;
      label.style.transform=`translate(-50%,-100%) translate(${(anchor.x*.5+.5)*width}px,${(-anchor.y*.5+.5)*height-12}px)`;
      const text=`${entry.object.label}${entry.height===null?' · footprint':''}`;if(label.textContent!==text)label.textContent=text;
    }else label.hidden=true;
    renderer?.render(scene,camera);frameId=requestAnimationFrame(animate);
  }
  animate();
  function getState() {
    return {...state,layers:{...state.layers},camera:{position:camera.position.toArray(),target:(controls?.target || center).toArray()}};
  }
  function restoreState(saved) {
    if(!saved||typeof saved!=='object')return;
    if(buildingEntries.has(saved.selectedId))select(saved.selectedId,false);
    const allowedFloors=floorsFor(state.selectedId).map(f=>f.id);
    state.floor=allowedFloors.includes(saved.floor)?saved.floor:'all';
    state.space=relationsFrom(state.floor,'contains').some(o=>o.id===saved.space)?saved.space:'none';
    state.floorMode=saved.floorMode==='isolate'?'isolate':'below';
    for(const key of ['explode','section','underground'])if(typeof saved[key]==='boolean')state[key]=saved[key];
    const hasHeight=Number.isFinite(geometryFor(selected())?.heightM);
    if(!hasHeight)state.section=false;
    if(!allowedFloors.length)state.explode=false;
    if(Number.isFinite(saved.sectionHeight))state.sectionHeight=Math.max(0,saved.sectionHeight);
    Object.keys(state.layers).forEach(key=>{if(typeof saved.layers?.[key]==='boolean')state.layers[key]=saved.layers[key];const input=container.querySelector(`[data-layer="${key}"]`);if(input)input.checked=state.layers[key];});
    setMode(saved.mode==='2d'?'2d':'3d');
    const validVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
    if(validVector(saved.camera?.position)&&validVector(saved.camera?.target)){
      camera.position.fromArray(saved.camera.position);if(controls){controls.target.fromArray(saved.camera.target);controls.update();}else camera.lookAt(new THREE.Vector3().fromArray(saved.camera.target));
    }
    setInspectorOpen(saved.inspectorOpen!==false);renderInspector();updateScene();
  }
  return { select, setMode, getState, restoreState, dispose(){disposed=true;cancelAnimationFrame(frameId);cleanups.forEach(fn=>fn());controls?.dispose();const materials=new Set(),textures=new Set();scene.traverse(obj=>{obj.geometry?.dispose();(Array.isArray(obj.material)?obj.material:obj.material?[obj.material]:[]).forEach(mat=>{materials.add(mat);if(mat.map)textures.add(mat.map);});});materials.forEach(mat=>mat.dispose());textures.forEach(texture=>texture.dispose());sun.shadow.dispose?.();renderer?.dispose();container.innerHTML='';container.classList.remove('bm-root','bm-inspector-closed');} };
}
