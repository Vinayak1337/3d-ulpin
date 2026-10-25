import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { CityGMLResultSchema, CITYGML_LIMITS } from '../packages/contracts/src/usp/citygml-ingestion';
import { citygmlSummary } from '../packages/server/src/modules/usp/ingestion/citygml-processor';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import { CITYGML_JOURNEY_ROOT } from './citygml-journey';

const name = 'Building_and_garage_LOD2-EPSG25832.gml';
const path = `${CITYGML_JOURNEY_ROOT}/${name}`;
const present = existsSync(`${path}.native.json`) && existsSync(`${path}.journey.json`);

test('unchanged historical CityGML limits remain readable after the inventory ceiling changes', { skip: !present }, () => {
  const bytes = readFileSync(`${path}.native.json`);
  const result = CityGMLResultSchema.parse(JSON.parse(readFileSync(`${path}.journey.json`, 'utf8')).accepted);
  assert.equal(sha256(bytes), result.artifact.sha256);
  assert.deepEqual(citygmlSummary(bytes, result.input), result.summary);
  assert.equal(sha256(bytes), result.artifact.sha256, 'the historical artifact is not rewritten');

  // Profile declarations below are memory-only controls, not replacement retained artifacts.
  const native = JSON.parse(bytes.toString('utf8'));
  native.limits.input_bytes = CITYGML_LIMITS.originalBytes;
  native.limits.elements = CITYGML_LIMITS.elements;
  native.limits.coordinate_values = CITYGML_LIMITS.coordinateValues;
  assert.deepEqual(citygmlSummary(Buffer.from(JSON.stringify(native)), result.input), result.summary);
  native.limits.elements++;
  assert.throws(() => citygmlSummary(Buffer.from(JSON.stringify(native)), result.input));
});
