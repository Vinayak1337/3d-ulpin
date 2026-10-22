import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CutExtent, featureExtent, measurableCrs, utmForward, utmInverse } from './intake-package-extent';

const named = (name: string) => ({ crs: { type: 'name', properties: { name } } });
const square = (corner: [number, number], side: number) => ({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[corner, [corner[0] + side, corner[1]], [corner[0] + side, corner[1] + side],
    [corner[0], corner[1] + side], corner]] } });

test('UTM conversion reproduces the published CN Tower grid position and inverts itself', () => {
  const latitude = 43 + 38 / 60 + 33.24 / 3600, longitude = -(79 + 23 / 60 + 13.7 / 3600);
  const [easting, northing] = utmForward(32617, longitude, latitude);
  // A grid reference truncates to the whole metre.
  assert.deepEqual([Math.trunc(easting), Math.trunc(northing)], [630084, 4833438]);
  assert.deepEqual(utmForward(32643, 75, 0), [500000, 0]);
  // On the central meridian the northing is the scaled WGS 84 meridian arc: 10001965.729 m to the pole.
  assert(Math.abs(utmForward(32631, 3, 90)[1] / 0.9996 - 10001965.729) < 0.001);
  for (const [epsg, lon, lat] of [[32643, 77.2, 28.6], [32743, 73.1, -20.4], [32644, 84.9, 81]]) {
    const [back, up] = utmInverse(epsg, ...utmForward(epsg, lon, lat));
    assert(Math.abs(back - lon) < 1e-9 && Math.abs(up - lat) < 1e-9);
  }
});

test('the declaration is read as the processor reads it; a system not converted here is not measured', () => {
  assert.deepEqual(measurableCrs({}), { kind: 'degree' });
  for (const name of ['urn:ogc:def:crs:OGC:1.3:CRS84', 'OGC:CRS84', 'EPSG:4326', 'urn:ogc:def:crs:EPSG::4326'])
    assert.deepEqual(measurableCrs(named(name)), { kind: 'degree' });
  assert.deepEqual(measurableCrs(named('EPSG:32643')), { kind: 'utm', epsg: 32643 });
  assert.deepEqual(measurableCrs(named('urn:ogc:def:crs:EPSG::3857')), { kind: 'web_mercator' });
  assert.equal(measurableCrs(named('EPSG:7755')), null);
  assert.equal(measurableCrs({ crs: { type: 'link', properties: { href: 'x' } } }), null);
});

test('a file written in UTM metres is measured as its longitude and latitude are', () => {
  const degrees = square([77, 28], 0.4);
  const ring = degrees.geometry.coordinates[0].map(([lon, lat]) => utmForward(32643, lon, lat));
  const metres = { ...degrees, geometry: { type: 'Polygon', coordinates: [ring] } };
  const fromDegrees = featureExtent(degrees, measurableCrs({})!)!;
  const fromMetres = featureExtent(metres, measurableCrs(named('EPSG:32643'))!)!;
  fromDegrees.bounds.forEach((value, index) => assert(Math.abs(value - fromMetres.bounds[index]) < 1e-9));
  assert(new CutExtent(null).admit(fromMetres));
  const wider = square([77, 28], 0.6);
  assert.equal(new CutExtent(null).admit(featureExtent(wider, measurableCrs({})!)!), false);
});
