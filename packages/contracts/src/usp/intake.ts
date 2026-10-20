import { z } from 'zod';
import { SourcePathSchema, TabularSelectionSchema } from './ingestion';

export const INTAKE_CARD_VERSION = 'intake-card/1' as const;
export const INTAKE_PROBE_LIMITS = Object.freeze({
  headBytes: 64 * 1024, tailBytes: 64 * 1024, directoryBytes: 1024 * 1024,
  members: 2000, memberHeadBytes: 64 * 1024, expandedBytes: 7 * 1024 ** 3,
  compressionRatio: 100, nestingDepth: 2, budgetMs: 2000, columns: 256, sampleRecords: 16,
});
export const IntakeFamilySchema = z.enum([
  'vector', 'table', 'raster', 'point_cloud', 'model3d', 'document', 'image', 'archive', 'unknown',
]);
export const IntakeSizeClassSchema = z.enum(['S', 'M', 'L', 'XL']);
export const IntakeStateSchema = z.enum([
  'received', 'probed', 'planned', 'reading', 'read', 'read_to_limit', 'failed_part', 'probe_failed',
]);
export const IntakePlacementSchema = z.enum([
  'undecided', 'on_map', 'attached', 'waiting_for_anchor', 'needs_answer', 'not_understood',
]);
export const IntakeCrsStateSchema = z.enum(['stated', 'sidecar', 'absent', 'conflicting', 'not_applicable']);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const text = z.string().min(1).max(1024);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bbox = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const column = z.strictObject({
  name: text,
  inferredType: z.enum(['unknown', 'number', 'boolean', 'date', 'text', 'object', 'array', 'mixed', 'geometry']),
  sampledNonEmpty: z.number().int().nonnegative(),
});
const namedCount = z.strictObject({ name: text, count });
const fields = {
  version: z.literal(INTAKE_CARD_VERSION), family: IntakeFamilySchema, format: z.string().min(1).max(64),
  formatVersion: z.string().max(64).nullable(), detectedBy: z.enum(['bytes', 'bytes_and_name']),
  nameDisagrees: z.boolean(), depth: z.enum(['signature', 'structure']), encoding: z.string().max(64).nullable(),
  crs: z.strictObject({ state: IntakeCrsStateSchema,
    code: z.string().max(128).nullable(), sidecarSha256: hash.nullable() }),
  extent: z.strictObject({ native: bbox.nullable(), epsg4326: bbox.nullable() }),
  counts: z.strictObject({ features: count, rows: count, pages: count, members: count, points: count, bands: count }),
  geometryTypes: z.array(z.string().min(1).max(64)).max(32),
  layers: z.array(namedCount).max(INTAKE_PROBE_LIMITS.members),
  sheets: z.array(namedCount).max(INTAKE_PROBE_LIMITS.members),
  columns: z.array(column).max(INTAKE_PROBE_LIMITS.columns),
  limits: z.array(z.string().min(1).max(2000)).max(2048),
  probeBytesRead: z.number().int().nonnegative(), probeMs: z.number().finite().nonnegative(),
  drawableHint: z.boolean(), delimiter: z.enum([',', '\t', ';', '|']).nullable(),
  encrypted: z.boolean().nullable(),
  raster: z.strictObject({ width: count, height: count, tiled: z.boolean().nullable() }).nullable(),
  point: z.strictObject({ format: count, scale: z.tuple([z.number(), z.number(), z.number()]).nullable() }).nullable(),
  citations: z.array(z.strictObject({ locator: text, sha256: hash })).max(32),
};
// Child cards are shallow. Nested archives remain kept at signature depth, never recursively inflated.
export const IntakeMemberCardSchema = z.strictObject(fields);
export const IntakeMemberSchema = z.strictObject({
  name: text, sizeBytes: z.number().int().nonnegative(), compressedBytes: z.number().int().nonnegative(),
  format: z.string().max(64), family: IntakeFamilySchema, refusalCode: z.string().max(128).nullable(),
  companions: z.array(text).max(8), card: IntakeMemberCardSchema.nullable(),
});
export const IntakeCardSchema = z.strictObject({ ...fields, members: z.array(IntakeMemberSchema).max(2000) });
export const IntakeRegisterSchema = z.strictObject({ sourceId: z.string().uuid(), requestKey: z.string().uuid() });
export const IntakePinSchema = z.strictObject({ wave: z.number().int().min(1).max(4), requestKey: z.string().uuid() });
export const IntakeLargeRetrySchema = z.strictObject({ requestKey: z.string().uuid() });
export const IntakeLargeRetryResultSchema = z.strictObject({
  itemId: z.string().uuid(), jobId: z.string().uuid(),
  retry: z.number().int().positive().describe('How many officer retries this item has, this one included.'),
});
/** ZF1: a ZIP of map layers in a batch. Each GeoJSON member within these bounds is kept as its own child original. */
export const ZIP_LAYER_LIMITS = Object.freeze({ archiveBytes: 16 * 1024 * 1024, memberBytes: 16 * 1024 * 1024,
  layers: 64 });
export const IntakeArchiveRetainSchema = z.strictObject({
  requestKey: z.string().uuid(), expectedWorkspaceRevision: z.number().int().nonnegative(),
});
export const IntakeArchiveReceiptSchema = z.strictObject({
  sourceId: z.string().uuid(), sourceRevision: z.number().int().positive(), sha256: hash,
  bytes: z.number().int().positive().max(ZIP_LAYER_LIMITS.archiveBytes),
});
/** Where a child original's bytes came from: the exact archive revision, member path and directory pins. */
export const ArchiveMemberLineageSchema = z.strictObject({
  version: z.literal('zip-layer/1'), parentSourceId: z.string().uuid(),
  parentSourceRevision: z.number().int().positive(), parentSha256: hash, parentItemId: z.string().uuid(),
  memberPath: text, ordinal: z.number().int().nonnegative().max(INTAKE_PROBE_LIMITS.members),
  memberBytes: z.number().int().positive().max(ZIP_LAYER_LIMITS.memberBytes),
  compressedBytes: z.number().int().nonnegative(), crc32: z.number().int().nonnegative().max(0xffffffff),
  memberSha256: hash,
});
export type ArchiveMemberLineage = z.infer<typeof ArchiveMemberLineageSchema>;
export const IntakeItemPlanSchema = z.strictObject({
  recipeId: z.string().uuid(), recipeRevision: z.number().int().positive(),
  recipeState: z.enum(['proposed', 'approved', 'executed']),
  origin: z.enum(['memory', 'teacher', 'officer']).nullable(), packageId: z.string().uuid().nullable(),
});
export const IntakeItemSchema = z.strictObject({
  itemId: z.string().uuid(), sourceId: z.string().uuid().nullable(), caseId: z.string().uuid(),
  parentItemId: z.string().uuid().nullable(), memberPath: text.nullable(), name: text,
  family: IntakeFamilySchema, format: z.string().max(64).nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sizeClass: IntakeSizeClassSchema.nullable(), wave: z.number().int().min(1).max(4), state: IntakeStateSchema,
  placement: IntakePlacementSchema, card: IntakeCardSchema.nullable(), cardSha256: hash.nullable(),
  plan: IntakeItemPlanSchema.nullable(),
  streamedProfileJobId: z.string().uuid().nullable().describe(
    'Large GeoJSON: the streamed profile job whose sealed inventory the layout question is answered from; '
    + 'null otherwise.'),
  probeVersion: z.string().nullable(),
  partsPlanned: z.number().int().positive().nullable().describe(
    'Large GeoJSON: null while reading; raw parts while mapping; null while drafting until the final cut, '
    + 'then package cuts. Other readers retain their own planned-part count.'),
  partsDone: z.number().int().nonnegative().describe(
    'Large GeoJSON: raw parts published while reading, mapped parts while mapping, packages drafted while drafting '
    + 'and after completion. Other readers retain their own completed-part count.'),
  recordsSeen: z.number().int().nonnegative().describe(
    'Records of the file read so far; the sealed reader count stays unchanged during mapping and package drafting.'),
  limitReason: z.string().nullable(), pinnedByOfficer: z.boolean(),
  existingAreaId: z.string().uuid().nullable().optional().describe(
    'The area whose source already holds this file\'s exact bytes; present only when the item rests for that reason.'),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const IntakeManifestSchema = z.strictObject({ caseId: z.string().uuid(), items: z.array(IntakeItemSchema) });
export type IntakeCard = z.infer<typeof IntakeCardSchema>;
export type IntakeMemberCard = z.infer<typeof IntakeMemberCardSchema>;
export type IntakeMember = z.infer<typeof IntakeMemberSchema>;

export const INTAKE_TARGET_LIMITS = Object.freeze({ draftTargets: 2000, confirmationTargets: 100, page: 200 });
export const IntakeTargetReadinessSchema = z.enum([
  'preparing', 'ready', 'needs_answer', 'held', 'confirmed', 'recorded', 'carded', 'stopped',
]);
const uuid = z.string().uuid();
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const at = z.string().datetime();
const pinned = z.strictObject({ id: uuid, revision: z.number().int().nonnegative() });
export const IntakeTargetArtefactsSchema = z.strictObject({
  record: pinned.optional(),
  snapshot: z.strictObject({ id: uuid, digest: hash }).optional(),
  identity: z.string().min(1).max(256).optional(),
  plan: z.strictObject({ id: uuid, version: z.number().int().positive(), sha256: hash }).optional(),
  planConfirmation: z.strictObject({ id: uuid }).optional(),
  packet: z.strictObject({ id: uuid }).optional(),
  card: pinned.optional(),
  verification: z.literal('consistent').optional(),
});
export const IntakeTargetSchema = z.strictObject({
  targetId: uuid, caseId: uuid, anchorItemId: uuid, packageId: uuid, featureId: uuid, locator: text,
  kind: z.literal('building'), stage: z.number().int().min(1).max(8), readiness: IntakeTargetReadinessSchema,
  blockedBy: z.array(code).max(16), reason: z.string().min(1).max(2000).nullable(),
  confirmationId: uuid.nullable(),
  priorityAt: at.nullable(), artefacts: IntakeTargetArtefactsSchema, updatedAt: at,
});
const tally = z.number().int().nonnegative();
export const IntakeTargetCountsSchema = z.strictObject({ preparing: tally, ready: tally, needs_answer: tally, held: tally,
  confirmed: tally, recorded: tally, carded: tally, stopped: tally });
export const IntakeTargetQuerySchema = z.strictObject({
  readiness: IntakeTargetReadinessSchema.optional(), cursor: uuid.optional(),
});
export const IntakeRunControlSchema = z.strictObject({});
export const IntakeTargetPackageSchema = z.strictObject({
  packageId: uuid, areaId: uuid, anchorItemId: uuid, revision: z.number().int().positive(),
  state: z.enum(['RECEIVED', 'NEEDS_INPUT', 'READY_FOR_REVIEW', 'REVIEWED', 'COMMITTED']),
  reviewFingerprint: hash.nullable(), findingCounts: z.record(code, tally).nullable(),
  reviewRefusal: z.strictObject({ code, message: z.string().min(1).max(2000) }).nullable().optional()
    .describe('Current review refusal; emitted as null before review or after it passes. Older pages may omit it.'),
  counts: IntakeTargetCountsSchema,
});
export const IntakeTargetPageSchema = z.strictObject({
  caseId: uuid, items: z.array(IntakeTargetSchema).max(INTAKE_TARGET_LIMITS.page),
  counts: IntakeTargetCountsSchema, nextCursor: uuid.nullable(),
  packages: z.array(IntakeTargetPackageSchema).max(100), packagesTruncated: z.boolean(),
});
export const IntakeConfirmedPackageSchema = z.strictObject({
  packageId: uuid, revision: z.number().int().positive(), reviewFingerprint: hash,
});
export const IntakeConfirmSchema = z.strictObject({
  requestKey: uuid, acknowledgement: z.string().min(1).max(500)
    .refine(value => value.trim().length > 0, 'Use a non-blank acknowledgement in the officer\'s words.'),
  packages: z.array(IntakeConfirmedPackageSchema).max(100)
    .refine(rows => new Set(rows.map(row => row.packageId)).size === rows.length, 'Name each package once.')
    .describe('The packages to record. Empty only for a cards-only confirmation: its targets are recorded '
      + 'buildings with no card, of packages an earlier confirmation of this case recorded; it stores their pins '
      + 'as that confirmation named them, records nothing and cards the targets in the order listed.'),
  targets: z.array(uuid).max(INTAKE_TARGET_LIMITS.confirmationTargets)
    .refine(ids => new Set(ids).size === ids.length, 'Name each target once.'),
}).refine(input => input.packages.length > 0 || input.targets.length > 0,
  'Name at least one package to record, or at least one recorded building to card.');
export const IntakeConfirmationSchema = z.strictObject({
  confirmationId: uuid, caseId: uuid, requestKey: uuid, subject: z.string().min(1).max(256),
  acknowledgement: z.string().min(1).max(500), packages: z.array(IntakeConfirmedPackageSchema).min(1).max(100),
  targets: z.array(uuid).max(INTAKE_TARGET_LIMITS.confirmationTargets), reason: z.string().min(1).max(512),
  expiresAt: at, createdAt: at, progress: z.array(IntakeTargetSchema).max(INTAKE_TARGET_LIMITS.confirmationTargets),
  counts: z.strictObject({ recorded: tally, carded: tally, stopped: tally }),
  findingCounts: z.record(code, tally).nullable()
    .describe('Counts from the pinned package reviews; null if any exact review is no longer available.'),
});
export type IntakeTargetReadiness = z.infer<typeof IntakeTargetReadinessSchema>;
export type IntakeTargetArtefacts = z.infer<typeof IntakeTargetArtefactsSchema>;
export type IntakeTarget = z.infer<typeof IntakeTargetSchema>;
export type IntakeConfirm = z.infer<typeof IntakeConfirmSchema>;
export type IntakeConfirmation = z.infer<typeof IntakeConfirmationSchema>;

/**
 * AU4-B1: a table row or a document part of a batch, proposed as evidence for a building of the same case.
 * Exact literal keys only: no lowercasing, trimming, transliteration, punctuation stripping or number coercion.
 * Every candidate stays a candidate; coverage is null until a reader states it, and unread is never absence.
 * Nothing here records, matches or cites, and no field states a right, ownership or issuance.
 */
export const EXACT_KEY_PROFILE_VERSION = 'exact-key/1' as const;
export const INTAKE_EVIDENCE_VERSION = 'intake-evidence/1' as const;
export const INTAKE_EVIDENCE_LIMITS = Object.freeze({
  literalChars: 1024, quoteChars: 4096, tables: 16, documents: 16, page: 200, targets: 16, decisions: 100,
  sources: 100,
});
const literal = z.string().min(1).max(INTAKE_EVIDENCE_LIMITS.literalChars);
const integerLiteral = /^-?(?:0|[1-9][0-9]*)$/;
const words = (max: number) => z.string().min(1).max(max)
  .refine(value => value.trim().length > 0, 'Use non-blank words.');
const once = <T>(values: T[], key: (value: T) => string) => new Set(values.map(key)).size === values.length;
const columnIndex = z.number().int().min(0).max(INTAKE_PROBE_LIMITS.columns - 1);
const keyPath = SourcePathSchema.refine(path => path !== '/features/*/geometry', 'A key is never the geometry.');
export const IntakeKeyKindSchema = z.enum(['text', 'integer']);
export const IntakeKeyProfileInputSchema = z.strictObject({
  requestKey: uuid, version: z.literal(EXACT_KEY_PROFILE_VERSION),
  namespace: words(150).describe('The identifier namespace in the officer\'s words; never an official ULPIN.'),
  kind: IntakeKeyKindSchema,
  map: z.strictObject({ anchorItemId: uuid, sourcePath: keyPath }),
  tables: z.array(z.strictObject({ itemId: uuid, selection: TabularSelectionSchema, columnIndex }))
    .max(INTAKE_EVIDENCE_LIMITS.tables).refine(rows => once(rows, row => row.itemId), 'Name each table once.'),
  documents: z.array(uuid).max(INTAKE_EVIDENCE_LIMITS.documents)
    .refine(ids => new Set(ids).size === ids.length, 'Name each document once.'),
}).refine(input => input.tables.length + input.documents.length > 0, 'Name at least one table column or document.');
export const IntakeKeyProfileSchema = z.strictObject({
  profileId: uuid, caseId: uuid, profileSha256: hash, input: IntakeKeyProfileInputSchema,
  subject: z.string().min(1).max(256), createdAt: at,
});
export const IntakeEvidenceKeySchema = z.strictObject({
  profileId: uuid, profileSha256: hash, namespace: words(150), kind: IntakeKeyKindSchema, literal,
});
/** The map side: the literal read from the chosen field of one drafted building, with its package pins. */
export const IntakeEvidenceAnchorSchema = z.strictObject({
  targetId: uuid, anchorItemId: uuid, packageId: uuid, packageRevision: z.number().int().positive(),
  featureId: uuid, locator: text, sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hash,
  sourcePath: keyPath, literal,
});
/** One physical row of a retained table as the raw tabular job read it; the key cell is a literal as read. */
export const IntakeTableRowLocatorSchema = z.strictObject({
  kind: z.literal('table_row'), itemId: uuid, caseId: uuid, sourceId: uuid,
  sourceRevision: z.number().int().positive(), sourceSha256: hash, rawJobId: uuid, rawInputSha256: hash,
  rawResultSha256: hash, acceptedFence: z.number().int().positive(), selection: TabularSelectionSchema,
  sourceRow: z.number().int().positive(), rowSha256: hash, columnIndex, columnHeader: z.string().max(400),
  cell: z.strictObject({ state: z.literal('literal'), value: literal }),
});
/** One native text part of a retained document; the quote is an exact character span of the part's text. */
export const IntakeDocumentPartLocatorSchema = z.strictObject({
  kind: z.literal('document_part'), itemId: uuid, caseId: uuid, caseRevision: z.number().int().nonnegative(),
  sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hash, jobId: uuid,
  resultSha256: hash, inputSha256: hash, readerSha256: hash, acceptedFence: z.number().int().positive(),
  partId: uuid, partSha256: hash, page: z.number().int().positive().nullable(),
  quote: z.string().min(1).max(INTAKE_EVIDENCE_LIMITS.quoteChars),
  quoteStart: z.number().int().nonnegative(), quoteEnd: z.number().int().positive(),
}).refine(part => part.quoteEnd - part.quoteStart === part.quote.length,
  'The quote must be the exact character span it names.');
export const IntakeEvidenceLocatorSchema = z.discriminatedUnion('kind', [
  IntakeTableRowLocatorSchema, IntakeDocumentPartLocatorSchema,
]);
export const IntakeEvidenceOutcomeSchema = z.enum(['matched', 'no_match', 'several', 'conflicting']);
/** Each count is null while unknown, never 0. A closed reading states every count and leaves nothing unread. */
export const IntakeEvidenceCoverageSchema = z.strictObject({
  state: z.enum(['reading', 'partial', 'closed']), read: count, eligible: count, keyless: count,
  unread: count, failed: count,
}).refine(value => value.state !== 'closed'
  || ([value.read, value.eligible, value.keyless, value.failed].every(n => n !== null) && value.unread === 0),
'Closed coverage states every count and leaves nothing unread.');
export const IntakeEvidenceSourceSchema = z.strictObject({
  itemId: uuid, profileId: uuid, family: z.enum(['table', 'document']), jobId: uuid.nullable(),
  resultSha256: hash.nullable(), coverage: IntakeEvidenceCoverageSchema.nullable(),
}).refine(source => source.coverage?.state !== 'closed' || (source.jobId !== null && source.resultSha256 !== null),
  'Closed coverage names the job and result that read it.');
type EvidenceKey = z.infer<typeof IntakeEvidenceKeySchema>;
type EvidenceLocator = z.infer<typeof IntakeEvidenceLocatorSchema>;
function keyIssue(key: EvidenceKey, evidence: EvidenceLocator, anchors: { literal: string }[]) {
  if (key.kind === 'integer' && !integerLiteral.test(key.literal)) return 'An integer key is its digits as written.';
  const held = evidence.kind === 'table_row' ? evidence.cell.value === key.literal
    : evidence.quote.includes(key.literal);
  if (!held || anchors.some(anchor => anchor.literal !== key.literal))
    return 'Each side must hold the exact key literal as read; no normalised or invented key.';
  return null;
}
const outcomeFits = { matched: (n: number) => n === 1, no_match: (n: number) => n === 0,
  several: (n: number) => n > 1, conflicting: (n: number) => n > 0 };
export const IntakeEvidenceCandidateSchema = z.strictObject({
  version: z.literal(INTAKE_EVIDENCE_VERSION), candidateId: uuid, caseId: uuid, candidateSha256: hash,
  key: IntakeEvidenceKeySchema, evidence: IntakeEvidenceLocatorSchema, outcome: IntakeEvidenceOutcomeSchema,
  anchors: z.array(IntakeEvidenceAnchorSchema).max(INTAKE_EVIDENCE_LIMITS.targets)
    .refine(rows => once(rows, row => row.targetId), 'Name each building once.'),
  conflictGroup: uuid.nullable(), sourceCoverage: IntakeEvidenceCoverageSchema.nullable(),
  state: z.literal('candidate'), qualification: z.literal('not_assessed'), createdAt: at,
}).superRefine((candidate, ctx) => {
  const message = keyIssue(candidate.key, candidate.evidence, candidate.anchors);
  if (message) ctx.addIssue({ code: 'custom', path: ['key'], message });
  if (!outcomeFits[candidate.outcome](candidate.anchors.length))
    ctx.addIssue({ code: 'custom', path: ['anchors'], message: 'The buildings named do not fit the outcome.' });
  if ((candidate.outcome === 'conflicting') !== (candidate.conflictGroup !== null))
    ctx.addIssue({ code: 'custom', path: ['conflictGroup'], message: 'Only a conflict names its group.' });
  if (candidate.outcome === 'no_match' && candidate.sourceCoverage?.state !== 'closed')
    ctx.addIssue({ code: 'custom', path: ['sourceCoverage'], message: 'Unread coverage is never absence.' });
});
export const IntakeEvidenceQuerySchema = z.strictObject({
  outcome: IntakeEvidenceOutcomeSchema.optional(), cursor: uuid.optional(),
});
export const IntakeEvidencePageSchema = z.strictObject({
  caseId: uuid, profiles: z.array(IntakeKeyProfileSchema).max(INTAKE_EVIDENCE_LIMITS.sources),
  sources: z.array(IntakeEvidenceSourceSchema).max(INTAKE_EVIDENCE_LIMITS.sources),
  candidates: z.array(IntakeEvidenceCandidateSchema).max(INTAKE_EVIDENCE_LIMITS.page),
  counts: z.strictObject({ matched: tally, no_match: tally, several: tally, conflicting: tally })
    .describe('Stored candidates by outcome, each counted once; not a reading total (see sources).'),
  nextCursor: uuid.nullable(),
});
const sourcePin = z.strictObject({
  itemId: uuid, sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hash,
  bytes: z.number().int().nonnegative(),
});
const candidatePin = { candidateId: uuid, candidateSha256: hash };
const decision = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('accept'), ...candidatePin, targetId: uuid,
    evidence: IntakeEvidenceLocatorSchema }),
  z.strictObject({ decision: z.literal('reject'), ...candidatePin, reason: words(500) }),
]);
/** Every pin one officer confirmation of batch evidence names; nothing here authorises a right or an issuance. */
export const IntakeEvidenceConfirmSchema = z.strictObject({
  requestKey: uuid, acknowledgement: words(500), profileId: uuid, profileSha256: hash,
  included: z.array(sourcePin.extend({ jobId: uuid, resultSha256: hash, coverage: IntakeEvidenceCoverageSchema }))
    .min(1).max(INTAKE_EVIDENCE_LIMITS.sources),
  excluded: z.array(sourcePin.extend({ reason: words(500) })).max(INTAKE_EVIDENCE_LIMITS.sources),
  targets: z.array(z.strictObject({ targetId: uuid, packageId: uuid, packageRevision: z.number().int().positive(),
    reviewFingerprint: hash })).min(1).max(INTAKE_TARGET_LIMITS.confirmationTargets),
  additions: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('citations'), linkManifestSha256: hash,
      decisions: z.array(decision).min(1).max(INTAKE_EVIDENCE_LIMITS.decisions) }),
    z.strictObject({ kind: z.literal('no_additions') }),
  ]),
}).superRefine((input, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (!once([...input.included, ...input.excluded], source => source.itemId))
    issue('excluded', 'Include or exclude each source once.');
  if (input.included.some(source => source.coverage.state !== 'closed'))
    issue('included', 'Confirm only sources whose reading closed.');
  if (!once(input.targets, target => target.targetId)) issue('targets', 'Name each building once.');
  if (input.additions.kind === 'no_additions') return;
  const named = new Set(input.targets.map(target => target.targetId));
  const rows = input.additions.decisions;
  if (!once(rows, row => row.candidateId)) issue('additions', 'Decide each candidate once.');
  if (rows.some(row => row.decision === 'accept' && !named.has(row.targetId)))
    issue('additions', 'Accept a citation only for a building this confirmation names.');
});
export const IntakeEvidenceConfirmationSchema = z.strictObject({
  confirmationId: uuid, caseId: uuid, inputSha256: hash, input: IntakeEvidenceConfirmSchema,
  subject: z.string().min(1).max(256), expiresAt: at, createdAt: at,
});
export type IntakeKeyProfileInput = z.infer<typeof IntakeKeyProfileInputSchema>;
export type IntakeTableRowLocator = z.infer<typeof IntakeTableRowLocatorSchema>;
export type IntakeEvidenceCoverage = z.infer<typeof IntakeEvidenceCoverageSchema>;
export type IntakeEvidenceCandidate = z.infer<typeof IntakeEvidenceCandidateSchema>;
export type IntakeEvidenceConfirm = z.infer<typeof IntakeEvidenceConfirmSchema>;
