/** AD3 D8: bytes of the context route's answer for each retained context fixture, before and after the projection. */
import { readFileSync } from 'node:fs';
import type { AreaContext } from '@ulpin/contracts';
import { areaContextResponse } from '../../../../packages/server/src/modules/areas/area-intake-service';

const FIXTURES = [
  'apps/studio/src/local/data/nyc-bronx-context.json',
  'apps/studio/src/local/data/lake-view/context.json',
  'apps/studio/src/local/data/swiss-floor-context.json',
];
const DEMO_FEATURES = 2148;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

function measure(path: string) {
  const fixture: AreaContext = JSON.parse(readFileSync(path, 'utf8'));
  // Before AD3 the route sent the features twice: no proposals, so displayFeatures equals features.
  const before = bytes({ ...fixture, displayFeatures: fixture.features });
  const after = bytes(areaContextResponse(fixture));
  const features = fixture.features.length;
  return {
    fixture: path, features, packages: fixture.packages.length, beforeBytes: before, afterBytes: after,
    beforePerFeature: Math.round(before / features), afterPerFeature: Math.round(after / features),
  };
}

const fixtures = FIXTURES.map(measure);
const largest = fixtures[0]!;
console.log(JSON.stringify({
  fixtures,
  estimateFor2148: {
    estimate: true, features: DEMO_FEATURES,
    beforeBytes: largest.beforePerFeature * DEMO_FEATURES, afterBytes: largest.afterPerFeature * DEMO_FEATURES,
  },
}));
