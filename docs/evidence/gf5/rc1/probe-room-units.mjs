// RC1 Step 0: read Magnolia's room candidates from the demo (GET only) and test the unit of `polygons`.
// Run: node docs/evidence/gf5/rc1/probe-room-units.mjs > E:/BhuAayam-data/tmp-rc1/probe.json
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3194/api/v1';
const buildingId = 'e8777ffc-9409-4129-bacf-f680160d8795';
const vectorPath = 'docs/evidence/gf-ai/plans/vector/20261010-p1-panels/bihar/candidates.json';
const round = (value, places = 4) => Number(value.toFixed(places));

function ringArea(ring) {
  let twice = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    twice += x0 * y1 - x1 * y0;
  }
  return Math.abs(twice) / 2;
}

function multiPolygonArea(polygons) {
  let area = 0;
  for (const [outer, ...holes] of polygons) {
    area += ringArea(outer);
    for (const hole of holes) area -= ringArea(hole);
  }
  return area;
}

function bounds(polygons) {
  const points = polygons.flat(2);
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Map the cited PDF-point region into the plan frame: x right from origin, y up from origin. */
function citedRegionInFrame(locator, frame) {
  const scale = frame.metresPerPdfPoint;
  const [originX, originY] = frame.originPdf;
  return [(locator.x - originX) * scale, (originY - (locator.y + locator.height)) * scale,
    (locator.x + locator.width - originX) * scale, (originY - locator.y) * scale];
}

function statedDimensions(outputRef, vector) {
  const index = Number(outputRef.split('/').at(-1));
  const stated = vector.pages['2'].candidates[index].output.statedDimensions[0];
  if (!stated) return null;
  const product = stated.dimensionProductM2;
  return { literal: stated.literal, productM2: product === null ? null : round(product, 2) };
}

function probe(candidate, vector) {
  const frame = candidate.planFrame;
  const box = bounds(candidate.polygons);
  const cited = citedRegionInFrame(candidate.citations[0].locator, frame);
  const stored = multiPolygonArea(candidate.polygons);
  const scale = frame.metresPerPdfPoint;
  return {
    label: candidate.labelLiteral ?? null, level: candidate.levelLabelLiteral, outputRef: candidate.outputRef,
    rings: candidate.polygons.map(polygon => polygon.length), polygonBbox: box.map(value => round(value)),
    citedRegionPt: candidate.citations[0].locator, citedRegionMappedToFrame: cited.map(value => round(value)),
    polygonBboxEqualsMappedRegion: box.every((value, index) => Math.abs(value - cited[index]) < 1e-6),
    metresPerPdfPoint: scale, polygonAreaAsStored: round(stored, 2),
    extentAsStored: [round(box[2] - box[0], 2), round(box[3] - box[1], 2)],
    areaByWrittenRule: round(stored * scale * scale, 5),
    extentByWrittenRule: [round((box[2] - box[0]) * scale, 4), round((box[3] - box[1]) * scale, 4)],
    stated: statedDimensions(candidate.outputRef, vector),
  };
}

const vector = JSON.parse(readFileSync(vectorPath, 'utf8'));
const response = await fetch(`${base}/buildings/${buildingId}/canonical`);
const building = await response.json();
const rooms = building.candidates.filter(candidate => candidate.kind === 'room');
console.log(JSON.stringify({ status: response.status, revisionId: building.revisionId,
  rooms: rooms.map(candidate => probe(candidate, vector)) }, null, 1));
