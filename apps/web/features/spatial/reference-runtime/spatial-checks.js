import polygonClipping from './vendor/polygon-clipping.js';

// Preview topology on canonical metre-frame polygons; no legal or survey inference.
export const SPATIAL_CODES = new Set(['BUILDING_OVERLAP', 'ROAD_OVERLAP', 'OUTSIDE_PARCEL']);
const AREA_EPSILON = 0.000001;
const HEIGHT_EPSILON = 0.001;
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function multiPolygonArea(polygons) {
  const ringArea = ring => {
    const [ox, oy] = ring[0];
    let twice = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      twice += (a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy);
    }
    return Math.abs(twice) / 2;
  };
  return polygons.reduce((sum, polygon) => sum + Math.max(0,
    ringArea(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0)), 0);
}

function polygonOf(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) return null;
  let points = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 3) return null;
      for (const point of ring) {
        if (!Array.isArray(point) || !finite(point[0]) || !finite(point[1])) return null;
        points++;
      }
    }
  }
  return points <= 20000 ? polygons : null;
}
function bounds(polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}
const bboxOverlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const verticalRange = g => finite(g.baseElevationM) && finite(g.heightM) && g.heightM > 0
  ? [g.baseElevationM, g.baseElevationM + g.heightM] : null;

export function deriveSpatialChecks(data) {
  const objects = data.objects || [], geometries = new Map((data.geometries || []).map(g => [g.id, g]));
  const frames = new Map((data.frames || []).map(f => [f.id, f]));
  const originalIssues = (data.issues || []).filter(issue => issue.origin !== 'spatial-preview' && !SPATIAL_CODES.has(issue.code));
  const issues = [], skipped = [], entries = new Map();
  const report = {engine: 'polygon-clipping@0.15.7', status: 'complete', buildingCount: objects.filter(o => o.type === 'building').length,
    areaToleranceM2: AREA_EPSILON, verticalToleranceM: HEIGHT_EPSILON, checkedPairs: 0, skipped,
    scope: 'Polygon footprints and vertical extrusions in one named metre frame. Geometry review only; not a legal finding.'};
  if (report.buildingCount > 100) {
    report.status = 'not_run'; skipped.push({reason: 'Preview limited to 100 buildings; use the batch topology pipeline.'});
    return {...data, issues: originalIssues, spatialCheckReport: report};
  }
  for (const object of objects) {
    if (!['building', 'parcel', 'road'].includes(object.type)) continue;
    const geometry = geometries.get(object.geometryId), frame = geometry && frames.get(geometry.frameId);
    const polygons = geometry && polygonOf(geometry);
    if (!polygons || !frame || frame.horizontalUnit !== 'metre' || frame.kind !== 'local_cartesian') {
      skipped.push({objectId: object.id, reason: 'Requires bounded Polygon/MultiPolygon geometry in a named local metre frame. Road centerlines need an explicit surveyed corridor polygon.'});
      continue;
    }
    entries.set(object.id, {object, geometry, polygons, bounds: bounds(polygons), frame});
  }
  const compatible = (a, b) => {
    if (a.geometry.frameId === b.geometry.frameId) return true;
    skipped.push({objectIds: [a.object.id, b.object.id], reason: 'Different horizontal frames; normalize before measurement.'});
    return false;
  };
  const compute = (operation, a, b) => {
    report.checkedPairs++;
    try { return polygonClipping[operation](a.polygons, b.polygons); }
    catch (error) {
      skipped.push({objectIds: [a.object.id, b.object.id], reason: `Polygon operation failed: ${error.message}`});
      return [];
    }
  };
  function addIssue(code, a, b, intersection, verticalRelation = 'surface', height = null) {
    const area = multiPolygonArea(intersection);
    if (area <= AREA_EPSILON) return;
    const refs = [a, b].map(e => ({objectId: e.object.id, geometryId: e.geometry.id, version: e.geometry.version}));
    const title = code === 'BUILDING_OVERLAP'
      ? verticalRelation === 'overlap' ? 'Building volumes overlap' : 'Building footprints overlap — height check needed'
      : code === 'ROAD_OVERLAP' ? 'Building footprint overlaps a street corridor' : 'Building extends outside its linked parcel';
    const description = `${a.object.label || a.object.id} / ${b.object.label || b.object.id}: ${area.toFixed(2)} m² ${code === 'OUTSIDE_PARCEL' ? 'outside the linked parcel' : 'plan overlap'}. `
      + (height === null ? 'No overlap volume asserted. ' : `${(area * height).toFixed(2)} m³ overlapping footprint extrusions. `)
      + 'Review source geometry and rights evidence; this is not a legal determination.';
    issues.push({id: `spatial:${code}:${a.object.id}:${b.object.id}`, origin: 'spatial-preview', code,
      severity: code === 'BUILDING_OVERLAP' && verticalRelation === 'overlap' ? 'blocking' : 'review',
      status: 'open', objectIds: [a.object.id, b.object.id], sourceRecordIds: [...new Set([...a.geometry.sourceRecordIds || [], ...b.geometry.sourceRecordIds || []])],
      field: 'geometry', title, description, allowedActions: ['review_geometry', 'attach_evidence'], resolution: null,
      evidence: {method: 'polygon-clipping@0.15.7', frameId: a.geometry.frameId, verticalDatum: a.geometry.verticalDatum,
        computedFromGeometryIds: refs.map(r => r.geometryId), geometryRefs: refs, areaM2: area, volumeM3: height === null ? null : area * height,
        verticalRelation, overlapHeightM: height, toleranceM: HEIGHT_EPSILON, areaToleranceM2: AREA_EPSILON,
        intersectionGeometry: {type: 'MultiPolygon', coordinates: intersection},
        otherObjectId: b.object.id, relation: code === 'OUTSIDE_PARCEL' ? 'difference' : 'intersection', legalFinding: false}});
  }
  const buildings = [...entries.values()].filter(e => e.object.type === 'building');
  const roads = [...entries.values()].filter(e => e.object.type === 'road');
  for (let i = 0; i < buildings.length; i++) {
    const a = buildings[i];
    for (const b of buildings.slice(i + 1)) {
      if (!compatible(a, b) || !bboxOverlaps(a.bounds, b.bounds)) continue;
      const rangeA = verticalRange(a.geometry), rangeB = verticalRange(b.geometry);
      const knownZ = rangeA && rangeB && a.frame.verticalUnit === 'metre' && b.frame.verticalUnit === 'metre'
        && a.geometry.verticalDatum && a.geometry.verticalDatum === b.geometry.verticalDatum;
      const overlap = knownZ ? Math.min(rangeA[1], rangeB[1]) - Math.max(rangeA[0], rangeB[0]) : null;
      if (overlap !== null && overlap <= HEIGHT_EPSILON) continue;
      addIssue('BUILDING_OVERLAP', a, b, compute('intersection', a, b), knownZ ? 'overlap' : 'unknown', overlap);
    }
    const parcelIds = new Set((data.relations || [])
      .filter(r => r.toId === a.object.id && r.kind === 'contains' && entries.get(r.fromId)?.object.type === 'parcel')
      .map(r => r.fromId));
    // A source parcel reference is retained even if its relationship row has not been adapted yet.
    if (!parcelIds.size && a.object.attributes?.parcel_id) parcelIds.add(a.object.attributes.parcel_id);
    const parcels = [...parcelIds].map(id => entries.get(id)).filter(Boolean);
    if (parcels.length === 1 && compatible(a, parcels[0])) {
      addIssue('OUTSIDE_PARCEL', a, parcels[0], compute('difference', a, parcels[0]));
    } else if (parcels.length > 1) {
      skipped.push({objectId: a.object.id, reason: 'Multiple linked parcels need an explicit combined extent; individual containment not assumed.'});
    }
    for (const road of roads) if (compatible(a, road) && bboxOverlaps(a.bounds, road.bounds)) {
      addIssue('ROAD_OVERLAP', a, road, compute('intersection', a, road));
    }
  }
  if (skipped.length) report.status = 'partial';
  return {...data, issues: [...originalIssues, ...issues], spatialCheckReport: {...report, issueCount: issues.length}};
}
