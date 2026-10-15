import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from '../../../../apps/api/node_modules/zod/index.js';
import { areaContext, mapArea } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { intakeHttp } from '../kn2/http';

/** A bounded area display refusal is retained, not bypassed or confused with a review refusal. */
export async function readArea(id: string) {
  const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const operation = published.paths['/api/v1/areas/{areaId}/context'].get;
  const wire = operation.responses['200'].content['application/json'].schema;
  const schema = wire.$ref ? published.components.schemas[wire.$ref.split('/').at(-1)] : wire;
  assert.deepEqual(schema, z.toJSONSchema(areaContext, { target: 'openapi-3.0' }));
  const response = await fetch(`http://127.0.0.1:${process.env.API_PORT}/api/v1/areas/${id}/context`);
  const value = await response.json();
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const observedAt = new Date().toISOString();
  if (response.status === 200) {
    const recorded = areaContext.parse(value).features.filter(feature => feature.revision > 0);
    return { id, observedAt, status: 200, recordedFeatures: recorded.length,
      buildings: recorded.filter(feature => feature.kind === 'building').length,
      publicLand: recorded.filter(feature => feature.kind === 'public_land').length,
      roads: recorded.filter(feature => feature.kind === 'road').length, refusal: null };
  }
  assert.equal(response.status, 422, JSON.stringify(value));
  assert.equal(value.error.code, 'AREA_LIMIT');
  const areas = await intakeHttp('GET', '/api/v1/areas', '/api/v1/areas', z.array(mapArea));
  const area = areas.find(area => area.id === id)!;
  return { id, observedAt, status: 422, recordedFeatures: area.featureCount,
    buildings: null, publicLand: null, roads: null, refusal: value.error,
    location: 'areas.ts:229-235 loadAreaFeatures; read-only display, not review', areaSummary: area };
}
