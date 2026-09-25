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
export const ProjectParcelAssociationSchema = z.strictObject({
  ulpin: z.string().trim().min(1).max(100),
  role: z.enum(['primary', 'associated']),
  sourceId: z.uuid(),
  reviewed: z.boolean(),
});
export const ProjectLocatorPartsSchema = z.strictObject({
  structureKind: z.enum(['S', 'U', 'A']),
  structureNumber: z.number().int().min(1).max(99),
  levels: z.array(z.union([z.enum(['B2', 'B1', 'LG', 'UG', 'G', 'ST', 'M1', 'P1', 'T', 'R', 'L?']), z.string().regex(/^F(?:0[1-9]|[1-9][0-9])$/)])).min(1).max(2),
  spaceKind: z.enum(['R', 'C', 'P', 'X', 'U', 'V']),
  spaceNumber: z.number().int().min(1).max(999),
});
export const ProjectLocationSchema = z.strictObject({
  anchorState: ProjectAnchorStateSchema,
  parcels: z.array(ProjectParcelAssociationSchema).max(100),
  locator: ProjectLocatorPartsSchema,
});
export type ProjectLocation = z.infer<typeof ProjectLocationSchema>;

export function verticalLocator(location: ProjectLocation): string {
  const reviewed = location.parcels.filter(parcel => parcel.reviewed);
  const primary = reviewed.filter(parcel => parcel.role === 'primary');
  const anchor = location.anchorState === 'reviewed_complete' && primary.length === 1
    ? primary[0].ulpin
    : ['reviewed_complete', 'reviewed_partial'].includes(location.anchorState) && reviewed.length > 1 && primary.length === 0
      ? `MULTI(${reviewed.length})` : 'NO-ANCHOR';
  const part = location.locator;
  return `${anchor} / ${part.structureKind}${String(part.structureNumber).padStart(2, '0')} / ${part.levels.join('-')} / ${part.spaceKind}${String(part.spaceNumber).padStart(3, '0')}`;
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
  evidence: z.array(z.strictObject({ sourceId: z.uuid(), locator: z.string().min(1).max(500) })).min(1).max(30),
  location: ProjectLocationSchema.optional(),
  transferredGeometry: z.unknown().optional(),
});
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
