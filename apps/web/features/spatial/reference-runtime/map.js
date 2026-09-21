import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment } from './environment.js';
import { buildArchitecture } from './architecture.js';
import { createSurveyLayers } from './survey-layers';
import { createSceneRecords } from './records.js';

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Presentation-only suffix cleanup; full names and classification remain in Sources.
const displayName=value=>String(value??'').replace(/\s*·\s*(fictional|demo|synthetic)\b.*$/i,'').replaceAll('_',' ');
const icon = (name) => {
  const shapes = { layers:'<path d="m3 7 9-5 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',building:'<path d="M5 21V3h14v18M2 21h20M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',target:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',pipe:'<path d="M3 4v6h7v10h6V4H3Zm-2 0h4M1 10h4m5 10v3m6-3v3"/>',chevron:'<path d="m8 4 8 8-8 8"/>',check:'<path d="m5 12 4 4L19 6"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.2"/>',parcel:'<path d="m4 5 15-2 2 15-15 3-2-16Z"/><path d="m8 8 7-1 2 8-8 2-1-9Z"/>',source:'<path d="M6 2h8l5 5v15H6V2Zm8 0v6h5M9 12h7m-7 4h7"/>',floor:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>' };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.building}</svg>`;
};

/** Exact source floor/space boundaries, with explicitly non-metric diagram edges. */
export function buildReferenceFloorPlate(floorGeometry, units = [], identity = {}) {
  const group = new THREE.Group();
  const polygons = geo => geo?.type === 'Polygon' ? [geo.coordinates] : geo?.type === 'MultiPolygon' ? geo.coordinates : [];
  const valid = geo => polygons(geo).length && polygons(geo).every(poly => poly.length && poly.every(ring => ring.length >= 4 && ring.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))));
  const metadata = { ...identity, geometryId: floorGeometry?.id, displayOnly: true, role: 'source_floor_plate' };
  group.userData = metadata;
  // A schedule-only floor or unknown placement cannot produce a floor plate.
  if (!valid(floorGeometry) || !Number.isFinite(floorGeometry.baseElevationM)) return { group, pickables: [], unitCount: 0, unavailableUnitCount: units.length, available: false };
  const pickables = [];
  function surface(geo, color, y, record) {
    polygons(geo).forEach(rings => {
      const shape = new THREE.Shape(rings[0].map(p => new THREE.Vector2(p[0], p[1])));
      rings.slice(1).forEach(ring => shape.holes.push(new THREE.Path(ring.map(p => new THREE.Vector2(p[0], p[1])))));
      const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .95, side: THREE.DoubleSide }));
      mesh.position.y = y; mesh.userData = { ...metadata, ...record }; mesh.receiveShadow = true;
      group.add(mesh); pickables.push(mesh);
      if (!record.unitId) {
        const slab = new THREE.ExtrudeGeometry(shape, { depth: .18, bevelEnabled: false });
        slab.rotateX(-Math.PI / 2);
        const base = new THREE.Mesh(slab, new THREE.MeshStandardMaterial({ color: '#d5d8d2', roughness: .95 }));
        base.position.y = -.185; base.userData = { ...metadata, role: 'diagram_slab_not_measured_structure' };
        base.receiveShadow = true; group.add(base);
      }
    });
  }
  function edges(geo, color, y, record) {
    polygons(geo).forEach(rings => rings.forEach(ring => {
      const positions = [], points = [];
      const wallHeight = 1.05, halfWidth = .09;
      const tri = (a,b,c) => positions.push(...a,...b,...c);
      const quad = (a,b,c,d) => { tri(a,b,c); tri(a,c,d); };
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1], length = Math.hypot(b[0]-a[0], b[1]-a[1]);
        if (!length) continue;
        // Display-only low walls centred on the supplied boundaries, not surveyed wall solids.
        const dx = -(b[1]-a[1])/length*halfWidth, dz = -(b[0]-a[0])/length*halfWidth;
        const lo = [[a[0]+dx,y,-a[1]+dz],[b[0]+dx,y,-b[1]+dz],[b[0]-dx,y,-b[1]-dz],[a[0]-dx,y,-a[1]-dz]];
        const hi = lo.map(p => [p[0],y+wallHeight,p[2]]);
        quad(...hi); for (let k=0;k<4;k++) quad(lo[k],lo[(k+1)%4],hi[(k+1)%4],hi[k]);
      }
      ring.forEach(p => points.push(new THREE.Vector3(p[0], y + wallHeight, -p[1])));
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
      mesh.userData = { ...metadata, ...record, role: 'diagram_boundary_not_measured_wall' }; group.add(mesh);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#8d9285' }));
      line.userData = mesh.userData; group.add(line);
    }));
  }
  surface(floorGeometry, '#eeeae0', 0, {}); edges(floorGeometry, '#d8d3c7', 0, {});
  let unitCount = 0;
  units.forEach(({ object, geometry }) => {
    if (!valid(geometry) || geometry.frameId !== floorGeometry.frameId) return;
    const record = { unitId: object.id, geometryId: geometry.id, role: 'source_unit_boundary' };
    surface(geometry, ['#d9c9ab','#dfd9c8','#c6d6d3','#ddd1c2'][unitCount % 4], .012, record);
    edges(geometry, '#e5dfd2', .012, record); unitCount++;
  });
  return { group, pickables, unitCount, unavailableUnitCount: units.length - unitCount, available: true };
}

/** Selection changes only disposable presentation materials, never source geometry. */
export function styleReferenceFloorPlate(plate, selectedFloorId = 'all') {
  const selected = selectedFloorId === plate.group.userData.floorId;
  const muted = selectedFloorId !== 'all' && !selected;
  plate.group.traverse(node => {
    const material = node.material;
    if (!material?.color) return;
    if (!material.userData.floorBaseColor) material.userData.floorBaseColor = material.color.clone();
    material.color.copy(material.userData.floorBaseColor);
    if (selected && node.userData.role === 'diagram_boundary_not_measured_wall') material.color.set('#246e59');
    material.transparent = muted;
    material.opacity = muted ? .28 : 1;
    material.depthWrite = !muted;
    material.needsUpdate = true;
  });
}

/** Standalone, synthetic local-metre scene. Original fixture geometry is never mutated. */
export function mountMap(container, data, { onSelect, onRegister, onReview, onWorkspace, onFloorSelect, detail } = {}) {
  const detailMode=detail || (new URLSearchParams(window.location.search).get('detail')==='massing'?'massing':'full');
  const frameSamples=[],cpuSamples=[];let renderCount=0,previousFrameTime=0,needsRender=true;
  const startedAt=performance.now();
  const objects = data.objects || [];
  const geometries = new Map((data.geometries || []).map(g => [g.id, g]));
  const objectById = new Map(objects.map(o => [o.id, o]));
  const recordIndex=createSceneRecords(data);
  const identityFor=o=>recordIndex.identity(typeof o==='string'?o:o?.id);
  const primaryId=o=>identityFor(o)?.primary||o?.id||'ID unavailable';
  const displayGeometries=(data.displayGeometries||[]).filter(g=>g.displayRole==='display_only');
  const geometryFor = o => (o?.geometryId ? geometries.get(o.geometryId) : null) || displayGeometries.find(g=>g.objectId===o?.id);
  const polygonsFor = geo => geo?.type==='MultiPolygon'?geo.coordinates:geo?.type==='Polygon'?[geo.coordinates]:[];
  const pointsFor = geo => polygonsFor(geo).flat(2);
  const areaFor = geo => polygonsFor(geo).reduce((sum,p)=>sum+ringArea(p[0])-p.slice(1).reduce((n,r)=>n+ringArea(r),0),0);
  const boundsFor = geo => { const box=new THREE.Box3(),base=geo?.baseElevationM??0,top=base+(geo?.heightM??0);const points=geo?.type==='LineString'?geo.coordinates:geo?.type==='Point'?[geo.coordinates]:pointsFor(geo);points.forEach(p=>{const lower=Number.isFinite(p[2])?p[2]:base;box.expandByPoint(new THREE.Vector3(p[0],lower,-p[1]));box.expandByPoint(new THREE.Vector3(p[0],Number.isFinite(p[2])?p[2]:top,-p[1]));});return box; };
  const buildings = objects.filter(o => o.type === 'building' && ['Polygon','MultiPolygon'].includes(geometryFor(o)?.type));
  const state = { selectedId: buildings.find(o => o.id === data.metadata?.focalObjectId)?.id || buildings[0]?.id || null, activeConflictId: null, presentation: 'block', railTab: 'layers', railOpen: false, inspectorTab: 'overview', labels: true, inspectorOpen: true, mode: '3d', navigation: 'pan', floor: 'all', space: 'none', floorMode: 'below', floorPlates: false, explode: false, section: false, sectionHeight: 100, underground: false, layers: { buildings: true, parcels: true, roads: true, publicLand: true, trees: true, utilities: true, conflicts: true } };
  state.sourceView='model';state.sourceModelOverlay=false;
  const surveyAssets=data.survey?.assets||[];
  let blockViewState=null;
  let disposed = false, frameId, pointerStart, lastPick, renderer, contextLost=false;
  const cleanups = [];
  const listen = (el, event, handler, options) => { el.addEventListener(event, handler, options); cleanups.push(() => el.removeEventListener(event, handler, options)); };
  const selected = () => objectById.get(state.selectedId);
  const relationsFrom = (id, kind) => (data.relations || []).filter(r => r.fromId === id && (!kind || r.kind === kind)).map(r => objectById.get(r.toId)).filter(Boolean);
  const floorsFor = id => recordIndex.floors(id);
  const issuesFor = id => (data.issues || []).filter(i => i.objectId === id || i.targetId === id || i.objectIds?.includes(id) || i.affectedObjectIds?.includes(id));
  const spatialCodes=new Set(['BUILDING_OVERLAP','ROAD_OVERLAP','OUTSIDE_PARCEL','ROAD_BUILDING_OVERLAP','BUILDING_OUTSIDE_PARCEL']);
  const ringArea=ring=>Math.abs(ring.reduce((sum,p,index)=>{const next=ring[(index+1)%ring.length];return sum+p[0]*next[1]-next[0]*p[1];},0))/2;
  function parseSpatialConflict(issue){
    if(!spatialCodes.has(issue.code)||['resolved','dismissed','excluded'].includes(issue.status))return null;
    const evidence=issue.evidence,geometry=evidence?.intersectionGeometry || evidence?.geometry;
    if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type)||!Number.isFinite(evidence.areaM2))return null;
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    if(!polygons?.length||polygons.some(poly=>!poly?.length||poly.some(ring=>!Array.isArray(ring)||ring.length<4||ring.some(p=>!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])))))return null;
    const area=polygons.reduce((sum,poly)=>sum+ringArea(poly[0])-poly.slice(1).reduce((n,ring)=>n+ringArea(ring),0),0);
    const tolerance=Math.max(1e-6,evidence.areaToleranceM2 || 0);
    if(area<=tolerance||evidence.areaM2<=tolerance||Math.abs(area-evidence.areaM2)>Math.max(.01,area*1e-6))return null;
    const referenceIds=evidence.geometryRefs?.map(ref=>ref.geometryId) || evidence.computedFromGeometryIds || [];
    const references=referenceIds.map(id=>geometries.get(id));
    if(references.length<2||references.some(geo=>!geo||geo.frameId!==evidence.frameId))return null;
    if(evidence.verticalRelation==='disjoint')return null;
    const objectIds=[...new Set([...(issue.objectIds || []),issue.objectId,issue.targetId,evidence.otherObjectId,...references.map(geo=>geo.objectId)].filter(Boolean))];
    const buildingIds=objectIds.filter(id=>objectById.get(id)?.type==='building');if(!buildingIds.length)return null;
    const otherId=evidence.otherObjectId || objectIds.find(id=>id!==buildingIds[0]);
    return {id:issue.id,issue,geometry,polygons,areaM2:evidence.areaM2,buildingIds,objectIds,otherId,verticalRelation:evidence.verticalRelation,solidTint:!(issue.code==='BUILDING_OVERLAP'&&evidence.verticalRelation==='unknown')};
  }
  const spatialConflicts=(data.issues || []).map(parseSpatialConflict).filter(Boolean);
  const conflictsFor=id=>spatialConflicts.filter(conflict=>conflict.buildingIds.includes(id));
  const primaryOtherLabel=(conflict,id)=>{const other=conflict.objectIds.find(otherId=>otherId!==id&&objectById.get(otherId)?.type==='building') || (conflict.otherId!==id?conflict.otherId:conflict.objectIds.find(otherId=>otherId!==id));return objectById.get(other)?.label || other || 'linked geometry';};
  const conflictDescription=(conflict,id)=>{const area=conflict.areaM2.toLocaleString('en-IN',{maximumFractionDigits:2});const other=primaryOtherLabel(conflict,id);return ['OUTSIDE_PARCEL','BUILDING_OUTSIDE_PARCEL'].includes(conflict.issue.code)?`${area} m² outside ${other}`:`${area} m² overlaps ${other}`;};
  const parcelFor = id => {
    const relation = (data.relations || []).find(r => r.kind === 'occupies' && r.fromId === id && objectById.get(r.toId)?.type === 'parcel');
    return objectById.get(relation?.toId) || objects.find(o => o.type === 'parcel' && relationsFrom(o.id, 'contains').some(child => child.id === id));
  };

  const narrowLayout=()=>window.matchMedia('(max-width: 850px)').matches;
  container.classList.add('bm-root');
  container.innerHTML = `<button class="bm-rail-backdrop" data-action="close-explorer" aria-label="Close block explorer" hidden></button><aside class="bm-left-rail" aria-label="Block explorer">
    <div class="bm-mobile-rail-heading"><strong>Map tools</strong><button class="bm-icon-button" data-action="close-explorer" aria-label="Close block explorer">${icon('close')}</button></div>
    <div class="bm-mobile-map-actions"><button class="bm-button" data-action="labels" aria-pressed="true">${icon('source')}Labels</button><button class="bm-button" data-action="north">↑ Face north</button></div><div class="bm-rail-tabs" role="tablist" aria-label="Block explorer"><button data-rail-tab="layers" role="tab" aria-selected="true">${icon('layers')}Layers</button><button data-rail-tab="properties" role="tab" aria-selected="false">${icon('building')}Properties</button><button data-rail-tab="findings" role="tab" aria-selected="false">${icon('source')}Findings</button></div>
    <div class="bm-layers-pop">${surveyAssets.length?`<label class="bm-source-selector">Map data<select aria-label="Map data" data-survey-view><option value="model">Building model</option>${surveyAssets.map(a=>`<option value="${esc(a.id)}">${esc(a.label)}${surveyAssets.filter(b=>b.kind===a.kind).length>1?` · ${esc(a.sourcePath)}`:''}</option>`).join('')}</select></label><div class="bm-survey-details" hidden></div>`:''}<div class="bm-model-layer-options"><div class="bm-pop-heading"><strong>Map layers</strong><button class="bm-text-button" data-action="reset-layers">Reset</button></div>${[['buildings','Buildings','building'],['parcels','Parcels','parcel'],['roads','Roads','layers'],['publicLand','Public land','parcel'],['utilities','Utilities · underground','pipe'],['conflicts','Findings / conflicts','target']].map(([key,label,symbol])=>`<label class="bm-layer-option"><span>${icon(symbol)}${label}</span><input class="bm-switch" type="checkbox" data-layer="${key}" checked/></label>`).join('')}</div></div>
    <div class="bm-property-pop"><div class="bm-pop-heading"><strong>Properties in block <span class="bm-list-count">(${buildings.length})</span></strong></div><label class="bm-search">${icon('search')}<input type="search" placeholder="2D / 3D ULPIN, name, address…" aria-label="Search block properties"/></label><div class="bm-property-list"></div></div>
    <div class="bm-rail-findings" hidden></div><div class="bm-rail-note">Synthetic demonstration · ${objects.length} records</div>
  </aside><section class="bm-stage" aria-label="Interactive neighborhood map">
    <div class="bm-canvas" tabindex="0" role="application" aria-label="3D neighborhood. Drag to move the map. Choose Rotate to orbit. Scroll to zoom. Arrow keys move; F fits the block."></div>
    <div class="bm-top-tools"><button class="bm-button bm-explorer-trigger" data-action="explorer" aria-label="Open block explorer" aria-expanded="false">${icon('layers')}<span>Map tools</span></button><div class="bm-segment" aria-label="Map perspective"><button data-mode="3d" aria-pressed="true">3D</button><button data-mode="2d" aria-pressed="false">2D</button></div><button class="bm-button bm-underground" data-action="underground" aria-pressed="false">${icon('pipe')}<span>Underground</span></button><button class="bm-button" data-action="labels" aria-pressed="true">${icon('source')}<span>Labels</span></button></div>
    <div class="bm-nav-tools"><button class="bm-button" data-action="fit" title="Fit neighborhood (F)">${icon('fit')}<span>Fit block</span></button><button class="bm-button" data-action="focus" aria-label="Focus selected building">${icon('target')}<span>Focus</span></button><button class="bm-button bm-north" data-action="north" title="Face north" aria-label="Face north"><span class="bm-north-arrow">↑</span><span>N</span></button></div>
    <div class="bm-plate-tools" hidden><div class="bm-segment"><button data-action="floor-plates" aria-pressed="true">Floor plates</button><button data-action="exterior-floors" aria-pressed="false">Exterior floors</button></div><p></p></div><div class="bm-world-labels" aria-hidden="true"></div><div class="bm-floor-labels" role="group" aria-label="Floor labels"></div><div class="bm-selected-label" hidden></div><div class="bm-utility-note" hidden>Utility alignment · x-ray view</div>
    <div class="bm-minimap" aria-label="Block overview"></div><div class="bm-findings-tray"></div>
    <div class="bm-scale"><span></span><small></small></div><div class="bm-scene-caption"><span class="bm-caption-dot"></span>Synthetic block · local metres</div>
    <div class="bm-navigation"><div class="bm-segment" role="group" aria-label="Drag action"><button data-navigation="pan" aria-pressed="true">Move</button><button data-navigation="rotate" aria-pressed="false">Rotate</button></div><small class="bm-navigation-hint">Drag to move · scroll to zoom</small></div><div class="bm-zoom"><button data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button></div>
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
  const perspectiveCamera = new THREE.PerspectiveCamera(36, 1, 1, 1400);
  const planCamera = new THREE.OrthographicCamera(-70,70,70,-70,.1,1200);
  let camera=perspectiveCamera,orthoHalfHeight=70;
  const controlsState = { cameraOffset: new THREE.Vector3(155, 185, 205) };
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    canvasHost.innerHTML = '<div class="bm-render-error"><strong>The interactive scene needs WebGL.</strong><p>Use Find a property to explore the saved records.</p></div>';
    live('WebGL is unavailable. Property search and the inspector remain available.');
  }
  let controls,interacting=false,lastLabelTime=0;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    canvasHost.appendChild(renderer.domElement);
    listen(renderer.domElement,'webglcontextlost',event=>{event.preventDefault();contextLost=true;live('Graphics paused. Property search remains available.');});
    listen(renderer.domElement,'webglcontextrestored',()=>{contextLost=false;sun.shadow.needsUpdate=true;requestRender();live('Interactive map restored.');});
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .085;
    controls.maxPolarAngle = Math.PI / 2.12;
    controls.minDistance = 28;
    controls.maxDistance = 650;
    controls.screenSpacePanning = true;
    controls.listenToKeyEvents(canvasHost);
    controls.keyPanSpeed = 32;
    setNavigation('pan');
    controls.minZoom=.3;controls.maxZoom=15;
    listen(controls,'change',requestRender);listen(controls,'start',()=>{interacting=true;requestRender();});listen(controls,'end',()=>{interacting=false;requestRender();});
  }
  scene.add(new THREE.HemisphereLight('#eff5ff', '#96998a', 1.3));
  const sun = new THREE.DirectionalLight('#fffaf4', 2.7);
  sun.position.set(-120, 190, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 1, far: 550 });
  sun.shadow.normalBias = .09;
  sun.shadow.bias = -.00016;
  sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;
  scene.add(sun);
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness:.88, metalness:0, ...extra});
  const floorPlateRoot = new THREE.Group(), floorPlateEntries = new Map(), floorPlatePickables = []; scene.add(floorPlateRoot);
  const spaceHighlight = new THREE.Group();scene.add(spaceHighlight);
  const conflictGroup=new THREE.Group();conflictGroup.name='Computed intersection overlays';scene.add(conflictGroup);
  const conflictPickables=[],conflictDisplays=[];
  const clippingPlane = new THREE.Plane(new THREE.Vector3(0,-1,0),10000);
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
  objects.forEach(o => {const bounds=boundsFor(geometryFor(o));if(!bounds.isEmpty())extent.union(bounds);});
  if (extent.isEmpty()) extent.set(new THREE.Vector3(0,0,-190), new THREE.Vector3(240,0,0));
  const center = extent.getCenter(new THREE.Vector3()), size = extent.getSize(new THREE.Vector3()), span = Math.max(size.x,size.y,size.z,80), planLift=Math.max(450,size.y+100,span*1.5);
  perspectiveCamera.far=Math.max(1400,span*12);planCamera.far=perspectiveCamera.far;perspectiveCamera.updateProjectionMatrix();planCamera.updateProjectionMatrix();
  if(controls){controls.maxDistance=Math.max(650,span*5);controls.minDistance=Math.min(28,Math.max(5,span*.06));}
  scene.fog=new THREE.Fog('#e7ebdf',Math.max(420,span*2.2),Math.max(930,span*6));
  sun.target.position.copy(center); scene.add(sun.target);
  const lightReach=Math.max(250,span*1.3);sun.position.copy(center).add(new THREE.Vector3(-.55,.82,.42).normalize().multiplyScalar(lightReach));
  const architecture=buildArchitecture({buildings,geometryFor,floorsFor,clippingPlane,sceneDecoration:data.sceneDecoration,detail:detailMode});
  const {group:buildingGroup,entries:buildingEntries,pickables}=architecture;scene.add(buildingGroup);
  buildingEntries.forEach(entry=>entry.materials.forEach(({mat})=>{mat.clipShadows=true;}));
  const environment=createEnvironment(data,{THREE,geometryFor,detail:detailMode});scene.add(environment.group);
  const surveyLayers=createSurveyLayers(surveyAssets);scene.add(surveyLayers.group);
  const surveyBadge=document.createElement('div');surveyBadge.className='bm-survey-badge';surveyBadge.hidden=true;stage.appendChild(surveyBadge);
  const {parcels:parcelGroup,roads:roadGroup,trees:treeGroup,utilities:utilityGroup}=environment.layerRefs;
  spatialConflicts.forEach(conflict=>{
    const ground=new THREE.Group(),roof=new THREE.Group();conflictGroup.add(ground,roof);
    conflict.polygons.forEach(rings=>{
      const geometry={coordinates:rings};
      for(const [target,opacity] of [[ground,.78],[roof,.7]]){
        const mat=new THREE.MeshBasicMaterial({color:'#dc593f',transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
        const mesh=flatPolygon(geometry,mat,0);mesh.userData={issueId:conflict.id,objectId:conflict.buildingIds[0],computedIntersection:true};mesh.renderOrder=6;target.add(mesh);conflictPickables.push(mesh);
        rings.forEach(ring=>{const line=ringLine(ring,.015,'#9d3029');line.renderOrder=7;target.add(line);});
      }
    });
    ground.position.y=.28;
    conflictDisplays.push({conflict,ground,roof});
  });
  const shadowExtent=Math.max(span*.68,75);
  Object.assign(sun.shadow.camera,{left:-shadowExtent,right:shadowExtent,top:shadowExtent,bottom:-shadowExtent,near:1,far:lightReach+span*2});sun.shadow.camera.updateProjectionMatrix();

  function updatePlanFrustum() {
    const aspect=Math.max(stage.clientWidth,1)/Math.max(stage.clientHeight,1);
    planCamera.left=-orthoHalfHeight*aspect;planCamera.right=orthoHalfHeight*aspect;planCamera.top=orthoHalfHeight;planCamera.bottom=-orthoHalfHeight;planCamera.updateProjectionMatrix();
  }
  function fit() {
    if(state.presentation!=='block'){focusSelected();return;}
    const sourceBounds=surveyAssets.find(a=>a.id===state.sourceView)?.bounds;
    const sourceBox=sourceBounds?new THREE.Box3(new THREE.Vector3(sourceBounds[0],sourceBounds[2],-sourceBounds[4]),new THREE.Vector3(sourceBounds[3],sourceBounds[5],-sourceBounds[1])):null;
    const fitCenter=sourceBox?sourceBox.getCenter(new THREE.Vector3()):center,fitSize=sourceBox?sourceBox.getSize(new THREE.Vector3()):size;
    if(camera.isOrthographicCamera){
      const aspect=Math.max(stage.clientWidth,1)/Math.max(stage.clientHeight,1);
      orthoHalfHeight=Math.max(fitSize.z,fitSize.x/aspect)*.57;planCamera.zoom=1;updatePlanFrustum();
      camera.position.copy(fitCenter).add(new THREE.Vector3(0,planLift,.001));
    }else{
      const verticalHalfFov=THREE.MathUtils.degToRad(camera.fov/2),horizontalHalfFov=Math.atan(Math.tan(verticalHalfFov)*camera.aspect);
      const distance=Math.max(50,fitSize.length()*.5/Math.sin(Math.min(verticalHalfFov,horizontalHalfFov))*1.08);
      camera.position.copy(fitCenter).add(new THREE.Vector3(.57,.76,.68).normalize().multiplyScalar(distance));
    }
    if(controls){controls.target.copy(fitCenter);controls.update();}else camera.lookAt(fitCenter);
    requestRender();
  }
  function openingView() {
    const focal=buildingEntries.get(state.selectedId),geo=focal?.geo;
    const focalBounds=new THREE.Box3();
    if(geo)focalBounds.copy(boundsFor(geo));
    const target=focalBounds.isEmpty()?center.clone():focalBounds.getCenter(new THREE.Vector3());
    const focalSpan=focalBounds.isEmpty()?0:focalBounds.getSize(new THREE.Vector3()).length();
    const distance=(data.sceneDecoration?.camera?.distanceM || Math.max(THREE.MathUtils.clamp(span*.91,88,135),focalSpan*1.8))*Math.max(1,1.22/(perspectiveCamera.aspect||1));
    // View the authored southern entrance and balcony facade from the southeast.
    const authoredDirection=data.sceneDecoration?.camera?.direction;
    const direction=Array.isArray(authoredDirection)&&authoredDirection.length===3?new THREE.Vector3(...authoredDirection):new THREE.Vector3(.58,.92,.71);
    target.y=(geo?.baseElevationM??0)+Math.max(2,(focal?.height||0)*.3);
    if(Array.isArray(data.sceneDecoration?.camera?.focusOffset))target.add(new THREE.Vector3(...data.sceneDecoration.camera.focusOffset));
    camera.position.copy(target).add(direction.normalize().multiplyScalar(distance));
    if(controls){controls.target.copy(target);controls.update();}else camera.lookAt(target);
    requestRender();
  }
  function setNavigation(navigation) {
    state.navigation=navigation==='rotate'?'rotate':'pan';
    const rotate=state.mode==='3d'&&state.navigation==='rotate';
    if(controls){
      controls.enablePan=true;controls.enableRotate=state.mode==='3d';
      controls.mouseButtons.LEFT=rotate?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT=rotate||state.mode==='2d'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;
      controls.touches.ONE=rotate?THREE.TOUCH.ROTATE:THREE.TOUCH.PAN;
      controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    }
    container.querySelectorAll('[data-navigation]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.navigation===(rotate?'rotate':'pan')));
      button.disabled=button.dataset.navigation==='rotate'&&state.mode==='2d';
    });
    const hint=rotate?'Drag to rotate · scroll to zoom':'Drag to move · scroll to zoom';
    $('.bm-navigation-hint').textContent=hint;
    canvasHost.dataset.navigation=rotate?'rotate':'pan';
    canvasHost.setAttribute('aria-label',`3D neighborhood. ${hint}. Arrow keys move; F fits the block.`);
  }
  function setMode(mode) {
    if(!['2d','3d'].includes(mode)||mode===state.mode)return;
    const target=(controls?.target||center).clone();
    if(mode==='2d'){
      controlsState.cameraOffset.copy(perspectiveCamera.position).sub(target);
      orthoHalfHeight=perspectiveCamera.position.distanceTo(target)*Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov*.5));
      camera=planCamera;camera.zoom=1;updatePlanFrustum();camera.position.copy(target).add(new THREE.Vector3(0,planLift,.001));
    }else{
      const distance=(orthoHalfHeight/planCamera.zoom)/Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov*.5));
      camera=perspectiveCamera;camera.position.copy(target).add(controlsState.cameraOffset.clone().normalize().multiplyScalar(distance));
    }
    state.mode=mode;
    container.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
    if(controls){controls.object=camera;setNavigation(state.navigation);controls.target.copy(target);controls.update();}else camera.lookAt(target);
    requestRender();live(mode==='2d'?'Orthographic plan view. Drag to move.':'3D view. Use Move or Rotate to choose the drag action.');
  }
  function platesFor(entry) {
    if (!entry) return null;
    if (floorPlateEntries.has(entry.object.id)) return floorPlateEntries.get(entry.object.id);
    const group = new THREE.Group(), floors = new Map(); floorPlateRoot.add(group);
    entry.segments.forEach(segment => {
      if (!['floor', 'level'].includes(objectById.get(segment.id)?.type)) return;
      const units = relationsFrom(segment.id, 'contains').filter(o => ['space','unit'].includes(o.type)).map(object => ({ object, geometry: geometryFor(object) }));
      const plate = buildReferenceFloorPlate(segment.geometry, units, { objectId: entry.object.id, floorId: segment.id });
      if (!plate.available) return;
      group.add(plate.group); floors.set(segment.id, plate); floorPlatePickables.push(...plate.pickables);
    });
    const result = { group, floors }; floorPlateEntries.set(entry.object.id, result); return result;
  }
  const showingPlates = () => state.presentation === 'exploded' && state.floorPlates;
  function updateScene() {
    spaceHighlight.children.slice().forEach(child=>{child.geometry?.dispose();child.material?.dispose();spaceHighlight.remove(child);});
    if(state.floor!=='all'&&!showingPlates()){
      const entry=buildingEntries.get(state.selectedId),index=entry?.floors.findIndex(f=>f.id===state.floor)||0;
      relationsFrom(state.floor,'contains').filter(o=>['space','unit'].includes(o.type)).forEach(space=>{
        const spaceGeo=geometryFor(space);if(!polygonsFor(spaceGeo).length)return;
        const floorGeo=geometryFor(objectById.get(state.floor));
        const elevation=(floorGeo?.baseElevationM||0)+(floorGeo?.heightM||0)+.18+(state.explode?index*3:0);
        const active=space.id===state.space;
        polygonsFor(spaceGeo).forEach(coordinates=>{const spaceMesh=flatPolygon({coordinates},material(active?'#438567':'#a9c49c',{transparent:true,opacity:active?.94:.75,side:THREE.DoubleSide,clippingPlanes:[clippingPlane]}),elevation);
        if(spaceMesh)spaceHighlight.add(spaceMesh);
        coordinates.forEach(ring=>spaceHighlight.add(ringLine(ring,elevation+.05,active?'#23543d':'#567c48')));});
      });
    }
    const activePlates = showingPlates() ? platesFor(buildingEntries.get(state.selectedId)) : null;
    floorPlateRoot.visible = state.layers.buildings && showingPlates();
    floorPlateEntries.forEach((plates,id) => { plates.group.visible = id === state.selectedId; });
    const plateTools = $('.bm-plate-tools'); plateTools.hidden = state.presentation !== 'exploded';
    const placedCount = activePlates?.floors.size ?? buildingEntries.get(state.selectedId)?.segments.filter(s => ['floor','level'].includes(objectById.get(s.id)?.type) && Number.isFinite(s.geometry?.baseElevationM)).length ?? 0;
    plateTools.querySelector('[data-action="floor-plates"]').disabled = !placedCount;
    plateTools.querySelector('[data-action="floor-plates"]').setAttribute('aria-pressed', String(state.floorPlates));
    plateTools.querySelector('[data-action="exterior-floors"]').setAttribute('aria-pressed', String(!state.floorPlates));
    const unitCount = [...(activePlates?.floors.values() || [])].reduce((n,p) => n+p.unitCount, 0);
    plateTools.querySelector('p').textContent = showingPlates() && placedCount ? `Source boundaries · diagram edges, not measured walls${unitCount ? ` · ${unitCount} supplied unit outlines` : ' · Unit geometry not supplied'}` : !placedCount ? 'Separate floor geometry not supplied' : 'Exterior source floor volumes';
    buildingGroup.visible=state.layers.buildings;
    environment.group.visible=state.presentation==='block';scene.background.set(state.presentation==='block'?'#e7ebdf':'#f5f8f8');scene.fog.color.copy(scene.background);
    parcelGroup.visible=state.layers.parcels;roadGroup.visible=state.layers.roads;if(environment.layerRefs.publicLand)environment.layerRefs.publicLand.visible=state.layers.publicLand;treeGroup.visible=state.layers.trees&&!state.underground;
    environment.setUnderground?.(state.underground);utilityGroup.visible=state.underground&&state.layers.utilities;if(environment.layerRefs.utilityGuides)environment.layerRefs.utilityGuides.visible=state.layers.utilities&&!state.underground;
    clippingPlane.constant=state.section?state.sectionHeight:10000;
    sun.shadow.needsUpdate=true;
    buildingEntries.forEach(entry=>{
      const active=entry.object.id===state.selectedId;
      const batch=entry.blockBatch;const batched=!!batch&&state.presentation==='block'&&!state.explode&&!state.section&&(!active||state.floor==='all');if(batch)batch.group.visible=batched;
      entry.group.visible=state.presentation==='block'||active;
      entry.setSelected?.(active,conflictsFor(entry.object.id).some(conflict=>conflict.solidTint));entry.setUnderground?.(state.underground);
      const selectedFloorIndex=entry.floors.findIndex(f=>f.id===state.floor);
      entry.segments.forEach(segment=>{
        const selectedPlaced=entry.segments.some(segment=>segment.id===state.floor);
        const levelVisible=showingPlates()||!active||state.floor==='all'||!selectedPlaced||(state.floorMode==='isolate'?segment.index===selectedFloorIndex:segment.index<=selectedFloorIndex);
        segment.group.visible=!batched&&levelVisible&&(segment.base>=0||state.underground||state.presentation==='exploded'||(active&&segment.id===state.floor));
        segment.group.position.y=segment.base+(active&&state.explode?segment.index*3:0);
        const plate = active && activePlates?.floors.get(segment.id);
        if (plate) { plate.group.visible = segment.group.visible; plate.group.position.y = segment.group.position.y; styleReferenceFloorPlate(plate, state.floor); segment.group.visible = false; }
      });
      entry.outline.forEach(line=>{line.visible=(active||conflictsFor(entry.object.id).some(conflict=>conflict.solidTint))&&state.floor==='all'&&!state.section&&!state.explode;});
    });
    conflictGroup.visible=state.presentation==='block'&&state.layers.conflicts&&state.layers.buildings&&!state.underground;
    conflictDisplays.forEach(({conflict,ground,roof})=>{
      [ground,roof].forEach(group=>group.traverse(mesh=>{if(mesh.isMesh){mesh.material.opacity=state.activeConflictId===conflict.id ? .98 : state.activeConflictId ? .24 : .7;mesh.material.color.set(state.activeConflictId===conflict.id?'#ff311c':'#dc593f');}}));
      const tops=conflict.buildingIds.map(id=>{const entry=buildingEntries.get(id);return Math.max(0,...(entry?.segments||[]).filter(segment=>segment.group.visible||entry.blockBatch?.group.visible).map(segment=>segment.group.position.y+segment.height));});
      roof.position.y=Math.max(...tops)+.085;
      roof.visible=Math.max(...tops)>0&&!state.section;
    });
    $('.bm-underground').setAttribute('aria-pressed',String(state.underground));
    $('.bm-utility-note').hidden=!state.underground;
    spaceHighlight.visible=state.layers.buildings;
    const sourceActive=state.presentation==='block'&&state.sourceView!=='model';
    const asset=surveyLayers.show(sourceActive?state.sourceView:'model');
    if(asset){
      environment.group.visible=false;buildingGroup.visible=state.sourceModelOverlay;floorPlateRoot.visible=false;spaceHighlight.visible=false;conflictGroup.visible=false;
      scene.background.set('#e9eeed');scene.fog.color.copy(scene.background);
    }
    surveyBadge.hidden=!asset;
    if(asset)surveyBadge.textContent=asset.kind==='lidar'?`${asset.displayedPoints.toLocaleString('en-IN')} points · ${asset.minimum}–${asset.maximum} m`:asset.kind==='imagery'?`${asset.sourceWidth} × ${asset.sourceHeight} px · orthomosaic`:asset.minimum===asset.maximum?`${asset.label} · ${asset.minimum} m · flat terrain`:`${asset.label} · ${asset.minimum}–${asset.maximum} m · 1× height`;
    if(asset&&['dem','dsm'].includes(asset.kind)&&asset.maximum>asset.minimum){const ramp=document.createElement('span');ramp.className='bm-height-ramp';ramp.setAttribute('aria-label','Blue is lower, red is higher');surveyBadge.appendChild(ramp);}
    container.classList.toggle('bm-source-view',!!asset&&!state.sourceModelOverlay);container.classList.toggle('bm-survey-active',!!asset);
    requestRender();
  }
  function renderList(query='') {
    const matches=recordIndex.search(query).filter(hit=>buildingEntries.has(hit.buildingId));
    $('.bm-property-list').innerHTML=matches.length?matches.map(hit=>{const o=objectById.get(hit.buildingId),record=identityFor(hit.objectId),parcelIds=identityFor(o)?.twoDIds.filter(a=>/^[A-Za-z0-9]{14}$/.test(a.value)).map(a=>a.value)||[];return `<button class="bm-property-row" data-select="${esc(hit.buildingId)}" ${hit.floorId?`data-match-floor="${esc(hit.floorId)}"`:''} aria-pressed="${hit.buildingId===state.selectedId&&(!hit.floorId||state.floor===hit.floorId)}">${icon(hit.floorId?'floor':'building')}<span><strong>${esc(record?.primary||o.id)}${conflictsFor(o.id).length?'<i class="bm-conflict-dot" title="Computed spatial conflict"></i>':''}</strong><small>${esc(hit.label)}${hit.floorId?` · ${esc(o.label)}`:''}</small>${!hit.floorId&&parcelIds.length?`<small class="bm-list-parcel">2D · ${esc(parcelIds.join(', '))}</small>`:''}</span>${hit.buildingId===state.selectedId?icon('check'):icon('chevron')}</button>`;}).join(''):'<p class="bm-empty">No match. Search a 2D ULPIN, building or floor 3D ULPIN, name or address.</p>';
  }
  let thumbnailPending=true;
  const formatArea=value=>Number.isFinite(value)?`${value.toLocaleString('en-IN',{maximumFractionDigits:1})} m²`:'Unavailable';
  const relatedParcels=id=>recordIndex.parcels(id);
  function renderInspector() {
    const o=selected();if(!o){inspector.innerHTML='<p class="bm-empty">Select a building to inspect its record.</p>';return;}
    const identity=identityFor(o),parcelLabels=identity?.twoDIds.filter(a=>/^[A-Za-z0-9]{14}$/.test(a.value)).map(a=>a.value)||[];
    const geo=geometryFor(o),floors=floorsFor(o.id),parcels=relatedParcels(o.id),issues=issuesFor(o.id),hasHeight=Number.isFinite(geo?.heightM),conflicts=conflictsFor(o.id);
    const hasVerticalReference=hasHeight&&Number.isFinite(geo?.baseElevationM);
    const floor=objectById.get(state.floor),floorPlaced=Boolean(floor&&buildingEntries.get(o.id)?.segments.some(segment=>segment.id===floor.id)),placedFloors=floors.filter(f=>buildingEntries.get(o.id)?.segments.some(segment=>segment.id===f.id)),spaces=floor?relationsFrom(floor.id,'contains').filter(child=>['space','unit'].includes(child.type)):[];
    const records=(data.sourceRecords||[]).filter(r=>(o.sourceRecordIds||[]).includes(r.id));
    const sourceIds=[...new Set(records.map(r=>r.sourceId))],sources=(data.sources||[]).filter(s=>sourceIds.includes(s.id));
    const history=(data.geometries||[]).filter(g=>g.objectId===o.id).sort((a,b)=>(b.version||0)-(a.version||0));
    const occupants=recordIndex.residents(floor?.id||o.id);
    const occupantContent=`<section class="bm-occupant-section"><h3>${floor?'Floor residents':'Residents'} <span>(${occupants.length} supplied records)</span></h3>${occupants.length?`<p class="bm-detail-note">Supplied occupancy records; not proof of ownership.</p>${occupants.map(r=>`<article class="bm-occupant-row"><div><strong>${esc(r.name)}</strong><small>${esc(r.role)}</small></div><span>${esc(r.unitId?displayName(objectById.get(r.unitId)?.label||r.unitId):primaryId(r.floorId||r.objectId))}</span></article>`).join('')}`:'<p class="bm-detail-note">No resident records supplied.</p>'}</section>`;
    const address=displayName(o.attributes?.address || o.address || '');
    const minCut=Math.min(geo?.baseElevationM??0,...floors.map(f=>geometryFor(f)?.baseElevationM).filter(Number.isFinite));
    const maxCut=Math.max((geo?.baseElevationM??0)+(geo?.heightM??0),...floors.map(f=>{const g=geometryFor(f);return Number.isFinite(g?.baseElevationM)&&Number.isFinite(g?.heightM)?g.baseElevationM+g.heightM:NaN;}).filter(Number.isFinite));
    const summary=`<div class="bm-metric-grid"><div><span>Footprint</span><strong>${formatArea(areaFor(geo))}</strong></div><div><span>Height</span><strong>${hasHeight?`${geo.heightM.toFixed(1)} m`:'Unknown'}</strong></div><div><span>Linked parcels</span><strong>${parcels.length}</strong></div></div>`;
    const findings=conflicts.length?`<section class="bm-conflict-card" aria-label="Computed spatial conflicts"><div class="bm-conflict-heading"><span class="bm-review-sign">!</span><strong>${conflicts.length} spatial ${conflicts.length===1?'finding':'findings'}</strong></div>${conflicts.map(c=>`<button class="bm-conflict-row" data-conflict="${esc(c.id)}" aria-pressed="${state.activeConflictId===c.id}"><span>${esc(conflictDescription(c,o.id))}</span>${icon('target')}</button>${c.verticalRelation==='unknown'?'<p class="bm-conflict-note">Footprint overlap only. Height evidence is needed to check volumes.</p>':''}`).join('')}<p class="bm-conflict-note">Computed from draft geometry. Review required; this is not a legal finding.</p></section>`:`<div class="bm-neutral-note">${issues.length?`${issues.length} source or geometry checks await review.`:'No positive-area conflict found by the supported checks.'}</div>`;
    let content='';
    if(state.inspectorTab==='overview')content=`${summary}${!Number.isFinite(geo?.baseElevationM)?'<p class="bm-uncertainty">Base elevation not supplied · shown at display ground. Vertical placement is illustrative.</p>':''}${findings}<details class="bm-detail"><summary>Record details</summary><dl class="bm-facts"><dt>3D ULPIN</dt><dd>${esc(identity.primary)}</dd><dt>Parcel 2D ULPIN</dt><dd>${parcelLabels.length?esc(parcelLabels.join(', ')):'Not supplied'}</dd><dt>Level records</dt><dd>${floors.length?`${floors.length} supplied`:'Not supplied'}</dd><dt>Sources</dt><dd>${sources.length} linked files</dd><dt>Geometry revision</dt><dd>${esc(geo?.version??'Unavailable')}</dd><dt>Vertical reference</dt><dd>${esc(geo?.verticalDatum||'Unknown')}</dd></dl></details><button class="bm-inline-link" data-inspector-tab="floors">Explore floors ${icon('arrow')}</button><details class="bm-detail bm-resident-details"><summary>Resident records (${occupants.length}) ${icon('chevron')}</summary>${occupantContent}</details>`;
    if(state.inspectorTab==='floors')content=`<section class="bm-model-controls"><div class="bm-section-heading"><h3>Explore the building</h3><button class="bm-text-button" data-action="focus" aria-label="Focus selected building">${icon('target')}Focus</button></div><label class="bm-field-label" for="bm-floor">Floor</label><select id="bm-floor" class="bm-select" ${!floors.length?'disabled':''}><option value="all">${floors.length?`All ${floors.length} levels`:'No floor geometry supplied'}</option>${floors.map(f=>`<option value="${esc(f.id)}" ${state.floor===f.id?'selected':''}>${esc(f.label)} · ${esc(primaryId(f))}</option>`).join('')}</select><div class="bm-floor-options" ${state.floor==='all'?'hidden':''}><p>Floor 3D ULPIN: ${floor?esc(primaryId(floor)):''}</p>${floor&&!floorPlaced?'<p class="bm-uncertainty">Schedule record only. No floor geometry was supplied; the whole building remains context.</p>':''}${spaces.length?`<label class="bm-field-label" for="bm-space">Space on this floor</label><select id="bm-space" class="bm-select"><option value="none">Choose a space (${spaces.length})</option>${spaces.map(space=>`<option value="${esc(space.id)}" ${state.space===space.id?'selected':''}>${esc(space.label)}</option>`).join('')}</select>`:''}</div>${placedFloors.length>1?`<label class="bm-switch-row"><span>${icon('floor')}Separate floors</span><input type="checkbox" class="bm-switch" data-control="explode" ${state.explode?'checked':''}/></label>`:''}${!hasHeight?'<p class="bm-uncertainty">Height is not supplied. Only the known footprint is shown.</p>':''}</section><details class="bm-detail bm-resident-details"><summary>Resident records (${occupants.length}) ${icon('chevron')}</summary>${occupantContent}</details>`;
    if(state.inspectorTab==='parcels')content=`<section class="bm-record-section"><h3>Associated parcels (${parcels.length})</h3>${parcels.length?parcels.map(p=>`<article class="bm-parcel-card"><div>${icon('parcel')}<strong>${esc(p.label||p.id)}</strong></div><dl class="bm-facts"><dt>Parcel reference</dt><dd>${esc(p.id)}</dd><dt>Footprint area</dt><dd>${geometryFor(p)?formatArea(areaFor(geometryFor(p))):'Unavailable'}</dd><dt>2D ULPIN</dt><dd>${esc(identityFor(p)?.twoDIds.map(a=>a.value).join(', ')||'Not supplied')}</dd></dl></article>`).join(''):'<p class="bm-empty">No parcel association is supplied for this record.</p>'}<p class="bm-detail-note">Parcel and building identities remain separate. This demonstration does not issue official ULPINs.</p></section>`;
    if(state.inspectorTab==='sources')content=`<section class="bm-record-section"><p class="bm-detail-note">${esc(identity.classification)} source dataset. 3D IDs are application assignments, not official issuance. Original identifiers are retained.</p><details class="bm-detail"><summary>Parcels & identifiers (${parcels.length})</summary>${parcels.map(p=>`<p>${esc(p.label||p.id)} · ${esc(identityFor(p)?.twoDIds.map(a=>a.value).join(', ')||'2D ULPIN not supplied')}</p>`).join('')}<p>Source building: ${esc(o.id)}</p><p>Previous 3D references: ${esc((o.attributes?.identifierAliases||[]).join(', '))}</p></details><details class="bm-detail"><summary>Geometry history (${history.length})</summary>${history.map(g=>`<p>Revision ${esc(g.version)} · ${esc(g.id)}</p>`).join('')}</details><h3>Linked sources (${sources.length})</h3>${sources.length?sources.map(source=>`<article class="bm-source-card">${icon('source')}<div><strong>${esc(source.label||source.id)}</strong><small>${esc(source.modality||source.mimeType||'Source record')} · ${esc(source.classification||'Unknown classification')}</small><small>Revision ${esc(source.revision??'Unknown')}</small></div></article>`).join(''):'<p class="bm-empty">No original source file is linked to this property.</p>'}<h3>Source records</h3>${records.map(r=>`<dl class="bm-facts"><dt>${esc(r.id)}</dt><dd>${esc(r.locator||r.recordKey||'Locator unavailable')}</dd></dl>`).join('')}<p class="bm-detail-note">${(data.importDiagnostics||[]).filter(d=>d.objectId===o.id).map(d=>esc(d.message)).join(' ')||'File references describe supplied evidence. They do not establish survey accuracy or legal ownership.'}</p></section>`;
    if(state.inspectorTab==='history')content=`<section class="bm-record-section"><h3>Geometry history (${history.length})</h3>${history.map(g=>`<article class="bm-history-row"><span class="bm-history-marker"></span><div><strong>Revision ${esc(g.version??'Unknown')} ${g.id===o.geometryId?'<span class="bm-current-tag">Current</span>':''}</strong><p>${esc(g.id)}</p><small>${esc(g.status||'Unreviewed')} · ${esc(g.classification||'Unknown classification')}</small></div></article>`).join('')}<p class="bm-detail-note">Only supplied revisions are listed. Approval dates and officer actions have not been invented.</p></section>`;
    inspector.innerHTML=`<div class="bm-inspector-title"><strong>Building</strong><div><button class="bm-icon-button" data-action="previous-property" aria-label="Previous building">‹</button><button class="bm-icon-button" data-action="next-property" aria-label="Next building">›</button><button class="bm-icon-button" data-action="close-inspector" aria-label="Close inspector">${icon('close')}</button></div></div><div class="bm-inspector-heading"><div class="bm-scene-thumbnail"><img alt="Current interactive block view"/>${conflicts.length?'<span class="bm-conflict-badge">! Conflict detected</span>':'<span class="bm-draft-badge">Draft geometry</span>'}</div><div class="bm-id-kind">3D ULPIN</div><h2 title="${esc(identity.primary)}">${esc(identity.primary)}</h2><p class="bm-building-name">${esc(displayName(o.label))}</p>${address?`<p>${esc(address)}</p>`:''}<p class="bm-heading-parcel"><span>2D ULPIN</span> ${parcelLabels.length?esc(parcelLabels.join(', ')):'Not supplied'}</p><div class="bm-property-chips"><span>${icon('building')}${esc(o.attributes?.use||'Building')}</span><span>${icon('floor')}${floors.length?`${floors.length} levels`:'Levels unknown'}</span></div></div><div class="bm-inspector-tabs" role="tablist" aria-label="Building details">${[['overview','Overview'],['floors','Floors'],['sources','Sources']].map(([key,label])=>`<button data-inspector-tab="${key}" role="tab" aria-selected="${state.inspectorTab===key}">${label}</button>`).join('')}</div><div class="bm-inspector-scroll">${content}</div><div class="bm-inspector-footer"><div class="bm-footer-links">${onRegister?`<button class="bm-button" data-action="register">${icon('source')}Open register</button>`:''}${onWorkspace?`<button class="bm-button" data-action="workspace">${icon('arrow')}Workspace</button>`:''}</div>${onReview?`<button class="bm-primary" data-action="review">${icon('search')}Review findings</button>`:''}</div>`;
    thumbnailPending=true;requestRender();
  }
  function renderFindings() {
    const card = (c,small=false)=>`<button class="${small?'bm-tray-card':'bm-finding-list-row'}" data-conflict="${esc(c.id)}" aria-pressed="${state.activeConflictId===c.id}"><span class="bm-review-sign">!</span><span><strong>${esc(c.issue.code.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase()))}</strong><b>${formatArea(c.areaM2)}</b><small>${esc(primaryOtherLabel(c,c.buildingIds[0]))}</small></span></button>`;
    $('.bm-rail-findings').innerHTML=`<div class="bm-pop-heading"><strong>Spatial findings (${spatialConflicts.length})</strong></div><p class="bm-pop-note">Computed intersections from the imported draft geometry.</p>${spatialConflicts.length?spatialConflicts.map(c=>card(c)).join(''):'<p class="bm-empty">No positive-area conflicts in the supported checks.</p>'}`;
    const selectedFindings=conflictsFor(state.selectedId);
    $('.bm-findings-tray').hidden=!selectedFindings.length;
    $('.bm-findings-tray').innerHTML=`<div class="bm-tray-title"><span class="bm-review-sign">!</span><strong>Conflicts detected</strong><span>${selectedFindings.length}</span><button class="bm-text-button" data-rail-tab="findings">View all ${icon('chevron')}</button></div><div class="bm-tray-items">${selectedFindings.map(c=>card(c,true)).join('')}</div>`;
  }
  function renderMinimap() {
    const padding=6,bounds=extent,minX=bounds.min.x-padding,minY=bounds.min.z-padding,w=bounds.max.x-bounds.min.x+2*padding,h=bounds.max.z-bounds.min.z+2*padding;
    const paths=objects.filter(o=>['building','road','parcel','open_area'].includes(o.type)).sort((a,b)=>(a.type==='building')-(b.type==='building')).map(o=>`<path d="${polygonsFor(geometryFor(o)).map(p=>p.map(r=>`M${r.map(([x,y])=>`${x},${-y}`).join('L')}Z`).join('')).join('')}" fill="${o.type==='road'?'#cbd2cd':o.type==='parcel'?'#f0f2ea':o.id===state.selectedId?'#c8443e':conflictsFor(o.id).length?'#dc938c':o.type==='open_area'?'#c5d4b4':'#8eaaa0'}" stroke="#fff" stroke-width=".35" fill-rule="evenodd"/>`).join('');
    $('.bm-minimap').innerHTML=`<button data-action="fit" aria-label="Fit block from overview"><svg viewBox="${minX} ${minY} ${w} ${h}" aria-hidden="true">${paths}</svg><span>Block overview ${icon('fit')}</span></button>`;
  }
  function updateScale(){
    const host=$('.bm-scale');if(!host)return;
    const distance=camera.position.distanceTo(controls?.target||center),metresPerPixel=camera.isOrthographicCamera?(orthoHalfHeight*2/camera.zoom)/stage.clientHeight:(2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))/stage.clientHeight;
    if(!Number.isFinite(metresPerPixel)||metresPerPixel<=0)return;
    const target=80*metresPerPixel,power=10**Math.floor(Math.log10(target)),length=[1,2,5,10].map(n=>n*power).reduce((a,b)=>Math.abs(a-target)<Math.abs(b-target)?a:b);
    host.querySelector('span').style.width=`${length/metresPerPixel}px`;host.querySelector('small').textContent=`${camera.isOrthographicCamera?'':'≈ '}${length.toLocaleString('en-IN')} m`;
  }
  function setFloor(id,notify=true){
    if(id!=='all'&&!floorsFor(state.selectedId).some(f=>f.id===id))return;
    // Floor filtering keeps the register's camera and section mode in sync with its toolbar.
    if(state.presentation==='block'){state.section=false;setMode('3d');}
    state.floor=id;state.space='none';state.inspectorTab='floors';if((geometryFor(objectById.get(id))?.baseElevationM??0)<0)state.underground=true;
    renderInspector();renderList($('.bm-search input').value);updateScene();if(notify)onFloorSelect?.(id);live(id==='all'?'Showing all floors.':`Showing ${objectById.get(id)?.label||id}.`);
  }
  function setSourceView(id,options={}){
    if(id!=='model'&&!surveyAssets.some(a=>a.id===id))return;
    state.sourceView=id;
    const select=container.querySelector('[data-survey-view]');if(select)select.value=id;
    const asset=surveyAssets.find(a=>a.id===id),details=$('.bm-survey-details'),modelOptions=$('.bm-model-layer-options');
    if(modelOptions)modelOptions.hidden=!!asset;
    if(details){details.hidden=!asset;if(asset)details.innerHTML=`<label class="bm-layer-option"><span>Compare building model</span><input class="bm-switch" type="checkbox" data-survey-overlay aria-label="Compare building model" ${state.sourceModelOverlay?'checked':''}/></label><details class="bm-detail"><summary>Source details</summary><p>${esc(asset.sourcePath)}</p><p>${esc(asset.classification)} · ${esc(asset.sourceRevision)}</p><p>${esc(asset.verticalReference)}</p><p>${asset.kind==='lidar'?`${asset.pointCount.toLocaleString('en-IN')} source points · ${asset.displayedPoints.toLocaleString('en-IN')} displayed`: `${asset.sourceWidth} × ${asset.sourceHeight} source pixels`}</p><p>Rendered from the original file. Building records remain a separate supplied model.</p></details>`;}
    if(asset&&!options.restore){setInspectorOpen(false);setMode(asset.kind==='imagery'?'2d':'3d');fit();}
    updateScene();
    if(!options.restore)live(asset?`${asset.label} source view.`:'Building model view.');
  }
  function setLayer(key,visible){
    if(!(key in state.layers))return;state.layers[key]=Boolean(visible);const input=container.querySelector(`[data-layer="${key}"]`);if(input)input.checked=state.layers[key];updateScene();
  }
  function setInspectorOpen(open) {
    if(open&&narrowLayout())setRailOpen(false);
    state.inspectorOpen=Boolean(open);inspector.hidden=!state.inspectorOpen;container.classList.toggle('bm-inspector-closed',!state.inspectorOpen);
  }
  function select(id, notify=true, focus=notify) {
    if(!buildingEntries.has(id))return;
    if(state.sourceView!=='model')setSourceView('model',{restore:true});
    setInspectorOpen(true);
    state.selectedId=id;state.activeConflictId=null;state.floor='all';state.space='none';
    // Selection changes the subject, not the register's active presentation.
    const geometry=geometryFor(selected());
    state.explode=state.presentation==='exploded'&&(buildingEntries.get(id)?.segments.length||0)>1;
    state.section=state.presentation==='section'&&Number.isFinite(geometry?.baseElevationM)&&Number.isFinite(geometry?.heightM);
    state.sectionHeight=(geometry?.baseElevationM??0)+(geometry?.heightM??0)*.6;
    renderInspector();renderList($('.bm-search input').value);renderFindings();renderMinimap();updateScene();
    live(`${selected().label} selected. ${geometryFor(selected())?.heightM===null?'Height unresolved; showing footprint only.':''}`);
    if(focus)focusSelected();
    if(notify){onSelect?.(id,selected());onFloorSelect?.('all');}
  }
  function setRailOpen(open){
    state.railOpen=Boolean(open);container.classList.toggle('bm-rail-open',state.railOpen);
    $('.bm-rail-backdrop').hidden=!state.railOpen;
    $('.bm-explorer-trigger').setAttribute('aria-expanded',String(state.railOpen));
    if(state.railOpen)$('.bm-mobile-rail-heading [data-action="close-explorer"]').focus();
  }
  function setRailTab(tab) {
    if(!['layers','properties','findings'].includes(tab))return;
    state.railTab=tab;
    container.querySelectorAll('[data-rail-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.railTab===tab)));
    $('.bm-layers-pop').hidden=tab!=='layers';$('.bm-property-pop').hidden=tab!=='properties';$('.bm-rail-findings').hidden=tab!=='findings';
  }
  function closePopovers() {} // Explorer is persistent; selection never hides context.
  function focusSelected() {
    const entry=buildingEntries.get(state.selectedId);if(!entry||!controls)return;
    const plates=showingPlates()?platesFor(entry):null;
    const box=plates?.floors.size?new THREE.Box3().setFromObject(plates.group):state.explode?new THREE.Box3().setFromObject(entry.group):boundsFor(entry.geo);
    const dimensions=box.getSize(new THREE.Vector3()),target=box.getCenter(new THREE.Vector3());if(state.presentation==='block'&&!state.explode)target.y=(entry.geo.baseElevationM??0)+(entry.height||0)*.3;
    if(camera.isOrthographicCamera){orthoHalfHeight=Math.max(state.presentation==='elevation'?dimensions.y:dimensions.z,dimensions.x/(stage.clientWidth/stage.clientHeight),5)*.85;camera.zoom=1;updatePlanFrustum();camera.position.copy(target).add(state.presentation==='elevation'?new THREE.Vector3(0,0,planLift):new THREE.Vector3(0,planLift,.001));}
    else {const verticalHalf=THREE.MathUtils.degToRad(camera.fov/2),horizontalHalf=Math.atan(Math.tan(verticalHalf)*camera.aspect);const distance=Math.max(50,dimensions.length()*.5/Math.sin(Math.min(verticalHalf,horizontalHalf))*1.2);const offset=camera.position.clone().sub(controls.target).normalize().multiplyScalar(distance);camera.position.copy(target).add(offset);}
    controls.target.copy(target);controls.update();requestRender();
  }
  listen(container,'click',event=>{
    const element=event.target.closest('button');if(!element)return;
    if(element.dataset.floorSelect){setFloor(element.dataset.floorSelect);return;}
    if(element.dataset.railTab){setRailTab(element.dataset.railTab);return;}
    if(element.dataset.inspectorTab){state.inspectorTab=element.dataset.inspectorTab;renderInspector();return;}
    if(element.dataset.conflict){const finding=spatialConflicts.find(c=>c.id===element.dataset.conflict);if(!finding)return;if(!finding.buildingIds.includes(state.selectedId))select(finding.buildingIds[0]);state.activeConflictId=element.dataset.conflict;renderInspector();renderFindings();updateScene();live('Intersection highlighted. '+conflictDescription(spatialConflicts.find(conflict=>conflict.id===state.activeConflictId),state.selectedId));return;}
    if(element.dataset.select){select(element.dataset.select);if(element.dataset.matchFloor)setFloor(element.dataset.matchFloor);closePopovers();canvasHost.focus();return;}
    if(element.dataset.mode){setMode(element.dataset.mode);return;}
    if(element.dataset.navigation){setNavigation(element.dataset.navigation);canvasHost.focus({preventScroll:true});live($('.bm-navigation-hint').textContent);return;}
    if(element.dataset.floorMode){state.floorMode=element.dataset.floorMode;renderInspector();updateScene();return;}
    const action=element.dataset.action;
    if(action==='explorer'){setRailOpen(!state.railOpen);return;}
    if(action==='close-explorer'){setRailOpen(false);canvasHost.focus();return;}
    if(action==='previous-property'||action==='next-property'){const index=buildings.findIndex(o=>o.id===state.selectedId);select(buildings[(index+(action==='next-property'?1:-1)+buildings.length)%buildings.length]?.id);}
    else if(action==='close-inspector'){setInspectorOpen(false);canvasHost.focus();live('Inspector closed. Select a building to reopen it.');}
    else if(action==='properties'||action==='layers'){
      setRailTab(action);
    }else if(action==='close-pop'){closePopovers();}
    else if(action==='fit'){fit();live('Neighborhood fitted to the view.');}
    else if(action==='north'&&controls){const offset=camera.position.clone().sub(controls.target),distance=offset.length();camera.position.copy(controls.target).add(new THREE.Vector3(0,state.mode==='2d'?distance:distance*.78,state.mode==='2d'?.001:distance*.63));controls.update();}
    else if(action==='zoom-in'||action==='zoom-out'){if(controls){if(camera.isOrthographicCamera){camera.zoom=THREE.MathUtils.clamp(camera.zoom*(action==='zoom-in'?1.28:.78),controls.minZoom,controls.maxZoom);camera.updateProjectionMatrix();}else{const offset=camera.position.clone().sub(controls.target).multiplyScalar(action==='zoom-in'?.78:1.28);offset.setLength(Math.max(controls.minDistance,Math.min(controls.maxDistance,offset.length())));camera.position.copy(controls.target).add(offset);}controls.update();requestRender();}}
    else if(action==='floor-plates'||action==='exterior-floors'){state.floorPlates=action==='floor-plates';updateScene();focusSelected();}
    else if(action==='focus'){focusSelected();}
    else if(action==='labels'){state.labels=!state.labels;container.querySelectorAll('[data-action="labels"]').forEach(button=>button.setAttribute('aria-pressed',String(state.labels)));requestRender();}
    else if(action==='reset-layers'){Object.keys(state.layers).forEach(key=>setLayer(key,true));}
    else if(action==='workspace'){onWorkspace?.(state.selectedId,selected());}
    else if(action==='underground'){state.underground=!state.underground;updateScene();live(state.underground?'Underground utility alignment revealed. Ground surfaces are transparent.':'Ground view restored.');}
    else if(action==='parcel'){state.inspectorTab='parcels';renderInspector();const parcel=parcelFor(state.selectedId);if(parcel){const geo=geometryFor(parcel);if(geo)live(`Linked parcel ${parcel.id}. ${geo.areaM2 ? `${geo.areaM2} square metres in synthetic fixture.`:''}`);}}
    else if(action==='register'){onRegister?.(state.selectedId,selected());}
    else if(action==='review'){onReview?.(state.selectedId,selected(),{issueIds:conflictsFor(state.selectedId).map(conflict=>conflict.id),activeIssueId:state.activeConflictId});}
  });
  listen(container,'input',event=>{
    const element=event.target;
    if(element.matches('.bm-search input'))renderList(element.value);
    if(element.id==='bm-cut'){state.sectionHeight=Number(element.value);$('.bm-section-slider output').textContent=`${state.sectionHeight.toFixed(1)} m`;updateScene();}
  });
  listen(container,'change',event=>{
    const element=event.target;
    if(element.hasAttribute('data-survey-view'))setSourceView(element.value);
    if(element.hasAttribute('data-survey-overlay')){state.sourceModelOverlay=element.checked;updateScene();}
    if(element.dataset.layer){setLayer(element.dataset.layer,element.checked);}
    if(element.dataset.control){state[element.dataset.control]=element.checked;renderInspector();updateScene();}
    if(element.id==='bm-space'){state.space=element.value;renderInspector();updateScene();live(state.space==='none'?'Space selection cleared.':`${objectById.get(state.space)?.label} selected.`);}
    if(element.id==='bm-floor')setFloor(element.value);
  });
  listen(container,'keydown',event=>{
    if(event.key.toLowerCase()==='b'&&new URLSearchParams(window.location.search).get('diagnostics')==='1'&&!event.target.matches('input,select,textarea')){event.preventDefault();void measureOrbit(2400).then(result=>{canvasHost.dataset.orbitBenchmark=JSON.stringify(result);});}
    if(event.key==='Escape'){if(state.railOpen){setRailOpen(false);$('.bm-explorer-trigger').focus();return;}closePopovers();state.floor='all';state.space='none';state.explode=false;state.section=false;renderInspector();updateScene();canvasHost.focus();live('Floor tools reset.');}
    if(event.key.toLowerCase()==='f'&&!event.target.matches('input,select,textarea')){event.preventDefault();fit();}
  });
  if(renderer){
    listen(renderer.domElement,'pointerdown',event=>{canvasHost.focus({preventScroll:true});pointerStart={x:event.clientX,y:event.clientY,previous:lastPick};});
    listen(renderer.domElement,'pointerup',event=>{
      if(!pointerStart||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5||event.button!==0)return;
      const rect=renderer.domElement.getBoundingClientRect(),pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
      const hits=ray.intersectObjects([...pickables,...floorPlatePickables,...conflictPickables],false).filter(hit=>{let visible=true;for(let parent=hit.object;parent;parent=parent.parent)visible=visible&&parent.visible;return visible&&(!state.section||hit.point.y<=state.sectionHeight);});
      const byId=new Map();for(const hit of hits){const id=hit.object.userData.objectId;if(!byId.has(id))byId.set(id,hit);}const unique=[...byId.values()];
      if(unique.length){
        const repeated=pointerStart.previous&&performance.now()-pointerStart.previous.time<1600&&Math.hypot(event.clientX-pointerStart.previous.x,event.clientY-pointerStart.previous.y)<8;
        const index=repeated?(unique.findIndex(hit=>hit.object.userData.objectId===state.selectedId)+1)%unique.length:0;
        const hit=unique[index];select(hit.object.userData.objectId,true,false);if(hit.object.userData.floorId)setFloor(hit.object.userData.floorId);state.activeConflictId=hit.object.userData.issueId||null;renderInspector();updateScene();
        lastPick={x:event.clientX,y:event.clientY,time:performance.now()};
        if(unique.length>1)live(`${selected().label} selected. Click the same location again to cycle ${unique.length} overlapping buildings.`);
      }else closePopovers();
    });
  }
  function resize() {
    const rect=stage.getBoundingClientRect();perspectiveCamera.aspect=Math.max(rect.width,1)/Math.max(rect.height,1);perspectiveCamera.updateProjectionMatrix();updatePlanFrustum();renderer?.setSize(rect.width,rect.height,false);requestRender();
  }
  const observer=new ResizeObserver(resize);observer.observe(stage);cleanups.push(()=>observer.disconnect());
  resize();setRailTab(state.railTab);renderList();renderFindings();renderMinimap();renderInspector();select(state.selectedId,false);if(narrowLayout())setInspectorOpen(false);openingView();
  function requestRender(){needsRender=true;if(!frameId&&!disposed)frameId=requestAnimationFrame(animate);}
  const mapLabels=objects.filter(o=>(['road','open_area','building'].includes(o.type)&&polygonsFor(geometryFor(o)).length)||(o.type==='utility'&&geometryFor(o)?.type==='LineString'))
    .sort((a,b)=>(a.type==='building')-(b.type==='building')||areaFor(geometryFor(b))-areaFor(geometryFor(a))).slice(0,130).map(object=>{
      const geo=geometryFor(object),base=geo.baseElevationM??0;let longest=null,length=0;
      for(const poly of polygonsFor(geo))for(let i=1;i<poly[0].length;i++){
        const a=poly[0][i-1],b=poly[0][i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
        if(distance>length){length=distance;longest=[new THREE.Vector3(a[0],base,-a[1]),new THREE.Vector3(b[0],base,-b[1])];}
      }
      return {object,anchor:object.type==='utility'?new THREE.Vector3(geo.coordinates[Math.min(1,geo.coordinates.length-1)][0],.2,-geo.coordinates[Math.min(1,geo.coordinates.length-1)][1]):object.type==='building'?buildingEntries.get(object.id)?.anchor.clone()||boundsFor(geo).getCenter(new THREE.Vector3()):boundsFor(geo).getCenter(new THREE.Vector3()),edge:longest};
    });
  $('.bm-world-labels').innerHTML=mapLabels.map(o=>`<span class="bm-world-label ${o.object.type==='open_area'?'bm-world-public':o.object.type==='building'?'bm-world-building':o.object.type==='utility'?'bm-world-utility':''}">${esc(o.object.type==='building'?primaryId(o.object):displayName(o.object.label))}</span>`).join('');
  const labelNodes=[...container.querySelectorAll('.bm-world-label')];let labelDimensions=null,labelMeasureWidth=0;
  function updateWorldLabels(){
    const width=stage.clientWidth,height=stage.clientHeight,stageRect=stage.getBoundingClientRect(),padding=10;
    const overlaps=(a,b)=>a.left<b.right+8&&a.right>b.left-8&&a.top<b.bottom+8&&a.bottom>b.top-8;
    const occupied=[...container.querySelectorAll('.bm-top-tools,.bm-nav-tools,.bm-findings-tray,.bm-minimap,.bm-scale,.bm-zoom,.bm-scene-caption,.bm-selected-label,.bm-inspector')]
      .filter(node=>!node.hidden&&node.getClientRects().length).map(node=>{const r=node.getBoundingClientRect();return {left:r.left-stageRect.left,right:r.right-stageRect.left,top:r.top-stageRect.top,bottom:r.bottom-stageRect.top};});
    // Hidden nodes have zero dimensions. Batch these writes before measuring actual type.
    labelNodes.forEach(node=>{node.hidden=false;node.style.visibility='hidden';});
    if(!labelDimensions||labelMeasureWidth!==width){labelDimensions=labelNodes.map(node=>({width:node.offsetWidth,height:node.offsetHeight}));labelMeasureWidth=width;}const dimensions=labelDimensions;
    let shownBuildings=0;
    const ordered=mapLabels.map((item,i)=>({item,i})).sort((a,b)=>(a.item.object.type==='building')-(b.item.object.type==='building')||(a.item.object.type==='building'?a.item.anchor.distanceTo(controls?.target||center)-b.item.anchor.distanceTo(controls?.target||center):0));
    ordered.forEach(({item,i})=>{
      const projected=item.anchor.clone().project(camera),node=labelNodes[i];
      node.hidden=true;
      if((state.sourceView!=='model'&&(!state.sourceModelOverlay||item.object.type!=='building'))||!state.labels||state.underground||state.presentation!=='block'||projected.z>1||projected.z< -1||!state.layers[item.object.type==='road'?'roads':item.object.type==='building'?'buildings':item.object.type==='utility'?'utilities':'publicLand'])return;
      if(item.object.type==='building'){
        if(item.object.id===state.selectedId||shownBuildings>=4)return;
        const geo=geometryFor(item.object),top=(geo.baseElevationM??0)+(geo.heightM??0);
        const corners=pointsFor(geo).map(p=>new THREE.Vector3(p[0],top,-p[1]).project(camera));
        const screenWidth=(Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x)))*width/2;
        if(screenWidth<Math.max(60,dimensions[i].width*.72))return;
      }
      const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;
      let angle=0;
      if(item.object.type==='road'&&item.edge){
        const a=item.edge[0].clone().project(camera),b=item.edge[1].clone().project(camera);
        angle=Math.atan2(-(b.y-a.y)*height,(b.x-a.x)*width);
        if(angle>Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;
      }
      const w=dimensions[i].width,h=dimensions[i].height,boxWidth=Math.abs(Math.cos(angle))*w+Math.abs(Math.sin(angle))*h,boxHeight=Math.abs(Math.sin(angle))*w+Math.abs(Math.cos(angle))*h;
      const box={left:x-boxWidth/2,right:x+boxWidth/2,top:y-boxHeight/2,bottom:y+boxHeight/2};
      if(box.left<padding||box.right>width-padding||box.top<padding||box.bottom>height-padding||occupied.some(other=>overlaps(box,other)))return;
      node.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%) rotate(${angle}rad)`;node.style.visibility='visible';node.hidden=false;occupied.push(box);if(item.object.type==='building')shownBuildings++;
    });
  }
  let floorLabelKey='';
  function updateFloorLabels(){
    const entry=buildingEntries.get(state.selectedId),host=$('.bm-floor-labels');
    const segments=entry?.segments.filter(segment=>objectById.get(segment.id)&&['floor','level'].includes(objectById.get(segment.id).type))||[];
    const key=state.selectedId+':'+segments.map(s=>s.id).join(',');
    if(floorLabelKey!==key){host.innerHTML=segments.map(segment=>`<button type="button" class="bm-floor-map-label" data-floor-select="${esc(segment.id)}" aria-label="Select ${esc(objectById.get(segment.id)?.label)}"><strong>${esc(objectById.get(segment.id)?.label)}</strong><small>${Number(segment.base.toFixed(1))} m</small></button>`).join('');floorLabelKey=key;}
    const nodes=[...host.children],occupied=[];
    segments.forEach((segment,i)=>{
      const node=nodes[i];node.hidden=true;node.setAttribute('aria-pressed',String(state.floor===segment.id));
      const plate=showingPlates()?floorPlateEntries.get(state.selectedId)?.floors.get(segment.id):null;
      if((state.sourceView!=='model'&&!state.sourceModelOverlay)||!state.labels||!state.layers.buildings||(!state.explode&&state.floor!==segment.id)||!(plate?plate.group.visible:segment.group.visible))return;
      const elevation=segment.group.position.y+(plate ? .15 : segment.height*.5),points=pointsFor(segment.geometry).map(p=>new THREE.Vector3(p[0],elevation,-p[1]).project(camera));
      const visible=points.filter(p=>p.z>=-1&&p.z<=1);if(!visible.length)return;
      const x=(Math.min(...visible.map(p=>p.x))*.5+.5)*stage.clientWidth-16,y=(-visible.reduce((n,p)=>n+p.y,0)/visible.length*.5+.5)*stage.clientHeight;
      node.hidden=false;const w=node.offsetWidth,h=node.offsetHeight,left=x-w,right=x,top=y-h/2,bottom=y+h/2;
      if(left<8||right>stage.clientWidth-8||top<20||bottom>stage.clientHeight-52||occupied.some(r=>top<r.bottom+5&&bottom>r.top-5)){node.hidden=true;return;}
      node.style.transform=`translate(${x}px,${y}px) translate(-100%,-50%)`;occupied.push({top,bottom});
    });
  }
  function updateLabel(){
    const entry=buildingEntries.get(state.selectedId),label=$('.bm-selected-label');
    if(entry&&state.layers.buildings&&state.labels&&renderer){
      const anchor=entry.anchor?.clone() || new THREE.Box3().setFromObject(entry.group).getCenter(new THREE.Vector3());
      const activeSegment=entry.segments.find(segment=>segment.id===state.floor);
      if(activeSegment)anchor.y=activeSegment.base+(showingPlates()? .6 : activeSegment.height+2)+(state.explode?activeSegment.index*3:0);
      else if(state.explode)anchor.y+=Math.max(entry.floors.length-1,0)*3;
      if(state.section)anchor.y=Math.min(anchor.y,state.sectionHeight+2);
      anchor.project(camera);const width=stage.clientWidth,height=stage.clientHeight;
      label.hidden=anchor.z>1||anchor.x<-.92||anchor.x>.92||anchor.y<-.95||anchor.y>.88;
      label.style.transform=`translate(-50%,-100%) translate(${(anchor.x*.5+.5)*width}px,${(-anchor.y*.5+.5)*height-12}px)`;
      const hasConflict=conflictsFor(entry.object.id).length>0;label.classList.toggle('bm-label-conflict',hasConflict);
      const labelObject=activeSegment?objectById.get(activeSegment.id):entry.object;const text=`${primaryId(labelObject)}${activeSegment?` · ${labelObject?.label||'Floor'}`:hasConflict?' · conflict':entry.height===null?' · footprint':''}`;if(label.textContent!==text)label.textContent=text;
    }else label.hidden=true;
    updateWorldLabels();updateFloorLabels();
  }
  function animate(timestamp){
    frameId=null;if(disposed)return;
    const moving=controls?.update();
    if(needsRender||moving){
      const start=performance.now();const active=!!moving||interacting;const pixelRatio=Math.min(window.devicePixelRatio||1,active?.8:1.25);if(renderer&&renderer.getPixelRatio()!==pixelRatio)renderer.setPixelRatio(pixelRatio);if(!active||timestamp-lastLabelTime>66){updateLabel();updateScale();lastLabelTime=timestamp;}if(!contextLost)renderer?.render(scene,camera);if(thumbnailPending&&renderer&&!contextLost&&!active&&state.presentation==='block'&&state.inspectorOpen){const image=$('.bm-scene-thumbnail img');if(image){const thumb=document.createElement('canvas');thumb.width=400;thumb.height=Math.round(400*renderer.domElement.height/renderer.domElement.width);thumb.getContext('2d')?.drawImage(renderer.domElement,0,0,thumb.width,thumb.height);image.src=thumb.toDataURL('image/jpeg',.78);thumbnailPending=false;}}cpuSamples.push(performance.now()-start);if(cpuSamples.length>180)cpuSamples.shift();
      if(previousFrameTime&&timestamp-previousFrameTime<250){frameSamples.push(timestamp-previousFrameTime);if(frameSamples.length>180)frameSamples.shift();}
      previousFrameTime=timestamp;renderCount++;needsRender=false;
      if(renderCount%10===0||!moving){canvasHost.dataset.renderMetrics=JSON.stringify({drawCalls:renderer?.info.render.calls,triangles:renderer?.info.render.triangles,frames:renderCount,cpuMs:Math.round(cpuSamples.reduce((a,b)=>a+b,0)/cpuSamples.length*10)/10,frameMs:frameSamples.length?Math.round(frameSamples.reduce((a,b)=>a+b,0)/frameSamples.length*10)/10:null});}
    }
    if(moving)requestRender();
  }
  function getStats(){
    const summarize=values=>{if(!values.length)return {count:0,averageMs:null,p95Ms:null};const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,averageMs:Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(2)),p95Ms:Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))].toFixed(2))};};
    return {detail:detailMode,architecture:architecture.stats || null,environment:environment.stats || null,renderer:'Three.js '+THREE.REVISION,cameraType:camera.type,cameraRange:{near:camera.near,far:camera.far,maxDistance:controls?.maxDistance,planLift},sceneBounds:{min:extent.min.toArray(),max:extent.max.toArray()},contextLost,spatialConflicts:spatialConflicts.map(conflict=>({id:conflict.id,code:conflict.issue.code,areaM2:conflict.areaM2,buildingIds:conflict.buildingIds,solidTint:conflict.solidTint})),drawCalls:renderer?.info.render.calls||0,triangles:renderer?.info.render.triangles||0,geometries:renderer?.info.memory.geometries||0,textures:renderer?.info.memory.textures||0,renderCount,elapsedMs:Math.round(performance.now()-startedAt),viewport:{width:stage.clientWidth,height:stage.clientHeight,pixelRatio:renderer?.getPixelRatio()||1},activeFrameIntervals:summarize(frameSamples),cpuRenderTime:summarize(cpuSamples),noHeightExtrusions:[...buildingEntries.values()].filter(entry=>entry.height===null&&entry.segments.length>0).map(entry=>entry.object.id)};
  }
  async function measureOrbit(durationMs=2200){
    if(!controls||contextLost)return {unavailable:true,...getStats()};
    const saved=getState(),previousAutoRotate=controls.autoRotate,previousSpeed=controls.autoRotateSpeed,previousDamping=controls.enableDamping;
    setMode('3d');controls.autoRotate=true;controls.autoRotateSpeed=.65;resetMetrics();
    const start=performance.now();requestRender();
    await new Promise(resolve=>setTimeout(resolve,Math.max(500,Math.min(10000,durationMs))));
    const result={method:'Continuous requestAnimationFrame with OrbitControls.autoRotate; no pointer protocol pacing',measuredDurationMs:Math.round(performance.now()-start),...getStats()};
    controls.autoRotate=previousAutoRotate;controls.autoRotateSpeed=previousSpeed;
    if(!disposed){controls.enableDamping=false;controls.update();restoreState(saved);controls.enableDamping=previousDamping;}
    return result;
  }
  function inspectObject(id){
    const entry=buildingEntries.get(id);if(!entry)return null;
    const box=new THREE.Box3().setFromObject(entry.group);
    return {id,floorPlateCount:floorPlateEntries.get(id)?.floors.size||0,floorPlatesVisible:showingPlates()&&id===state.selectedId,heightM:entry.height,conflictIds:conflictsFor(id).map(conflict=>conflict.id),visualStatus:entry.visualStatus || 'default',bounds:{min:box.min.toArray(),max:box.max.toArray()},segments:entry.segments.map(segment=>({id:segment.id,base:segment.base,height:segment.height,visible:segment.group.visible,positionY:segment.group.position.y})),pickableCount:pickables.filter(mesh=>mesh.userData.objectId===id).length};
  }
  function resetMetrics(){frameSamples.length=0;cpuSamples.length=0;previousFrameTime=0;}
  function setPresentation(mode){
    if(!['block','building','exploded','elevation','section'].includes(mode)||state.presentation===mode)return;
    if(state.presentation==='block'&&mode!=='block')blockViewState=getState();
    if(mode==='block'){
      state.presentation='block';container.classList.remove('bm-building-view');resize();const fitText=container.querySelector('[data-action="fit"] span');if(fitText)fitText.textContent='Fit block';
      if(blockViewState){const saved=blockViewState;blockViewState=null;restoreState(saved);}else{state.explode=false;state.section=false;setMode('3d');updateScene();fit();}
      return;
    }
    state.presentation=mode;container.classList.add('bm-building-view');resize();const fitText=container.querySelector('[data-action="fit"] span');if(fitText)fitText.textContent='Fit building';
    const changedFloor=state.floor!=='all';state.floor='all';state.space='none';state.floorPlates=mode==='exploded';state.explode=mode==='exploded'&&(buildingEntries.get(state.selectedId)?.segments.length||0)>1;
    state.section=mode==='section'&&Number.isFinite(geometryFor(selected())?.heightM)&&Number.isFinite(geometryFor(selected())?.baseElevationM);
    const g=geometryFor(selected());state.sectionHeight=(g?.baseElevationM??0)+(g?.heightM??0)*.6;
    setMode(mode==='elevation'?'2d':'3d');updateScene();focusSelected();renderInspector();if(changedFloor)onFloorSelect?.('all');
    if(mode==='section'&&!state.section){live('Base elevation or height unavailable. Benchmark section elevations cannot be measured.');return;}
    live(mode==='exploded'&&!state.explode?'No separate placed floor geometry is available.':`${mode==='elevation'?'Orthographic elevation':mode==='section'?'Horizontal section at named benchmark':mode==='exploded'?'Exploded supplied floors':'Selected building'} view.`);
  }
  function getState() {
    return {...state,layers:{...state.layers},camera:{position:camera.position.toArray(),target:(controls?.target || center).toArray(),zoom:camera.zoom,orthoHalfHeight,perspectiveOffset:controlsState.cameraOffset.toArray()}};
  }
  function restoreState(saved) {
    if(!saved||typeof saved!=='object')return;
    state.presentation=['block','building','exploded','elevation','section'].includes(saved.presentation)?saved.presentation:'block';container.classList.toggle('bm-building-view',state.presentation!=='block');
    if(buildingEntries.has(saved.selectedId))select(saved.selectedId,false);
    state.activeConflictId=conflictsFor(state.selectedId).some(conflict=>conflict.id===saved.activeConflictId)?saved.activeConflictId:null;
    const allowedFloors=floorsFor(state.selectedId).map(f=>f.id);
    state.floor=allowedFloors.includes(saved.floor)?saved.floor:'all';
    state.space=relationsFrom(state.floor,'contains').some(o=>o.id===saved.space)?saved.space:'none';
    state.floorMode='below';
    state.section=false;
    for(const key of ['explode','underground','floorPlates'])if(typeof saved[key]==='boolean')state[key]=saved[key];
    const hasHeight=Number.isFinite(geometryFor(selected())?.heightM);
    if(!hasHeight||!Number.isFinite(geometryFor(selected())?.baseElevationM))state.section=false;
    if(!allowedFloors.length)state.explode=false;
    if(Number.isFinite(saved.sectionHeight)){const g=geometryFor(selected()),lower=Math.min(g?.baseElevationM??0,...floorsFor(state.selectedId).map(f=>geometryFor(f)?.baseElevationM??0)),upper=(g?.baseElevationM??0)+(g?.heightM??0);state.sectionHeight=THREE.MathUtils.clamp(saved.sectionHeight,lower,Math.max(lower,upper));}
    Object.keys(state.layers).forEach(key=>{if(typeof saved.layers?.[key]==='boolean')state.layers[key]=saved.layers[key];const input=container.querySelector(`[data-layer="${key}"]`);if(input)input.checked=state.layers[key];});
    setMode(saved.mode==='2d'?'2d':'3d');
    setNavigation(saved.navigation||'pan');
    const validVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
    if(Number.isFinite(saved.camera?.orthoHalfHeight)){orthoHalfHeight=THREE.MathUtils.clamp(saved.camera.orthoHalfHeight,1,5000);updatePlanFrustum();}
    if(Number.isFinite(saved.camera?.zoom)){camera.zoom=THREE.MathUtils.clamp(saved.camera.zoom,.3,15);camera.updateProjectionMatrix();}
    if(validVector(saved.camera?.perspectiveOffset))controlsState.cameraOffset.fromArray(saved.camera.perspectiveOffset);
    if(validVector(saved.camera?.position)&&validVector(saved.camera?.target)){
      camera.position.fromArray(saved.camera.position);if(controls){controls.target.fromArray(saved.camera.target);controls.update();}else camera.lookAt(new THREE.Vector3().fromArray(saved.camera.target));
    }
    state.inspectorTab=['overview','floors','sources'].includes(saved.inspectorTab)?saved.inspectorTab:'overview';state.labels=saved.labels!==false;container.querySelectorAll('[data-action="labels"]').forEach(button=>button.setAttribute('aria-pressed',String(state.labels)));setRailTab(saved.railTab||'layers');
    state.sourceModelOverlay=saved.sourceModelOverlay===true;setSourceView(saved.sourceView||'model',{restore:true});
    setInspectorOpen(saved.inspectorOpen!==false);renderInspector();renderFindings();renderMinimap();updateScene();
  }
  return { select, setSourceView, setMode, fit, focusSelected, setFloor, setLayer, setRailTab, setInspectorOpen, setRailOpen, setPresentation, getState, getStats, inspectObject, resetMetrics, measureOrbit, restoreState, dispose(){disposed=true;cancelAnimationFrame(frameId);cleanups.forEach(fn=>fn());controls?.dispose();architecture.dispose?.();environment.dispose?.();const materials=new Set(),textures=new Set();scene.traverse(obj=>{obj.geometry?.dispose();(Array.isArray(obj.material)?obj.material:obj.material?[obj.material]:[]).forEach(mat=>{materials.add(mat);if(mat.map)textures.add(mat.map);});});materials.forEach(mat=>mat.dispose());textures.forEach(texture=>texture.dispose());sun.shadow.dispose?.();renderer?.dispose();container.innerHTML='';container.classList.remove('bm-root','bm-inspector-closed','bm-rail-open','bm-building-view','bm-source-view','bm-survey-active');} };
}
