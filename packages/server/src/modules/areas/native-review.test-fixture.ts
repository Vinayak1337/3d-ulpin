import { readFileSync } from 'node:fs';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';

const retained = (path: string): ImportPackage => JSON.parse(readFileSync(path, 'utf8'));

/** Retained native bytes and identities; no role is supplied to pass admission. */
export function nativeReviewFixture(): ImportPackage {
  const pkg = retained('docs/evidence/gf-backend/k1/nyc-import.json');
  const feature = pkg.features[0];
  pkg.features = [feature];
  pkg.questions = pkg.questions.filter(question => question.entityId === feature.id);
  return pkg;
}

export function retainedRoofprintFixture(): ImportPackage {
  const path = 'docs/evidence/gf-backend/k2c/roofprint-draft.json';
  return JSON.parse(readFileSync(path, 'utf8')).package;
}

export function recordedNeighbourFixture(): PhysicalFeature {
  const pkg = retained('docs/evidence/gf-backend/k2/gmda-import.json');
  return { ...pkg.features[0], revision: 1 };
}
