import { z } from 'zod';
import {
  DocumentProposalPacketSchema, type DocumentProposalPacket, type DocumentProposalAgentFact,
  type DocumentProposalLocatorSchema, DocumentProposalsSaveSchema,
} from '../../../../contracts/src/usp/document-proposals';
import { DocumentPageFrameSchema } from '../../../../contracts/src/document-pages';
import { AppError } from '../../infrastructure/errors';
import {
  STOREY_AGENT_METHOD, storeyPartsHash, validateStoreyOutput,
  type StoreyAgentResult, type StoreyOutput, type StoreyPart,
} from './document-storey-agent';

export const StoreyProposalPageStoreSchema = z.object({
  schemaVersion: z.literal('storey-pages/1'),
  source: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() }),
  pages: z.record(z.string().regex(/^[1-9]\d*$/), z.object({
    width: z.number().positive(), height: z.number().positive(),
    lines: z.array(z.object({ id: z.string().min(1), text: z.string().max(4096),
      box: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional() })).max(10000),
  })),
});
export const StoreyReplayRequestSchema = DocumentProposalsSaveSchema.omit({ packet: true }).extend({
  caseId: z.uuid(), sourceId: z.uuid(), batch: z.number().int().min(0).max(31),
  frames: z.record(z.string().regex(/^[1-9]\d*$/), DocumentPageFrameSchema),
});
export type StoreyProposalPageStore = z.output<typeof StoreyProposalPageStoreSchema>;
export type StoreyReplayRequest = z.output<typeof StoreyReplayRequestSchema>;

type Citation = { partId: string; quote: string };
type Fact = { id: string; value: DocumentProposalAgentFact; citations: Citation[] };
export type StoreyProposalContext = {
  parts: StoreyPart[];
  locators: Record<string, z.output<typeof DocumentProposalLocatorSchema>>;
  source: { sha256: string; bytes: number };
  recordingKind?: 'sarvam' | 'control';
};
export type StoreyProposalResult = {
  state: StoreyAgentResult['state'];
  packet: DocumentProposalPacket | null;
  code?: string;
  unknowns: string[];
};

function factsOf(output: StoreyOutput): Fact[] {
  const facts: Fact[] = [];
  for (const kind of ['storeyCount', 'basementCount'] as const) {
    const item = output[kind];
    if (item.value !== null || item.expression !== null) {
      facts.push({ id: kind, value: { kind, value: item.value, expression: item.expression },
        citations: item.citations });
    }
  }
  output.floorExpressions.forEach(({ citations, ...item }, index) => {
    facts.push({ id: `expression-${index}`, value: { kind: 'floorExpression', ...item }, citations });
  });
  output.labels.forEach(({ citations, label, kind }, index) => {
    facts.push({ id: `label-${index}`, value: { kind: 'floorLabel', label, labelKind: kind }, citations });
  });
  output.heights.forEach(({ citations, ...item }, index) => {
    facts.push({ id: `height-${index}`, value: { kind: 'height', ...item }, citations });
  });
  output.unitCounts.forEach(({ citations, ...item }, index) => {
    facts.push({ id: `units-${index}`, value: { kind: 'unitCount', ...item }, citations });
  });
  return facts;
}

function literalOf(value: DocumentProposalAgentFact): string {
  switch (value.kind) {
    case 'floorExpression': return value.expression;
    case 'floorLabel': return value.label;
    case 'height': return `${value.statedValue} ${value.statedUnit}`;
    case 'unitCount': return String(value.value);
    default: return [value.value, value.expression].filter((item) => item !== null).join(' ');
  }
}

function unknownsOf(output: StoreyOutput): string[] {
  const unknowns: string[] = [];
  for (const kind of ['storeyCount', 'basementCount'] as const) {
    if (output[kind].value === null) unknowns.push(`${kind}.value: unknown`);
    if (output[kind].expression === null) unknowns.push(`${kind}.expression: unknown`);
  }
  for (const kind of ['floorExpressions', 'labels', 'heights', 'unitCounts'] as const) {
    if (!output[kind].length) unknowns.push(`${kind}: not stated by the agent`);
  }
  if (output.abstainReason) unknowns.push(output.abstainReason);
  return unknowns;
}

function citationsOf(fact: Fact, context: StoreyProposalContext) {
  return fact.citations.map((citation) => ({ ...citation, locator: context.locators[citation.partId] ?? null }));
}

function rejection(fact: Fact, method: string, reason: string, context: StoreyProposalContext) {
  return {
    entryId: fact.id, agentFact: fact.value, agentCitations: citationsOf(fact, context),
    lineQuote: null, locator: null, reason, declaredMethod: method, declaredObservation: null,
  };
}

function proposal(fact: Fact, citation: Citation, id: string, method: string, context: StoreyProposalContext) {
  const part = context.parts.find((entry) => entry.partId === citation.partId);
  const locator = context.locators[citation.partId];
  if (!part || !locator || part.page !== locator.page) return null;
  return {
    proposalId: id, fieldRole: fact.value.kind, agentFact: fact.value, agentCitations: citationsOf(fact, context),
    valueLiteral: literalOf(fact.value),
    quote: citation.quote, lineQuote: part.text, quoteCharacterSpan: null, status: 'needs_review' as const,
    reasons: ['agent_candidate_requires_officer_review'], locator, declaredMethod: method, declaredObservation: null,
  };
}

function populations(facts: Fact[], method: string, context: StoreyProposalContext) {
  const proposals: DocumentProposalPacket['proposals'] = [];
  const rejected: DocumentProposalPacket['rejected'] = [];
  for (const fact of facts) {
    const citation = fact.citations[0];
    if (!citation) {
      rejected.push(rejection(fact, method, 'missing_citation', context));
      continue;
    }
    const entry = proposal(fact, citation, fact.id, method, context);
    if (entry) proposals.push(entry);
    else rejected.push(rejection(fact, method, 'citation_locator_unavailable', context));
  }
  return { proposals, rejected };
}

function conflictMatches(field: StoreyOutput['conflicts'][number]['field'], value: DocumentProposalAgentFact) {
  if (field === 'unitCount') return value.kind === 'unitCount';
  return value.kind === field || value.kind === 'floorExpression';
}

function factStates(value: DocumentProposalAgentFact, expression: string) {
  if ('expression' in value && value.expression === expression) return true;
  return 'value' in value && value.value !== null && String(value.value) === expression;
}

function packetConflicts(output: StoreyOutput, packet: ReturnType<typeof populations>) {
  const references = [
    ...packet.proposals.map((entry) => ({ id: entry.proposalId, value: entry.agentFact })),
    ...packet.rejected.map((entry) => ({ id: entry.entryId, value: entry.agentFact })),
  ];
  return output.conflicts.map((conflict) => {
    const groups = conflict.expressions.map((expression) => references.filter((entry) =>
      entry.value && conflictMatches(conflict.field, entry.value) && factStates(entry.value, expression)));
    const ids = [...new Set(groups.flatMap((group) => group.map((entry) => entry.id)))];
    if (new Set(conflict.expressions).size < 2 || groups.some((group) => !group.length) || ids.length < 2) {
      throw new AppError(422, 'STOREY_CONFLICT_NOT_REPRESENTED',
        'The reported conflict lacks two represented alternatives; no packet was saved or winner selected.');
    }
    return { proposalIds: ids, reason: `${conflict.field}: ${conflict.expressions.join(' versus ')}`,
      state: 'unresolved' as const };
  });
}

/** Kept in the AI lane: maps agent semantics to the existing source-scoped review contract, never registry values. */
export function storeyDocumentProposals(
  result: StoreyAgentResult, context: StoreyProposalContext,
): StoreyProposalResult {
  if (result.state === 'teacher_unavailable') {
    return { state: result.state, packet: null, code: result.code, unknowns: [] };
  }
  if (!context.recordingKind) throw new AppError(422, 'STOREY_RECORDING_KIND_REQUIRED', 'Recording kind is required.');
  const validated = validateStoreyOutput(result.output, context.parts);
  if (result.partsHash !== storeyPartsHash(context.parts) || !validated.success) {
    throw new AppError(422, 'STOREY_PROPOSAL_INPUT', 'Use the exact validated result and parts sent to the agent.');
  }
  if (context.recordingKind === 'control' && !result.replayed) {
    throw new AppError(422, 'STOREY_CONTROL_NOT_REPLAYED', 'Software-control provenance requires an explicit replay.');
  }
  const output = validated.output;
  const unknowns = unknownsOf(output);
  if (result.state === 'abstained') return { state: result.state, packet: null, unknowns };
  const method = context.recordingKind === 'control' ? 'recorded_software_control' : STOREY_AGENT_METHOD;
  const population = populations(factsOf(output), method, context);
  if (!population.proposals.length && !population.rejected.length) {
    return { state: 'abstained', packet: null, code: 'STOREY_NO_FACTS', unknowns };
  }
  const packet = DocumentProposalPacketSchema.parse({ declaredOrigin: context.source, ...population,
    conflicts: packetConflicts(output, population), unknowns });
  return { state: result.state, packet, unknowns };
}
