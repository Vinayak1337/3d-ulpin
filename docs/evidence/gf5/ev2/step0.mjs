// Only GET reads. Raw records stay outside Git; the committed receipt contains counts, not sheet text.
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'E:/BhuAayam-data/task-data/ev2';
const BUILDING = 'e8777ffc-9409-4129-bacf-f680160d8795';
const API = 'http://127.0.0.1:3194/api/v1';
const reads = {};

async function read(name, suffix) {
  const path = `/buildings/${BUILDING}/${suffix}`;
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  const data = await response.json();
  reads[name] = { path, status: response.status, data };
  return data;
}

function citationsIn(value) {
  if (!value || typeof value !== 'object') return [];
  if (value.sourceId && value.sourceSha256 && value.locator) return [value];
  return Object.values(value).flatMap(citationsIn);
}

mkdirSync(OUT, { recursive: true });
const canonical = await read('canonical', 'canonical');
const register = await read('register', 'register');
const consolidated = await read('consolidated', 'register?profile=consolidated&format=json');
const citations = citationsIn(canonical);
const ids = [...new Set(citations.map((citation) => citation.sourceId))];
const agrees = (id) => {
  const sources = [register, consolidated].flatMap((record) => record.sources.filter((source) => source.id === id));
  return sources.length === 2 && sources.every((source) =>
    source.revision === sources[0].revision && source.sha256 === sources[0].sha256) &&
    citations.filter((citation) => citation.sourceId === id).every((citation) =>
      citation.sourceSha256 === sources[0].sha256);
};
const candidates = canonical.candidates.flatMap((candidate) => candidate.citations ?? []);
const summary = {
  reads: Object.fromEntries(Object.entries(reads).map(([key, value]) =>
    [key, { path: value.path, status: value.status, sources: value.data.sources?.length ?? 0 }])),
  candidateCount: canonical.candidates.length,
  candidateCitationCount: candidates.length,
  candidateCitationFields: [...new Set(candidates.flatMap(Object.keys))],
  candidateCitedSources: new Set(candidates.map((citation) => citation.sourceId)).size,
  candidatesWithRevision: candidates.filter((citation) => citation.sourceRevision !== undefined).length,
  candidatesWithPage: candidates.filter((citation) => 'page' in citation.locator).length,
  candidatesWithRegion: candidates.filter((citation) => citation.locator.kind === 'region').length,
  allBuildingCitations: citations.length,
  allBuildingCitedSources: ids.length,
  citedSourcesPinnedAndAgreeing: ids.filter(agrees).length,
  citedSourcesMissingOrDisagreeing: ids.filter((id) => !agrees(id)).length,
};
writeFileSync(`${OUT}/step0-reads.json`, JSON.stringify(reads, null, 2));
writeFileSync(`${OUT}/step0-counts.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
