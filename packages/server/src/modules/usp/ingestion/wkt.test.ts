import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateText, geometryJson, parseWkt } from './wkt';

test('a coordinate cell is read as written: a decimal keeps its text, other spellings keep their value', () => {
  assert.equal(coordinateText('77.59460000'), '77.59460000');
  assert.equal(coordinateText(' -12.5e2 '), '-12.5e2');
  assert.equal(coordinateText('+77.5'), '77.5');
  assert.equal(coordinateText('.5'), '0.5');
  for (const cell of ['', ' ', '77,5', '12.5 N', 'NaN', 'Infinity', '1e999', '0x10', '7 7']) {
    assert.equal(coordinateText(cell), null, cell);
  }
});

test('WKT points, lines and polygons become GeoJSON geometry with the numbers as written', () => {
  assert.equal(geometryJson(parseWkt('POINT (77.5946 12.9716)') as never),
    '{"type":"Point","coordinates":[77.5946,12.9716]}');
  assert.equal(geometryJson(parseWkt('linestring(0 0, 1 1,2 0)') as never),
    '{"type":"LineString","coordinates":[[0,0],[1,1],[2,0]]}');
  assert.equal(geometryJson(parseWkt('POLYGON ((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1))') as never),
    '{"type":"Polygon","coordinates":[[[0,0],[4,0],[4,4],[0,0]],[[1,1],[2,1],[2,2],[1,1]]]}');
});

test('the Multi kinds are read, a multipoint with or without its inner brackets', () => {
  const points = '{"type":"MultiPoint","coordinates":[[1,2],[3,4]]}';
  assert.equal(geometryJson(parseWkt('MULTIPOINT ((1 2), (3 4))') as never), points);
  assert.equal(geometryJson(parseWkt('MULTIPOINT (1 2, 3 4)') as never), points);
  assert.equal(geometryJson(parseWkt('MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))') as never),
    '{"type":"MultiLineString","coordinates":[[[0,0],[1,1]],[[2,2],[3,3]]]}');
  assert.equal(geometryJson(parseWkt('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))') as never),
    '{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]],[[[5,5],[6,5],[6,6],[5,5]]]]}');
});

test('an empty geometry is told apart from text that is not WKT; other kinds and Z or M are not read', () => {
  assert.equal(parseWkt('POINT EMPTY'), 'empty');
  assert.equal(parseWkt('  '), 'empty');
  for (const text of ['POINT (1)', 'POINT (1 2 3)', 'POINT Z (1 2 3)', 'POINT M (1 2 3)', 'POINT (1 2', 'POINT (1 2) x',
    'GEOMETRYCOLLECTION (POINT (1 2))', 'SRID=4326;POINT (1 2)', 'CIRCLE (1 2)', 'POINT (a b)', 'POLYGON (0 0, 1 1)',
    'LINESTRING (1 2)', 'POINT (1,2)']) {
    assert.equal(parseWkt(text), null, text);
  }
});

test('a point names one position: a point or a multipoint member with more is not WKT, never cut to its first', () => {
  for (const text of ['POINT (1 2, 3 4)', 'MULTIPOINT ((1 2, 3 4))', 'MULTIPOINT ((1 2), (3 4, 5 6))']) {
    assert.equal(parseWkt(text), null, text);
  }
});
