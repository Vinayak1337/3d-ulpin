import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DocumentProposalPacketSchema } from '../../../../contracts/src/usp/document-proposals';
import { storeyPartsHash, STOREY_AGENT_METHOD, type StoreyAgentResult } from './document-storey-agent';
import { storeyDocumentProposals, type StoreyProposalContext } from './storey-document-proposals';

const candidate = JSON.parse(readFileSync(
  'docs/evidence/gf-ai/storeys/a5/candidates/haryana-2831-tower3.json', 'utf8',
)).packet;
const control = JSON.parse(readFileSync('docs/evidence/gf-ai/documents/d2/control-output.json', 'utf8'));
const context: StoreyProposalContext = {
  source: candidate.declaredOrigin, recordingKind: 'control',
  parts: [
    { partId: 'p1-l56', page: 1, text: candidate.proposals[0].lineQuote },
    { partId: 'p1-l88', page: 1, text: candidate.proposals[5].lineQuote },
  ],
  locators: { 'p1-l56': candidate.proposals[0].locator, 'p1-l88': candidate.proposals[5].locator },
};
function result(output = control): StoreyAgentResult {
  return { state: 'candidate', output, partsHash: storeyPartsHash(context.parts),
    attempts: 1, replayed: true, method: STOREY_AGENT_METHOD };
}

test('cited Tower 3 facts retain literal, parsed fields, all citations, null counts and control method', () => {
  const output = structuredClone(control);
  output.floorExpressions[0].citations.push({ partId: 'p1-l88', quote: 'G+42' });
  const adapted = storeyDocumentProposals(result(output), context);
  assert(adapted.packet);
  assert.equal(adapted.packet.proposals.length, 2, 'One proposal per fact, not one per citation.');
  assert.equal(adapted.packet.proposals[0].agentCitations?.length, 2);
  assert.equal(adapted.packet.proposals[0].valueLiteral, 'G+42');
  assert.deepEqual(adapted.packet.proposals[0].agentFact,
    { kind: 'floorExpression', expression: 'G+42', scope: null });
  assert.equal(adapted.packet.proposals[1].agentFact?.kind, 'floorLabel');
  assert(adapted.packet.proposals.every((entry) => entry.declaredMethod === 'recorded_software_control'));
  assert(adapted.packet.proposals.every((entry) => entry.status === 'needs_review'));
  assert(adapted.packet.unknowns.includes('storeyCount.value: unknown'));
  assert.deepEqual(adapted.packet.conflicts, []);
});

test('provider provenance follows recording kind, never the replayed flag', () => {
  const adapted = storeyDocumentProposals(result(), { ...context, recordingKind: 'sarvam' });
  assert(adapted.packet?.proposals.every((entry) => entry.declaredMethod === STOREY_AGENT_METHOD));
  assert.throws(() => storeyDocumentProposals({ ...result(), replayed: false }, context),
    /Software-control provenance requires an explicit replay/);
});

test('uncited fact is rejected with its typed value and a null locator, including an all-uncited packet', () => {
  const output = structuredClone(control);
  output.floorExpressions[0].citations = [];
  output.labels[0].citations = [];
  const adapted = storeyDocumentProposals(result(output), context);
  assert(adapted.packet);
  assert(DocumentProposalPacketSchema.safeParse(adapted.packet).success);
  assert.equal(adapted.packet.proposals.length, 0);
  assert.equal(adapted.packet.rejected.length, 2);
  assert(adapted.packet.rejected.every((entry) => entry.locator === null && entry.reason === 'missing_citation'));
  assert.equal(adapted.packet.rejected[0].agentFact?.kind, 'floorExpression');
});

test('unavailable teacher and fact-free abstention produce no packet', () => {
  const missing = storeyDocumentProposals({ ...result(), state: 'teacher_unavailable', output: null,
    code: 'TEACHER_UNAVAILABLE' }, context);
  assert.equal(missing.packet, null);
  assert.equal(missing.state, 'teacher_unavailable');
  assert.equal(missing.code, 'TEACHER_UNAVAILABLE');
  const output = { ...control, floorExpressions: [], labels: [], abstain: true, abstainReason: 'No stated facts.' };
  const abstain = storeyDocumentProposals({ ...result(output), state: 'abstained' }, context);
  assert.equal(abstain.packet, null);
  assert(abstain.unknowns.includes('No stated facts.'));
});

test('protocol conflict preserves both unresolved handles; this is not Tower 3 document evidence', () => {
  // Existing storey-agent test alternatives are protocol controls, not observations of this public document.
  const output = structuredClone(control);
  output.floorExpressions.push({ expression: 'G+41', scope: null, citations: [{ partId: 'p1-l88', quote: 'G+41' }] });
  output.conflicts = [{ field: 'storeyCount', expressions: ['G+41', 'G+42'], citations: [] }];
  const packet = storeyDocumentProposals(result(output), context).packet!;
  assert.deepEqual(packet.conflicts[0].proposalIds, ['expression-1', 'expression-0']);
  assert.equal(packet.conflicts[0].state, 'unresolved');
  assert.equal(packet.proposals.length, 3);
  output.floorExpressions[1].citations = [];
  const incomplete = storeyDocumentProposals(result(output), context).packet!;
  assert.equal(incomplete.rejected[0].locator, null);
  assert.deepEqual(incomplete.conflicts[0].proposalIds, ['expression-1', 'expression-0']);
  output.floorExpressions.pop();
  assert.throws(() => storeyDocumentProposals(result(output), context), /lacks two represented alternatives/);
});

test('unsent or omitted citations and a changed parts hash cannot be adapted as a valid agent result', () => {
  const output = structuredClone(control);
  output.labels[0].citations[0].partId = 'omitted';
  assert.throws(() => storeyDocumentProposals(result(output), context), /exact validated result/);
  assert.throws(() => storeyDocumentProposals({ ...result(), partsHash: 'f'.repeat(64) }, context),
    /exact validated result/);
});
