import {createBlockBatches} from './block-batches.js';
import * as THREE from 'three';

/**
 * Fictional residential display assets. Coordinates and floor elevations always
 * come from the supplied records; façade openings are explicitly illustration.
 * Source rings are never simplified, replaced with boxes, or mutated.
 */
export function buildArchitecture({ buildings, geometryFor, floorsFor, clippingPlane, sceneDecoration = {}, detail = 'full' }) {
  const group = new THREE.Group();
  group.name = 'Architecture · synthetic display assets';
  const entries = new Map(), pickables = [], geometries = new Set(), materials = new Set(), textures = new Set();
  const polygonParts = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const plane = ownGeometry(new THREE.PlaneGeometry(1, 1));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(.5,.5,1,12));
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const palettes = [
    { wall: '#cbb69b', trim: '#e6e2d1', roof: '#c4c1b5', glass: '#63767a', recess: '#4c5454' },
    { wall: '#dcd8ca', trim: '#eee9da', roof: '#c7c7bd', glass: '#687c83', recess: '#4b5659' },
    { wall: '#c5b8a8', trim: '#e3d9c9', roof: '#bfb8aa', glass: '#64777a', recess: '#504d48' },
    { wall: '#aec5c3', trim: '#e2e3d8', roof: '#bcbeb4', glass: '#6a7c7c', recess: '#505957' },
    { wall: '#d4b3ab', trim: '#e5d8d0', roof: '#bcaea6', glass: '#68787b', recess: '#544f4c' },
  ];
  const plaster = surfaceTexture('plaster'), roofTexture = surfaceTexture('roof');

  function ownGeometry(value) { geometries.add(value); return value; }
  function material(color, role, entry, extra = {}) {
    const value = new THREE.MeshStandardMaterial({ color, roughness: .88, metalness: 0, side: THREE.DoubleSide, clippingPlanes: clippingPlane ? [clippingPlane] : [], ...extra });
    materials.add(value);
    entry.materials.push({ mat: value, role, baseColor: value.color.clone(), baseOpacity: value.opacity });
    return value;
  }
  function surfaceTexture(kind) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); if (!ctx) return null;
    const pixels = ctx.createImageData(256, 256); let seed = kind === 'roof' ? 6307 : 4103;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 4294967296 - .5) * (kind === 'roof' ? 23 : 12);
      const shade = Math.round(231 + noise);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    if (kind === 'roof') {
      ctx.strokeStyle = 'rgba(80,78,70,.20)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
    if (kind === 'roof') texture.repeat.set(.1, .1);
    textures.add(texture); return texture;
  }
  function shapeFor(coordinates) {
    if (!coordinates?.[0]?.length) return null;
    const shape = new THREE.Shape(coordinates[0].map(p => new THREE.Vector2(p[0], p[1])));
    coordinates.slice(1).forEach(ring => shape.holes.push(new THREE.Path(ring.map(p => new THREE.Vector2(p[0], p[1])))));
    return shape;
  }
  function ringPoints(ring) {
    if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) return ring.slice(0, -1);
    return ring;
  }
  function inRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function inPolygon(point, rings) { return inRing(point, rings[0]) && !rings.slice(1).some(ring => inRing(point, ring)); }
  function edgesFor(rings) {
    const edges = [];
    rings.forEach((closed, ringIndex) => {
      const ring = ringPoints(closed);
      ring.forEach((a, index) => {
        const b = ring[(index + 1) % ring.length], dx = b[0] - a[0], dz = a[1] - b[1], length = Math.hypot(dx, dz);
        if (length < .001) return;
        const tx = dx / length, tz = dz / length, nx = -tz, nz = tx;
        const inwardSign = inPolygon([(a[0] + b[0]) / 2 + nx * .02, (a[1] + b[1]) / 2 - nz * .02], rings) ? 1 : -1;
        edges.push({ a, b, length, tx, tz, ix: nx * inwardSign, iz: nz * inwardSign, angle: -Math.atan2(tz, tx), index, ringIndex });
      });
    });
    return edges;
  }
  function addPolygon(rings, y, mat, parent, objectId, floorId) {
    const shape = shapeFor(rings); if (!shape) return null;
    const mesh = new THREE.Mesh(ownGeometry(new THREE.ShapeGeometry(shape)), mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = y;
    mesh.receiveShadow = true; mesh.castShadow = true;
    identify(mesh, objectId, floorId); parent.add(mesh); return mesh;
  }
  function identify(mesh, objectId, floorId, decorative = false) {
    mesh.userData = { objectId, floorId, syntheticDecoration: decorative };
    pickables.push(mesh);
  }
  function outline(ring, y, parent, entry) {
    const closed = ringPoints(ring), points = [...closed, closed[0]].map(p => new THREE.Vector3(p[0], y, -p[1]));
    const mat = new THREE.LineBasicMaterial({ color: '#37765a', transparent: true, opacity: .85, clippingPlanes: clippingPlane ? [clippingPlane] : [] }); materials.add(mat);
    const line = new THREE.Line(ownGeometry(new THREE.BufferGeometry().setFromPoints(points)), mat); line.visible = false;
    parent.add(line); entry.outline.push(line);
  }
  function batches(parent, entry, floorId, mats) {
    const bins = new Map();
    function add(key, dimensions, position, angle = 0, color = null, isPlane = false) {
      if (dimensions.some(v => v <= .0001)) return;
      const binKey = key + (isPlane === 'cylinder' ? '-cylinder' : isPlane ? '-plane' : '-box');
      if (!bins.has(binKey)) bins.set(binKey, { key, isPlane, instances: [] });
      bins.get(binKey).instances.push({ dimensions, position, angle, color });
    }
    function finish() {
      for (const { key, isPlane, instances } of bins.values()) {
        const mesh = new THREE.InstancedMesh(isPlane === 'cylinder' ? cylinder : isPlane ? plane : box, mats[key], instances.length);
        instances.forEach((item, index) => {
          quaternion.setFromAxisAngle(up, item.angle);
          matrix.compose(new THREE.Vector3(...item.position), quaternion, new THREE.Vector3(...item.dimensions));
          mesh.setMatrixAt(index, matrix);
          if (item.color) mesh.setColorAt(index, new THREE.Color(item.color));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = key !== 'glass'; mesh.receiveShadow = true;
        mesh.name = `${entry.object.id}/${floorId}/${key}`;
        identify(mesh, entry.object.id, floorId, true); parent.add(mesh);
      }
    }
    return { add, finish };
  }
  function facade(batch, edge, along, y, width, height, key, depth = 0, inset = 0, color = null) {
    batch.add(key, [width, height, depth || 1], [edge.a[0] + edge.tx * along + edge.ix * inset, y, -edge.a[1] + edge.tz * along + edge.iz * inset], edge.angle, color, depth === 0);
  }
  function windowOpening(batch, edge, opening, segment, profile, random) {
    const { center, width, bottom, top, balcony, entrance } = opening;
    const height = top - bottom, mid = (top + bottom) / 2;
    const recess = balcony ? .82 : entrance ? .42 : .21;
    // All opening, jamb, rail and slab vertices lie on or inside the source wall.
    facade(batch, edge, center, mid, width, height, 'recess', .025, recess);
    const glassInset = recess - .035;
    facade(batch, edge, center, mid + (entrance ? .08 : 0), width - .15, height - .15, 'glass', .02, glassInset, random > .57 ? '#afbec0' : '#edf2ed');
    facade(batch, edge, center - width / 2 + .055, mid, .11, height, 'trim', recess, recess / 2);
    facade(batch, edge, center + width / 2 - .055, mid, .11, height, 'trim', recess, recess / 2);
    facade(batch, edge, center, bottom + .045, width, .09, 'trim', recess, recess / 2);
    facade(batch, edge, center, top - .045, width, .09, 'trim', recess, recess / 2);
    facade(batch, edge, center, mid, .065, height - .15, 'trim', .055, glassInset - .03);
    if (!entrance && !balcony) facade(batch, edge, center, mid + .08, width - .16, .042, 'trim', .045, glassInset - .025);
    if (balcony) {
      facade(batch, edge, center, bottom + .055, width, .23, 'trim', .82, .41);
      facade(batch, edge, center, bottom + .98, width, .065, 'metal', .065, .045);
      facade(batch, edge, center, bottom + .19, width, .055, 'metal', .055, .045);
      const posts = Math.max(3, Math.floor(width / .33));
      for (let i = 0; i <= posts; i++) facade(batch, edge, center - width / 2 + .06 + (width - .12) * i / posts, bottom + .57, .034, .82, 'metal', .038, .045);
      // A recessed side return makes the balcony read as a loggia, not wallpaper.
      facade(batch, edge, center - width / 2 + .17, bottom + .56, .12, 1.05, 'wall', .6, .33);
    }
    if (entrance) {
      facade(batch, edge, center, .055, width, .11, 'trim', .8, .4);
      facade(batch, edge, center + width * .2, 1.05, .04, .36, 'metal', .05, glassInset - .06);
    }
  }
  function buildFacade(entry, segment, part, profile, mats, options = {}) {
    const rings = segment.geometry.coordinates, batch = options.batch || batches(part, entry, segment.id, mats), offset = options.offset || 0;
    const edges = edgesFor(rings), topFloor = segment.isTop, basement = segment.base < (entry.geo.baseElevationM || 0) - .01;
    const wallTop = topFloor ? segment.height - .19 : segment.height;
    edges.forEach(edge => {
      const front = edge.ringIndex === 0 && (profile.frontEdges || [profile.frontEdge ?? 0]).includes(edge.index);
      let count = Math.max(0, Math.floor((edge.length - 1.1) / (front ? 3.5 : 3.65)));
      if (front && count > 2 && count % 2 === 0) count -= 1;
      if (count < 1 || wallTop < 2.4 || basement) {
        facade(batch, edge, edge.length / 2, wallTop / 2, edge.length, wallTop, 'wall'); return;
      }
      const stride = edge.length / (count + 1), openings = [];
      for (let i = 0; i < count; i++) {
        const central = i === Math.floor(count / 2), entrance = front && central && Math.abs(segment.base - (entry.geo.baseElevationM || 0)) < .05;
        const balcony = front && central && !entrance && profile.hasBalconies !== false && edge.length > 5.2;
        const width = Math.min(stride * .81, balcony ? 3.45 : entrance ? 2.3 : 1.76);
        openings.push({ center: (i + 1) * stride, width, bottom: entrance ? .08 : balcony ? .28 : .85, top: Math.min(wallTop - .38, entrance || balcony ? 2.62 : 2.34), balcony, entrance });
      }
      let cursor = 0;
      openings.forEach((opening, i) => {
        const left = opening.center - opening.width / 2, right = opening.center + opening.width / 2;
        facade(batch, edge, (cursor + left) / 2, wallTop / 2, left - cursor, wallTop, 'wall');
        facade(batch, edge, opening.center, opening.bottom / 2, opening.width, opening.bottom, 'wall');
        facade(batch, edge, opening.center, (opening.top + wallTop) / 2, opening.width, wallTop - opening.top, 'wall');
        windowOpening(batch, edge, opening, segment, profile, ((entry.seed + i * 13 + edge.index * 7) % 29) / 29);
        cursor = right;
      });
      facade(batch, edge, (cursor + edge.length) / 2, wallTop / 2, edge.length - cursor, wallTop, 'wall');
      // Flush horizontal bands retain the exact footprint rather than adding ledges.
      facade(batch, edge, edge.length / 2, wallTop - .085, edge.length, .17, 'trim');
    });
    if (options.capBottom !== false) addPolygon(rings, offset + .018, mats.roof, part, entry.object.id, segment.id);
    const roofY = topFloor ? segment.height - .18 : segment.height - .018;
    if (options.capTop !== false) addPolygon(rings, offset + roofY, mats.roof, part, entry.object.id, segment.id);
    if (topFloor) addRoof(entry, segment, profile, edges, batch, roofY);
    if (!options.batch) batch.finish();
  }
  function rectangleInside(x, y, w, d, rings, margin = .16) {
    // Sample edges as well as corners, so a courtyard or concave notch cannot be bridged.
    for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
      if (!inPolygon([x - w / 2 - margin + (w + 2 * margin) * a / 8, y - d / 2 - margin + (d + 2 * margin) * b / 8], rings)) return false;
    }
    // A small hole wholly between grid samples must also exclude this rectangle.
    if (rings.slice(1).some(ring => ring.some(p => Math.abs(p[0] - x) < w / 2 + margin && Math.abs(p[1] - y) < d / 2 + margin))) return false;
    return true;
  }
  function addRoof(entry, segment, profile, edges, batch, roofY) {
    const rings = segment.geometry.coordinates;
    const roofAllowance = sceneDecoration.architecture?.roofEquipment?.maxHeightAboveRoofM ?? sceneDecoration.architecture?.maxHeightAboveRoofM ?? 0;
    const parapetHeight = roofAllowance > 0 ? Math.min(.58, roofAllowance + .18) : .17;
    edges.forEach(edge => {
      // Shorten at corners; each parapet stays inside its polygon edge.
      facade(batch, edge, edge.length / 2, roofY + parapetHeight / 2, Math.max(.01, edge.length - .4), parapetHeight, 'trim', .24, .14);
    });
    if (roofAllowance <= .4) return;
    const ring = rings[0], xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.min(3.9, (maxX - minX) * (.22 + (entry.seed % 3) * .02)), d = Math.min(4.3, (maxY - minY) * .25);
    const locations = [[.27, .68], [.72, .7], [.32, .3], [.65, .32], [.5, .5]];
    const candidates = [...locations.slice(entry.seed % 4), ...locations.slice(0, entry.seed % 4)];
    const candidate = candidates.map(([x, y]) => [minX + (maxX - minX) * x, minY + (maxY - minY) * y]).find(([x, y]) => rectangleInside(x, y, w, d, rings));
    // Roof tanks are illustration, constrained to the supplied footprint and authored height allowance.
    if (sceneDecoration.urbanForm === 'dense_plotted' || profile.waterTank) {
      const tankDiameter = Math.min(1.35, (maxX-minX)*.17), tankHeight = Math.min(1.35,roofAllowance-.3);
      const tankPlace = candidates.map(([u,v])=>[minX+(maxX-minX)*u,minY+(maxY-minY)*v]).find(([tx,ty])=>rectangleInside(tx,ty,tankDiameter,tankDiameter,rings)&&(!candidate||Math.hypot(tx-candidate[0],ty-candidate[1])>Math.max(w,d)/2+tankDiameter));
      if(tankPlace){const [tx,ty]=tankPlace;batch.add('tank',[tankDiameter,tankHeight,tankDiameter],[tx,roofY+.13+tankHeight/2,-ty],0,null,'cylinder');batch.add('tank',[tankDiameter*.87,.1,tankDiameter*.87],[tx,roofY+.18+tankHeight,-ty],0,null,'cylinder');}
    }
    if (!candidate || profile.roofCore === false) return;
    const hasEquipment = entry.seed % 3 === 0 && roofAllowance > 1.4;
    const [x, y] = candidate, h = Math.min(1.9, roofAllowance - (hasEquipment ? .6 : .15));
    batch.add('wall', [w, h, d], [x, roofY + h / 2, -y]);
    batch.add('trim', [w, .14, d], [x, roofY + h, -y]);
    batch.add('recess', [.86, 1.42, .02], [x, roofY + .71, -y + d / 2 + .001]);
    // Only one compact piece of equipment on some roofs; no repeated rooftop clutter.
    if (hasEquipment) {
      const ax = x + w * .1, ay = y + d * .12;
      batch.add('metal', [1.1, .43, 1.25], [ax, roofY + h + .285, -ay]);
    }
    if (roofAllowance >= 1 && (entry.seed % 4 === 1 || profile.serviceEquipment)) {
      const service = candidates.map(([u, v]) => [minX + (maxX - minX) * u, minY + (maxY - minY) * v]).find(([sx, sy]) => Math.hypot(sx - x, sy - y) > 5 && rectangleInside(sx, sy, 1.7, 2.6, rings));
      if (service) {
        const [sx, sy] = service;
        batch.add('trim', [1.55, .25, 2.35], [sx, roofY + .125, -sy]);
        batch.add('metal', [1.45, .55, 1.65], [sx, roofY + .525, -sy]);
        batch.add('recess', [1.2, .045, 1.42], [sx, roofY + .81, -sy]);
        for (let slat = 0; slat < 5; slat++) batch.add('trim', [1.25, .025, .035], [sx, roofY + .84, -sy - .52 + slat * .26]);
      }
    }
  }
  function addBuilding(object) {
    const geo = geometryFor(object), polygons = polygonParts(geo);
    if (!polygons.length || polygons.some(rings => !shapeFor(rings))) return;
    const building = new THREE.Group(); building.name = object.id; building.userData.objectId = object.id; group.add(building);
    const seed = [...object.id].reduce((n, c) => n * 31 + c.charCodeAt(0), 0) >>> 0;
    const profile = { ...sceneDecoration.buildingStyles?.[object.id], ...object.attributes?.appearance };
    const palette = { ...palettes[typeof profile.palette === 'number' ? profile.palette % palettes.length : seed % palettes.length], ...(typeof profile.palette === 'object' ? profile.palette : {}), ...(profile.wallColor ? { wall: profile.wallColor } : {}) };
    const floors = floorsFor(object.id), height = Number.isFinite(geo.heightM) && geo.heightM > 0 ? geo.heightM : null, base = geo.baseElevationM || 0;
    const entry = { object, geo, group: building, floors, height, segments: [], materials: [], outline: [], seed, appearance: profile };
    entries.set(object.id, entry);
    const mats = {
      wall: material(palette.wall, 'wall', entry, { map: plaster, bumpMap: plaster, bumpScale: .018, roughness: .94 }),
      trim: material(palette.trim, 'band', entry, { map: plaster, roughness: .83, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      roof: material(palette.roof, 'roof', entry, { map: roofTexture, bumpMap: roofTexture, bumpScale: .018, roughness: .97 }),
      glass: material(palette.glass, 'window', entry, { roughness: .58, metalness: .04 }),
      recess: material(palette.recess, 'recess', entry, { roughness: 1 }),
      tank: material('#393d3b', 'equipment', entry, { roughness: .89 }),
      metal: material('#747b75', 'metal', entry, { roughness: .82, metalness: .08 }),
    };
    if (height === null) {
      const mat = material('#b6aa88', 'footprint', entry, { transparent: true, opacity: .65 });
      polygons.forEach(rings => {
        addPolygon(rings, base + .06, mat, building, object.id);
        rings.forEach(ring => outline(ring, base + .08, building, entry));
      });
    } else {
      const segments = floors.length ? floors.map((floor, index) => ({ floor, id: floor.id, index, base: geometryFor(floor)?.baseElevationM ?? base, height: geometryFor(floor)?.heightM, geometry: geometryFor(floor) })) : [{ id: object.id, index: 0, base, height, geometry: geo }];
      let valid = segments.filter(segment => Number.isFinite(segment.height) && segment.height > 0 && polygonParts(segment.geometry).length > 0);
      if (!valid.length) valid = [{ id: object.id, index: 0, base, height, geometry: geo }];
      const top = Math.max(...valid.map(segment => segment.base + segment.height));
      valid.forEach(segment => {
        const part = new THREE.Group(); part.name = segment.id; part.position.y = segment.base; building.add(part);
        part.userData = { objectId: object.id, floorId: segment.floor?.id, geometryId: segment.geometry.id };
        segment.isTop = Math.abs(segment.base + segment.height - top) < .001;
        // All disconnected parts share one canonical segment and selection identity.
        polygonParts(segment.geometry).forEach((rings, partIndex) => {
        const polygonSegment = { ...segment, geometry: { ...segment.geometry, type: 'Polygon', coordinates: rings } };
        const partProfile = { ...profile, frontEdges: partIndex === 0 ? profile.frontEdges : undefined };
        if (detail === 'massing') {
          const extrusion = ownGeometry(new THREE.ExtrudeGeometry(shapeFor(rings), { depth: segment.height, bevelEnabled: false, steps: 1 })); extrusion.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(extrusion, [mats.roof, mats.wall]); mesh.castShadow = mesh.receiveShadow = true;
          identify(mesh, object.id, segment.floor?.id); part.add(mesh);
        } else if (!segment.floor && Number.isInteger(object.attributes?.floorCount) && object.attributes.floorCount > 1) {
          // Explicit building floorCount controls visual repetition only. There is
          // still one canonical segment, no fabricated selectable floor records.
          const count = object.attributes.floorCount, rowHeight = segment.height / count;
          const batch = batches(part, entry, segment.id, mats);
          for (let row = 0; row < count; row++) {
            const offset = row * rowHeight;
            const rowBatch = { add(key, dimensions, position, ...rest) { batch.add(key, dimensions, [position[0], position[1] + offset, position[2]], ...rest); } };
            buildFacade(entry, { ...polygonSegment, base: segment.base + offset, height: rowHeight, isTop: segment.isTop && row === count - 1 }, part, partProfile, mats, { batch: rowBatch, offset, capBottom: row === 0, capTop: row === count - 1 });
          }
          batch.finish();
        } else buildFacade(entry, polygonSegment, part, partProfile, mats);
        rings.forEach(ring => outline(ring, segment.height + .025, part, entry));
        });
        entry.segments.push({ ...segment, group: part });
      });
    }
    const bounds = new THREE.Box3().setFromObject(building);
    entry.anchor = bounds.getCenter(new THREE.Vector3()); entry.anchor.y = Math.max(bounds.max.y, base + (height || 0)) + 2;
    entry.bounds = bounds;
    entry.setSelected = (active, conflict = false) => {
      entry.visualStatus = conflict ? 'conflict' : active ? 'selected' : height === null ? 'height-unresolved' : 'default';
      entry.materials.forEach(({ mat, role, baseColor }) => {
        mat.color.copy(baseColor);
        if (conflict && ['wall', 'roof', 'band'].includes(role)) mat.color.lerp(new THREE.Color('#c45140'), role === 'wall' ? .64 : role === 'roof' ? .53 : .46);
        else if (active && ['wall', 'roof', 'band', 'footprint'].includes(role)) mat.color.lerp(new THREE.Color('#639b7d'), role === 'wall' ? .38 : role === 'roof' ? .27 : .2);
      });
      entry.outline.forEach(line => { line.visible = active || conflict; line.material.color.set(conflict ? '#a43428' : '#286c48'); });
    };
    let underground = false;
    entry.setUnderground = enabled => {
      if (underground === enabled) return;
      underground = enabled;
      entry.materials.forEach(({ mat, role, baseOpacity }) => {
        mat.transparent = enabled || baseOpacity < 1;
        mat.opacity = enabled ? (role === 'window' || role === 'recess' ? .12 : .27) : baseOpacity;
        mat.depthWrite = !enabled; mat.needsUpdate = true;
      });
    };
  }
  buildings.forEach(addBuilding);
  const blockBatches=[];
  entries.forEach(entry=>{if(entry.segments.length>1&&detail!=='massing'){const batch=createBlockBatches(entry);entry.blockBatch=batch;blockBatches.push(batch);pickables.push(...batch.pickables);}});
  return {
    group, entries, pickables,
    stats: { buildings: entries.size, drawBatches: pickables.length, detail, authoredTextures: textures.size },
    dispose() { blockBatches.forEach(b=>b.dispose());group.traverse(value => { if (value.isInstancedMesh) value.dispose(); }); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); group.clear(); },
  };
}
