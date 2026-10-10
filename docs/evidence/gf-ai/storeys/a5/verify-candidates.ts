// Contract check: every candidate file passes the existing proposal and canonical-candidate schemas.
// Usage: tsx verify-candidates.ts [candidates-directory]
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BuildingCandidateRefSchema, BuildingCitationSchema, BuildingMethodSchema,
} from '../../../../../packages/contracts/src/canonical/building';
import { DocumentProposalPacketSchema } from '../../../../../packages/contracts/src/usp/document-proposals';

type Alternative = { citations: unknown[]; method: string; verifier: { status: string } };
type Candidate = {
  kind: string; state: string; method: string; candidates: unknown[]; packet: unknown;
  storeyCount: { value: unknown; alternatives: Alternative[] };
  unitCounts: Alternative[]; labels: Alternative[];
};

function checkAlternative(alternative: Alternative): void {
  BuildingMethodSchema.parse(alternative.method);
  for (const citation of alternative.citations) BuildingCitationSchema.parse(citation);
  assert.equal(alternative.verifier.status, 'quote_at_locator');
}

function checkCandidate(candidate: Candidate): number {
  assert.equal(candidate.kind, 'storey_count');
  BuildingMethodSchema.parse(candidate.method);
  for (const reference of candidate.candidates) BuildingCandidateRefSchema.parse(reference);
  DocumentProposalPacketSchema.parse(candidate.packet);
  const alternatives = [...candidate.storeyCount.alternatives, ...candidate.unitCounts, ...candidate.labels];
  alternatives.forEach(checkAlternative);
  if (candidate.state === 'conflicting') {
    assert.equal(candidate.storeyCount.value, null);
    assert(candidate.storeyCount.alternatives.length >= 2);
  }
  return alternatives.length;
}

function main(): void {
  const directory = resolve(process.argv[2] ?? 'docs/evidence/gf-ai/storeys/a5/candidates');
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
  assert(files.length > 0, 'no candidate files');
  const checked = files.map((name) => ({
    file: name, values: checkCandidate(JSON.parse(readFileSync(join(directory, name), 'utf8')) as Candidate),
  }));
  console.log(JSON.stringify({ schema: 'storey_count candidates', checked }));
}

main();
