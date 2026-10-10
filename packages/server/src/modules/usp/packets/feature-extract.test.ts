import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { featurePropertiesExtract } from './feature-extract';

const originalPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const originalHash = '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e';
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

for (const [index, key] of [[0, '345'], [1620, '1272393']] as const) {
  test(`NYC original index ${index}, feature ${key}: one exact properties span; original unchanged`, () => {
    const bytes = readFileSync(originalPath);
    assert.equal(hash(bytes), originalHash);
    const text = bytes.toString('utf8');
    const expected = JSON.parse(text).features[index].properties;
    const excerpt = featurePropertiesExtract(bytes, index);
    assert.notEqual(excerpt, null);
    assert.equal(expected.doitt_id, key);
    assert.deepEqual(JSON.parse(excerpt!), expected);
    const start = text.indexOf(excerpt!);
    assert(start >= 0);
    assert.equal(text.lastIndexOf(excerpt!), start);
    assert.equal(hash(text.slice(start, start + excerpt!.length)), hash(excerpt!));
    if (index === 1620) assert.equal(expected.ground_elevation, null);
    assert.equal(hash(readFileSync(originalPath)), originalHash);
  });
}

test('out-of-range, negative and fractional indexes return null', () => {
  const bytes = readFileSync(originalPath);
  for (const index of [1662, -1, 1.5]) assert.equal(featurePropertiesExtract(bytes, index), null);
});

// Isolated syntax controls, not geographical or registry facts.
const cases: [string, string, string | null][] = [
  ['features after another large member',
    `{"metadata":"${'x'.repeat(20000)}","features":[{"properties":{"a":1}}]}`, '{"a":1}'],
  ['properties after geometry', '{"features":[{"geometry":{"coordinates":[]},"properties": { "a": 1 }}]}',
    '{ "a": 1 }'],
  ['strings with braces, brackets, escaped quote and unicode escape',
    '{"features":[{"properties":{"a":"} ] \\" \\u007d"}}]}', '{"a":"} ] \\" \\u007d"}'],
  ['nested objects and arrays inside properties', '{"features":[{"properties":{"a":[{"b":[1,null]}]}}]}',
    '{"a":[{"b":[1,null]}]}'],
  ['CRLF and tabs', '{\r\n\t"features": [ {"properties": {\r\n\t"a": 1\r\n}} ]\r\n}',
    '{\r\n\t"a": 1\r\n}'],
  ['byte-order mark', '\uFEFF{"features":[{"properties":{"a":1}}]}', '{"a":1}'],
  ['properties null', '{"features":[{"properties":null}]}', null],
  ['properties twice in one feature', '{"features":[{"properties":{},"properties":{}}]}', null],
  ['file cut in the middle of element N', '{"features":[{"properties":{"a":1},"geometry":', null],
  ['root array instead of object', '[{"features":[{"properties":{}}]}]', null],
  ['features twice at the root', '{"features":[],"features":[{"properties":{}}]}', null],
  ['absent properties', '{"features":[{"geometry":null}]}', null],
  ['non-object properties', '{"features":[{"properties":[]}]}', null],
  ['non-object feature', '{"features":[null]}', null],
  ['features is not an array', '{"features":{}}', null],
  ['escaped duplicate property name', '{"features":[{"properties":{},"\\u0070roperties":{}}]}', null],
];

for (const [name, input, expected] of cases) {
  test(name, () => assert.equal(featurePropertiesExtract(Buffer.from(input), 0), expected));
}
