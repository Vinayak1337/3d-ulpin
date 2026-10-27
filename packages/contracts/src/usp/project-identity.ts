import { z } from 'zod';
import { UspSnapshotScopeSchema } from './common';

export const P3_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const bodyPattern = /^[0-9A-HJKMNP-TV-Z]{20}$/;

export function projectCodeForPayload(payload: string): string {
  if (!bodyPattern.test(payload)) throw new Error('Invalid P3/1 payload');
  let check = 0;
  for (const symbol of `P3${payload}`) check = (33 * check + P3_ALPHABET.indexOf(symbol) + 1) % 1021;
  return `P3-${payload}-${P3_ALPHABET[Math.floor(check / 32)]}${P3_ALPHABET[check % 32]}`;
}

/** Grammar and check only; issuance and authorization require a registry lookup. */
export function normalizeProjectCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.replace(/^ *| *$/g, '').replace(/[a-z]/g, letter => letter.toUpperCase());
  const match = /^(?:P3-([0-9A-HJKMNP-TV-Z]{20})-([0-9A-HJKMNP-TV-Z]{2})|P3([0-9A-HJKMNP-TV-Z]{20})([0-9A-HJKMNP-TV-Z]{2}))$/.exec(normalized);
  if (!match) return null;
  const payload = match[1] ?? match[3];
  const actual = match[2] ?? match[4];
  const checkValue = P3_ALPHABET.indexOf(actual[0]) * 32 + P3_ALPHABET.indexOf(actual[1]);
  if (checkValue > 1020) return null;
  const expected = projectCodeForPayload(payload).slice(-2);
  let difference = 0;
  for (let i = 0; i < 2; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0 ? `P3-${payload}-${actual}` : null;
}

export const ProjectAnchorStateSchema = z.enum([
  'not_supplied', 'supplied_unreviewed', 'reviewed_partial', 'reviewed_complete', 'conflicting', 'withdrawn',
]);
const unknownState = z.strictObject({ state: z.enum(['unknown', 'absent', 'withheld', 'conflicting']) });
export const ProjectIssuerSchema = z.union([
  z.strictObject({ state: z.literal('known'), value: z.string().min(1).max(256) }), unknownState,
]);
export const ProjectValiditySchema = z.union([
  z.strictObject({ state: z.literal('known'), from: z.iso.datetime({ offset: true }).nullable(),
    to: z.iso.datetime({ offset: true }).nullable() }), unknownState,
]);
export const ProjectParcelAssociationSchema = z.strictObject({
  literalValue: z.string().min(1).max(100).refine(value => value.trim().length > 0),
  role: z.enum(['primary', 'associated']),
  source: z.strictObject({ sourceId: z.uuid(), revision: z.number().int().positive(),
    locator: z.string().min(1).max(500) }),
  issuer: ProjectIssuerSchema,
  validity: ProjectValiditySchema,
  reviewState: z.enum(['supplied_unreviewed', 'reviewed', 'disputed', 'withdrawn']),
});
export const ProjectLocatorPartsSchema = z.strictObject({
  // '?' preserves unassessed source-only structure classification; it is never an identity token.
  structureKind: z.enum(['S', 'U', 'A', '?']),
  structureNumber: z.number().int().min(1).max(99).optional().describe('Required unless structureKind is ?.'),
  levels: z.array(z.union([z.enum(['B2', 'B1', 'LG', 'UG', 'G', 'ST', 'M1', 'P1', 'T', 'R', 'L?']), z.string().regex(/^F(?:0[1-9]|[1-9][0-9])$/)])).min(1).max(2),
  // U means utility and V means volume/corridor, not unknown use.
  spaceKind: z.enum(['R', 'C', 'P', 'X', 'U', 'V', '?']),
  spaceNumber: z.number().int().min(1).max(999).optional().describe('Required unless spaceKind is ?.'),
}).superRefine((locator, ctx) => {
  if (locator.structureKind !== '?' && locator.structureNumber === undefined) {
    ctx.addIssue({ code: 'custom', path: ['structureNumber'], message: 'A known structure kind needs its number' });
  }
  if (locator.spaceKind !== '?' && locator.spaceNumber === undefined) {
    ctx.addIssue({ code: 'custom', path: ['spaceNumber'], message: 'A known space kind needs its number' });
  }
});
export const ProjectLocationSchema = z.strictObject({
  anchorState: ProjectAnchorStateSchema,
  parcels: z.array(ProjectParcelAssociationSchema).max(100),
  locator: ProjectLocatorPartsSchema,
}).superRefine((location, ctx) => {
  const states = location.parcels.map(parcel => parcel.reviewState);
  const reviewed = states.filter(state => state === 'reviewed').length;
  const primary = location.parcels.filter(parcel => parcel.reviewState === 'reviewed' && parcel.role === 'primary').length;
  const valid = primary <= 1 && (
    location.anchorState === 'not_supplied' ? states.length === 0
      : location.anchorState === 'supplied_unreviewed' ? states.length > 0 && states.every(state => state === 'supplied_unreviewed')
        : location.anchorState === 'reviewed_complete' ? reviewed > 0 && reviewed === states.length && (primary === 1 || reviewed > 1)
          : location.anchorState === 'reviewed_partial' ? reviewed > 0
            : location.anchorState === 'conflicting' ? states.includes('disputed')
              : states.length > 0 && states.every(state => state === 'withdrawn'));
  if (!valid) ctx.addIssue({ code: 'custom', path: ['anchorState'], message: 'Anchor state conflicts with parcel review states' });
});
export type ProjectLocation = z.infer<typeof ProjectLocationSchema>;

export function verticalLocator(location: ProjectLocation): string {
  const reviewed = location.parcels.filter(parcel => parcel.reviewState === 'reviewed');
  const primary = reviewed.filter(parcel => parcel.role === 'primary');
  const anchor = location.anchorState === 'reviewed_complete' && primary.length === 1
    ? primary[0].literalValue
    : ['reviewed_complete', 'reviewed_partial'].includes(location.anchorState) && reviewed.length > 1 && primary.length === 0
      ? `MULTI(${reviewed.length})` : 'NO-ANCHOR';
  const part = location.locator;
  const structure = part.structureKind
    + (part.structureNumber === undefined ? '' : String(part.structureNumber).padStart(2, '0'));
  const space = part.spaceKind + (part.spaceNumber === undefined ? '' : String(part.spaceNumber).padStart(3, '0'));
  return `${anchor} / ${structure} / ${part.levels.join('-')} / ${space}`;
}

const common = {
  scope: UspSnapshotScopeSchema,
  expectedManifestId: z.uuid(),
  reviewId: z.uuid(),
  requestKey: z.string().min(1).max(128),
};
export const ProjectIdentityReviewSchema = z.strictObject({
  operation: z.enum(['assign', 'correct', 'cancel', 'retire', 'split', 'merge', 'boundary_adjustment']),
  scope: UspSnapshotScopeSchema,
  recordIds: z.array(z.uuid()).min(1).max(100),
  predecessors: z.array(z.uuid()).max(100).optional(),
  successors: z.array(z.uuid()).max(100).optional(),
  expectedVersions: z.record(z.uuid(), z.number().int().positive()),
  reason: z.string().trim().min(1).max(2000),
  evidence: z.array(z.strictObject({ sourceId: z.uuid(), revision: z.number().int().positive(),
    locator: z.string().min(1).max(500) })).min(1).max(30),
  location: ProjectLocationSchema.optional()
    .describe('Omit for source-stated reviews; required for other assign reviews.'),
  locations: z.record(z.uuid(), ProjectLocationSchema).optional(),
  transferredGeometry: z.unknown().optional(),
});
/** Names one registry record and bounds the page of its identity reviews. */
export const UspListIdentityReviewsSchema = z.strictObject({
  recordId: z.uuid(), limit: z.number().int().min(1).max(20).default(5),
}).readonly();
const reviewOperation = ProjectIdentityReviewSchema.shape.operation;
const storedTime = z.iso.datetime({ offset: true });
/** One stored identity review as a reader is shown it: no evidence list, no location and no reviewer. */
const UspIdentityReviewItemSchema = z.strictObject({
  reviewId: z.uuid().describe('The reviewId the assignment or mutation names.'),
  operation: reviewOperation.describe('The one operation this review allows.'),
  reason: z.string().min(1).max(2000).describe('The reason as the review stores it.'),
  createdAt: storedTime.describe('When the review was stored. The list is ordered by this value, newest first.'),
  scope: UspSnapshotScopeSchema.describe('The scope the review is bound to, as its stored command states it: '
    + 'the scope to pass unchanged to the assignment.'),
  expectedManifestId: z.uuid().describe('The expectedManifestId the assignment must name: the manifest of scope.'),
  expectedRecordVersion: z.number().int().positive().describe('The revision of this record the review was made '
    + 'at, read from the expectedVersions of its stored command: the expectedRecordVersion the assignment must name.'),
  used: z.strictObject({
    at: storedTime.describe('When the review was consumed.'),
    operation: reviewOperation.describe('The operation the audit row of the consuming command records.'),
  }).readonly().nullable().describe('used: the assignment or mutation that consumed this review; a used review '
    + 'cannot be used again. null while no command has consumed it.'),
  commandSha256: z.string().regex(/^[a-f0-9]{64}$/).describe('The hash the review answered when it was stored.'),
}).readonly();
/** The identity reviews of a record's site that name the record and whose manifest the caller may read, newest
 * first by the time they were stored and then by id. `unreadable` counts rows of the page whose stored columns
 * and command do not agree with each other; none is listed. */
export const UspIdentityReviewListSchema = z.strictObject({
  recordId: z.uuid(), siteId: z.uuid(),
  items: z.array(UspIdentityReviewItemSchema).max(20).readonly(),
  truncated: z.boolean().describe('More reviews that the caller may read name this record than this page holds.'),
  unreadable: z.number().int().nonnegative().max(20),
}).readonly();
export type IdentityReviewList = z.infer<typeof UspIdentityReviewListSchema>;

export const AssignProjectCodeSchema = z.strictObject({ ...common,
  recordId: z.uuid(), expectedRecordVersion: z.number().int().positive(),
});
export const ProjectIdentityMutationSchema = z.strictObject({ ...common,
  operation: z.enum(['correct', 'cancel', 'retire', 'split', 'merge', 'boundary_adjustment']),
  predecessors: z.array(z.uuid()).max(100), successors: z.array(z.uuid()).max(100),
  expectedVersions: z.record(z.uuid(), z.number().int().positive()),
});
export const ResolveProjectIdentitySchema = z.strictObject({
  scope: UspSnapshotScopeSchema, identifier: z.string().min(1).max(300),
});
