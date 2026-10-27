import type { NormalizedBuilding, RoomPlanEstimate } from '@ulpin/contracts';

type Candidate = NormalizedBuilding['candidates'][number];
type MultiPolygon = NonNullable<Candidate['polygons']>;
type Ring = MultiPolygon[number][number];

const ESTIMATE_LIMITATIONS = [
  'The plan scale is a candidate read from the drawing, not a surveyed or stated control.',
  'The polygon is a model or vector candidate, not a reviewed room boundary.',
  'Wall thickness is not separated from the enclosed floor.',
];

function ringArea(ring: Ring): number {
  let twice = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    twice += x0 * y1 - x1 * y0;
  }
  return Math.abs(twice) / 2;
}

/** Outer rings minus their holes, summed over the multipolygon. */
function multiPolygonArea(polygons: MultiPolygon): number {
  let area = 0;
  for (const [outer, ...holes] of polygons) {
    area += ringArea(outer);
    for (const hole of holes) area -= ringArea(hole);
  }
  return area;
}

/** Width and height of the bounding box along the plan frame's own axes. */
function boundingExtent(polygons: MultiPolygon): [number, number] {
  const points = polygons.flat(2);
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

function hundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

function unknownEstimate(reason: string): RoomPlanEstimate {
  return { state: 'unknown', areaM2: null, extentM: null, basis: null, limitations: [reason] };
}

/**
 * A retained room's polygon is already in its plan's own metres (the vector reader applied `planFrame`), so
 * the area and extent are read from it as they are. Without that frame the unit is not established.
 */
export function roomPlanEstimate(candidate: Candidate): RoomPlanEstimate {
  const frame = candidate.planFrame;
  if (!frame) return unknownEstimate('No plan frame: the polygon\'s unit is not established.');
  if (!candidate.polygons?.length) return unknownEstimate('No polygon on this candidate.');
  const areaM2 = hundredths(multiPolygonArea(candidate.polygons));
  if (!(areaM2 > 0)) return unknownEstimate('The polygon encloses no area.');
  const [width, height] = boundingExtent(candidate.polygons);
  return {
    state: 'estimated',
    areaM2,
    extentM: [hundredths(width), hundredths(height)],
    basis: { method: 'polygon_area_in_plan_metres@1', scaleState: frame.scaleState,
      metresPerPdfPoint: frame.metresPerPdfPoint },
    limitations: [...ESTIMATE_LIMITATIONS],
  };
}

/** The canonical read's one writer of `planEstimate`: room candidates only; nothing else is touched. */
export function addRoomPlanEstimates(building: NormalizedBuilding): void {
  building.candidates = building.candidates.map(candidate => candidate.kind === 'room'
    ? { ...candidate, planEstimate: roomPlanEstimate(candidate) }
    : candidate);
}
