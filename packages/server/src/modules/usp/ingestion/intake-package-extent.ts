import { CELL_DERIVATIVE_RULE } from '@ulpin/contracts/usp';

/** The map processor's bounded-area rule, measured before a package is cut, so no cut is refused for its extent.
 * `services/geo/geo/area.py` `normalize_area` takes a package only when (line 467) its EPSG:4326 extent spans at
 * most 1 degree each way, between latitudes -80 and 84 and longitudes -180 and 180; (line 473) its middle lies in
 * the analysis zone, give or take 0.25 degree of longitude; (line 478) its extent in that zone's metres spans at
 * most MAX_EXTENT_M (line 35) each way; and (line 486) every edge lies within MAX_EXTENT_M of the area origin.
 * Zone and origin are the area's own once it has a reference, otherwise the WGS 84 UTM zone of the package's
 * middle and its south-west corner. The extent is that of every vertex converted, as shapely bounds are. */
export const AREA_NORMALIZER_EXTENT = Object.freeze({
  metres: 50_000, degrees: 1, south: -80, north: 84, zoneSlack: 0.25,
});

export const INTAKE_WIDE_GEOJSON_REASON = 'This file is read in parts because its features spread wider than one '
  + 'map area. Every feature stays a candidate and needs officer review.';

/** west, south, east, north */
export type Bounds = [number, number, number, number];
/** The retained reference of the area a package is drafted into, as `map_areas.reference` stores it. */
export type AreaFrame = { analysisCrs: string; origin: [number, number] };
export type SourceCrs = { kind: 'degree' } | { kind: 'web_mercator' } | { kind: 'utm'; epsg: number };
export type FeatureExtent = { geographic: number[]; bounds: Bounds; projected: Map<number, Bounds> };

const SEMI_MAJOR = 6378137;
const FLATTENING = 1 / 298.257223563;
const ECCENTRICITY = Math.sqrt(FLATTENING * (2 - FLATTENING));
const UTM_SCALE = 0.9996;
const UTM_FALSE_EASTING = 500000;
const UTM_SOUTH_NORTHING = 10000000;
const N = FLATTENING / (2 - FLATTENING);
const RECTIFYING = SEMI_MAJOR / (1 + N) * (1 + N ** 2 / 4 + N ** 4 / 64 + N ** 6 / 256);
const DEGREE = Math.PI / 180;

/** Krüger's series to sixth order in n, the exact transverse Mercator PROJ applies for UTM (Karney 2011). */
const ALPHA = [
  N / 2 - 2 * N ** 2 / 3 + 5 * N ** 3 / 16 + 41 * N ** 4 / 180 - 127 * N ** 5 / 288 + 7891 * N ** 6 / 37800,
  13 * N ** 2 / 48 - 3 * N ** 3 / 5 + 557 * N ** 4 / 1440 + 281 * N ** 5 / 630 - 1983433 * N ** 6 / 1935360,
  61 * N ** 3 / 240 - 103 * N ** 4 / 140 + 15061 * N ** 5 / 26880 + 167603 * N ** 6 / 181440,
  49561 * N ** 4 / 161280 - 179 * N ** 5 / 168 + 6601661 * N ** 6 / 7257600,
  34729 * N ** 5 / 80640 - 3418889 * N ** 6 / 1995840,
  212378941 * N ** 6 / 319334400,
];
const BETA = [
  N / 2 - 2 * N ** 2 / 3 + 37 * N ** 3 / 96 - N ** 4 / 360 - 81 * N ** 5 / 512 + 96199 * N ** 6 / 604800,
  N ** 2 / 48 + N ** 3 / 15 - 437 * N ** 4 / 1440 + 46 * N ** 5 / 105 - 1118711 * N ** 6 / 3870720,
  17 * N ** 3 / 480 - 37 * N ** 4 / 840 - 209 * N ** 5 / 4480 + 5569 * N ** 6 / 90720,
  4397 * N ** 4 / 161280 - 11 * N ** 5 / 504 - 830251 * N ** 6 / 7257600,
  4583 * N ** 5 / 161280 - 108847 * N ** 6 / 3991680,
  20648693 * N ** 6 / 638668800,
];
/** Conformal to geodetic latitude. */
const DELTA = [
  2 * N - 2 * N ** 2 / 3 - 2 * N ** 3 + 116 * N ** 4 / 45 + 26 * N ** 5 / 45 - 2854 * N ** 6 / 675,
  7 * N ** 2 / 3 - 8 * N ** 3 / 5 - 227 * N ** 4 / 45 + 2704 * N ** 5 / 315 + 2323 * N ** 6 / 945,
  56 * N ** 3 / 15 - 136 * N ** 4 / 35 - 1262 * N ** 5 / 105 + 73814 * N ** 6 / 2835,
  4279 * N ** 4 / 630 - 332 * N ** 5 / 35 - 399572 * N ** 6 / 14175,
  4174 * N ** 5 / 315 - 144838 * N ** 6 / 6237,
  601676 * N ** 6 / 22275,
];

const zoneOf = (epsg: number) => epsg % 100;
const southern = (epsg: number) => epsg >= 32701;
const isUtm = (epsg: number) => epsg >= 32601 && epsg <= 32660 || epsg >= 32701 && epsg <= 32760;
const centralMeridian = (epsg: number) => -183 + 6 * zoneOf(epsg);

/** WGS 84 longitude and latitude in degrees to the easting and northing of a WGS 84 UTM zone. */
export function utmForward(epsg: number, longitude: number, latitude: number): [number, number] {
  const sine = Math.sin(latitude * DEGREE), offset = (longitude - centralMeridian(epsg)) * DEGREE;
  const tangent = Math.sinh(Math.atanh(sine) - ECCENTRICITY * Math.atanh(ECCENTRICITY * sine));
  const xi = Math.atan2(tangent, Math.cos(offset));
  const eta = Math.atanh(Math.sin(offset) / Math.sqrt(1 + tangent ** 2));
  let easting = eta, northing = xi;
  for (const [index, alpha] of ALPHA.entries()) {
    const order = 2 * (index + 1);
    easting += alpha * Math.cos(order * xi) * Math.sinh(order * eta);
    northing += alpha * Math.sin(order * xi) * Math.cosh(order * eta);
  }
  return [UTM_FALSE_EASTING + UTM_SCALE * RECTIFYING * easting,
    (southern(epsg) ? UTM_SOUTH_NORTHING : 0) + UTM_SCALE * RECTIFYING * northing];
}

/** A WGS 84 UTM easting and northing to longitude and latitude in degrees. */
export function utmInverse(epsg: number, easting: number, northing: number): [number, number] {
  const xi = (northing - (southern(epsg) ? UTM_SOUTH_NORTHING : 0)) / (UTM_SCALE * RECTIFYING);
  const eta = (easting - UTM_FALSE_EASTING) / (UTM_SCALE * RECTIFYING);
  let xiPrime = xi, etaPrime = eta;
  for (const [index, beta] of BETA.entries()) {
    const order = 2 * (index + 1);
    xiPrime -= beta * Math.sin(order * xi) * Math.cosh(order * eta);
    etaPrime -= beta * Math.cos(order * xi) * Math.sinh(order * eta);
  }
  const conformal = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  let latitude = conformal;
  for (const [index, delta] of DELTA.entries()) latitude += delta * Math.sin(2 * (index + 1) * conformal);
  return [centralMeridian(epsg) + Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime)) / DEGREE, latitude / DEGREE];
}

/** EPSG:3857 to longitude and latitude, as PROJ's inverse web Mercator on the WGS 84 semi-major axis. */
function webMercatorInverse(x: number, y: number): [number, number] {
  return [x / SEMI_MAJOR / DEGREE, Math.atan(Math.sinh(y / SEMI_MAJOR)) / DEGREE];
}

const CRS84 = /^(?:urn:ogc:def:crs:OGC:(?:1\.3)?:CRS84|OGC:CRS84)$/i;
const EPSG = /^(?:EPSG:|urn:ogc:def:crs:EPSG:[0-9.]*:)([0-9]+)$/i;

/** The collection's declaration in area.py `_geojson_crs`'s 2008 named form, when this module converts it exactly:
 * none or CRS84 or EPSG:4326 (degrees), EPSG:3857 and WGS 84 UTM. Any other system is not measured here. */
export function measurableCrs(metadata: Record<string, unknown>): SourceCrs | null {
  if (!Object.hasOwn(metadata, 'crs')) return { kind: 'degree' };
  const member = metadata.crs as { type?: unknown; properties?: Record<string, unknown> } | null;
  if (!member || typeof member !== 'object' || member.type !== 'name' || Object.keys(member).length !== 2
    || !member.properties || Object.keys(member.properties).length !== 1) return null;
  const name = member.properties.name;
  if (typeof name !== 'string') return null;
  if (CRS84.test(name)) return { kind: 'degree' };
  const code = Number(EPSG.exec(name)?.[1]);
  if (code === 4326) return { kind: 'degree' };
  if (code === 3857) return { kind: 'web_mercator' };
  return isUtm(code) ? { kind: 'utm', epsg: code } : null;
}

/** An analysis reference this module projects into: WGS 84 UTM. EPSG:6933 and others are not measured here. */
export function frameZone(frame: AreaFrame | null): number | null {
  if (!frame) return null;
  const code = Number(EPSG.exec(frame.analysisCrs)?.[1]);
  return isUtm(code) ? code : null;
}

function positions(value: unknown, into: number[]) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === 'number') into.push(Number(value[0]), Number(value[1]));
  else for (const item of value) positions(item, into);
}

function geographicOf(crs: SourceCrs, x: number, y: number): [number, number] {
  if (crs.kind === 'utm') return utmInverse(crs.epsg, x, y);
  if (crs.kind === 'web_mercator') return webMercatorInverse(x, y);
  return [x, y];
}

function boundsOf(values: number[]): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 2) {
    bounds[0] = Math.min(bounds[0], values[index]);
    bounds[1] = Math.min(bounds[1], values[index + 1]);
    bounds[2] = Math.max(bounds[2], values[index]);
    bounds[3] = Math.max(bounds[3], values[index + 1]);
  }
  return bounds;
}

/** Every vertex in longitude and latitude; null when the feature has no position or one does not convert. */
export function featureExtent(feature: Record<string, unknown>, crs: SourceCrs): FeatureExtent | null {
  const native: number[] = [];
  positions((feature.geometry as { coordinates?: unknown } | null)?.coordinates, native);
  const geographic: number[] = [];
  for (let index = 0; index < native.length; index += 2)
    geographic.push(...geographicOf(crs, native[index], native[index + 1]));
  if (!geographic.length || !geographic.every(Number.isFinite)) return null;
  const projected = new Map<number, Bounds>();
  if (crs.kind === 'utm') projected.set(crs.epsg, boundsOf(native));
  return { geographic, bounds: boundsOf(geographic), projected };
}

/** Complete bounded bytes only: the same vertices, declared systems and one-area measure as package cuts. */
export function inspectGeojsonExtent(bytes: Uint8Array): { bounds: Bounds; fitsOneArea: boolean } | null {
  let collection;
  try { collection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return null; }
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)
    || !collection.features.length) return null;
  const crs = measurableCrs(collection);
  if (!crs) return null;
  let extent: FeatureExtent | null = null;
  for (const feature of collection.features) {
    if (!feature || feature.type !== 'Feature' || Object.hasOwn(feature, 'crs')) return null;
    let measured: FeatureExtent | null;
    try { measured = featureExtent(feature, crs); }
    catch { return null; }
    if (!measured) return null;
    if (!extent) {
      extent = measured;
      continue;
    }
    extent.bounds = union(extent.bounds, measured.bounds);
    for (const coordinate of measured.geographic) extent.geographic.push(coordinate);
    for (const [zone, bounds] of measured.projected)
      extent.projected.set(zone, union(extent.projected.get(zone) ?? null, bounds));
  }
  return extent ? { bounds: extent.bounds, fitsOneArea: new CutExtent(null).admit(extent) } : null;
}

/** The feature's extent in a UTM zone; a feature written in that zone keeps its own coordinates, as PROJ does. */
function projectedBounds(feature: FeatureExtent, epsg: number): Bounds {
  const known = feature.projected.get(epsg);
  if (known) return known;
  const metres: number[] = [];
  for (let index = 0; index < feature.geographic.length; index += 2)
    metres.push(...utmForward(epsg, feature.geographic[index], feature.geographic[index + 1]));
  const bounds = boundsOf(metres);
  feature.projected.set(epsg, bounds);
  return bounds;
}

function union(left: Bounds | null, right: Bounds): Bounds {
  if (!left) return right;
  return [Math.min(left[0], right[0]), Math.min(left[1], right[1]),
    Math.max(left[2], right[2]), Math.max(left[3], right[3])];
}

/** Line 467: one bounded area within UTM coverage, at most 1 degree each way. */
function withinDegrees([west, south, east, north]: Bounds): boolean {
  const rule = AREA_NORMALIZER_EXTENT;
  return -180 <= west && west <= east && east <= 180 && rule.south <= south && south <= north && north <= rule.north
    && east - west <= rule.degrees && north - south <= rule.degrees;
}

/** Lines 469-474: the area's zone, which must cover the middle, or the zone of the middle. */
function analysisZone([west, south, east, north]: Bounds, frameEpsg: number | null): number | null {
  const longitude = (west + east) / 2, latitude = (south + north) / 2;
  if (frameEpsg === null) {
    const zone = Math.min(60, Math.max(1, Math.floor((longitude + 180) / 6) + 1));
    return (latitude >= 0 ? 32600 : 32700) + zone;
  }
  const zoneWest = centralMeridian(frameEpsg) - 3, slack = AREA_NORMALIZER_EXTENT.zoneSlack;
  const [zoneSouth, zoneNorth] = southern(frameEpsg) ? [AREA_NORMALIZER_EXTENT.south, 0]
    : [0, AREA_NORMALIZER_EXTENT.north];
  const covered = zoneWest - slack <= longitude && longitude <= zoneWest + 6 + slack
    && zoneSouth <= latitude && latitude <= zoneNorth;
  return covered ? frameEpsg : null;
}

/** Lines 478 and 486: at most MAX_EXTENT_M across, every edge within it of the origin. */
function withinMetres(metres: Bounds, origin: [number, number] | null): boolean {
  const limit = AREA_NORMALIZER_EXTENT.metres, [x, y] = origin ?? [metres[0], metres[1]];
  return metres[2] - metres[0] <= limit && metres[3] - metres[1] <= limit
    && [metres[0] - x, metres[1] - y, metres[2] - x, metres[3] - y].every(edge => Math.abs(edge) <= limit);
}

export type SpatialCell = { key: string };

/** The intersection keeps every shared cell below both area bounds, even at high latitude.
 * Larger or zone-crossing features get a stable singleton, never split or moved. */
export function featureCell(feature: FeatureExtent, featureIndex: number): SpatialCell {
  const rule = CELL_DERIVATIVE_RULE;
  const zone = analysisZone(feature.bounds, null)!;
  const [west, south, east, north] = feature.bounds;
  const metres = projectedBounds(feature, zone);
  const easting = Math.floor(metres[0] / rule.metres), northing = Math.floor(metres[1] / rule.metres);
  const longitude = Math.floor((west - rule.degreeOrigin[0]) / rule.degrees);
  const latitude = Math.floor((south - rule.degreeOrigin[1]) / rule.degrees);
  const key = `utm-${zone}-e${easting}-n${northing}-l${longitude}-b${latitude}`;
  const zoneWest = centralMeridian(zone) - 3;
  const contained = west >= zoneWest && east <= zoneWest + 6
    && (southern(zone) ? north <= 0 : south >= 0);
  const shared = contained && east - west <= rule.sharedDegrees && north - south <= rule.sharedDegrees
    && metres[2] - metres[0] <= rule.sharedMetres && metres[3] - metres[1] <= rule.sharedMetres;
  return { key: shared ? key : `${key}-feature-${featureIndex}` };
}

/** One open cut's extent, as area.py would measure the package it becomes. */
export class CutExtent {
  private members: FeatureExtent[] = [];
  private geographic: Bounds | null = null;
  private zone = 0;
  private metres: Bounds | null = null;
  private readonly frameEpsg: number | null;

  constructor(private readonly frame: AreaFrame | null) {
    this.frameEpsg = frameZone(frame);
  }

  /** The cut takes the feature only when area.py would still take the whole package. */
  admit(feature: FeatureExtent): boolean {
    const geographic = union(this.geographic, feature.bounds);
    if (!withinDegrees(geographic)) return false;
    const zone = analysisZone(geographic, this.frameEpsg);
    if (zone === null) return false;
    const metres = zone === this.zone && this.metres ? union(this.metres, projectedBounds(feature, zone))
      : this.members.reduce((sum, item) => union(sum, projectedBounds(item, zone)), projectedBounds(feature, zone));
    if (!withinMetres(metres, this.frame?.origin ?? null)) return false;
    this.members.push(feature);
    this.geographic = geographic;
    this.zone = zone;
    this.metres = metres;
    return true;
  }
}
