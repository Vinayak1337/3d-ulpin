import { z } from 'zod';
import {
  CoreIdSchema, CorePositiveRevisionSchema, CoreRefSchema, CoreRevisionRefSchema,
  CoreSha256Schema, coreRefKey, coreText, parseCore,
} from '../spatial/core/scalars';
import {
  CORE_EVIDENCE_POLICY, CoreEvidenceLinkSchema, CoreLocatorSchema, CoreSourcePartSchema,
} from '../spatial/core/source-schema';

/** F0a wire contracts only. Parsing is not authentication or a database membership check. */
export const USP_SCHEMA_VERSION = 'usp/1' as const;
export const DataManifestIdSchema = CoreIdSchema.brand<'UspDataManifestId'>();
export const SceneManifestIdSchema = CoreIdSchema.brand<'UspSceneManifestId'>();
export const InputManifestIdSchema = CoreIdSchema.brand<'UspInputManifestId'>();
export const UspTargetPinSchema = CoreRevisionRefSchema;
export const UspIntakeScopeSchema = z.strictObject({
  kind: z.literal('intake'), workspaceId: CoreIdSchema, version: CorePositiveRevisionSchema,
}).readonly();
export const UspSnapshotScopeSchema = z.strictObject({
  kind: z.literal('snapshot'), scopeId: CoreIdSchema,
  world: CoreRefSchema.refine(ref => ref.namespace === 'world', 'Expected world reference'),
  manifestId: DataManifestIdSchema, snapshotDigest: CoreSha256Schema,
  stage: z.enum(['draft', 'recorded', 'retained']),
}).readonly();
export const UspScopeSchema = z.discriminatedUnion('kind', [UspIntakeScopeSchema, UspSnapshotScopeSchema]);
export const UspAssetRefSchema = z.strictObject({
  assetId: CoreIdSchema, version: CorePositiveRevisionSchema, sha256: CoreSha256Schema,
}).readonly();

const requestKey = coreText(128);
export const UspCreateGuardSchema = z.strictObject({
  mode: z.literal('create'), requestKey,
}).readonly();
export const UspUpdateGuardSchema = z.strictObject({
  mode: z.literal('update'), requestKey, expectedVersion: CorePositiveRevisionSchema,
  expectedManifestId: DataManifestIdSchema.optional(),
}).readonly();
export const UspMutationGuardSchema = z.discriminatedUnion('mode', [UspCreateGuardSchema, UspUpdateGuardSchema]);
export const UspPinnedUpdateGuardSchema = z.strictObject({
  mode: z.literal('update'), requestKey, expectedVersion: CorePositiveRevisionSchema,
  expectedManifestId: DataManifestIdSchema,
}).readonly();

/** Internal context: never parse this from a caller's body and regard it as trusted. */
export const UspPrincipalSchema = z.strictObject({
  subject: coreText(256), roles: z.array(coreText(64)).max(32).readonly(),
  entitlementVersion: CoreIdSchema,
  mode: z.enum(['local_demo', 'india_private', 'public_interoperability']),
}).readonly();
export const UspRequestContextSchema = z.strictObject({
  requestId: CoreIdSchema, principal: UspPrincipalSchema,
  accessViewId: CoreIdSchema, policyVersion: CoreIdSchema,
}).readonly();

/** Core keeps locators structural; this boundary also checks interval/region bounds. */
export const UspLocatorSchema = CoreLocatorSchema.superRefine((locator, ctx) => {
  if ((locator.kind === 'rows' || locator.kind === 'lines') && locator.range.start > locator.range.end) {
    ctx.addIssue({ code: 'custom', path: ['range'], message: 'Range end precedes start' });
  }
  const region = locator.kind === 'page' || locator.kind === 'image_region' ? locator.region : undefined;
  if (region && (region.x + region.width > 1 + CORE_EVIDENCE_POLICY.normalizedTolerance
    || region.y + region.height > 1 + CORE_EVIDENCE_POLICY.normalizedTolerance)) {
    ctx.addIssue({ code: 'custom', path: ['region'], message: 'Region exceeds displayed page bounds' });
  }
});
const partFields = CoreSourcePartSchema.unwrap().shape;
export const UspEvidencePointerSchema = z.strictObject({
  sourceRevision: partFields.source,
  assetRevision: partFields.asset,
  partRevision: CoreEvidenceLinkSchema.unwrap().shape.part.nullable(),
  locator: UspLocatorSchema,
  purpose: CoreEvidenceLinkSchema.unwrap().shape.purpose,
  origin: z.enum(['direct', 'inherited']), target: CoreRefSchema,
  legacyLocator: z.string().max(4096).optional(),
}).readonly();

const targetList = z.array(UspTargetPinSchema).min(1).max(100).superRefine((pins, ctx) => {
  const seen = new Set<string>();
  pins.forEach((pin, index) => {
    const key = coreRefKey(pin.ref);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index], message: 'Duplicate target identity' });
    seen.add(key);
  });
}).readonly();
export const UspProposalSelectionSchema = z.union([
  z.strictObject({ target: UspTargetPinSchema }).readonly(),
  z.strictObject({ targets: targetList }).readonly(),
]);

/** Factories require a producer's actual payload schema; there is no unknown-data success stub. */
export function uspServiceResultSchema<S extends z.ZodType>(data: S) {
  return z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('available'), data }).readonly(),
    z.strictObject({ state: z.literal('pending'), jobId: CoreIdSchema }).readonly(),
    z.strictObject({ state: z.literal('not_assessed'), reasonCode: CoreIdSchema }).readonly(),
    z.strictObject({ state: z.literal('unavailable'), reasonCode: CoreIdSchema }).readonly(),
  ]);
}
export function uspSuccessEnvelopeSchema<S extends z.ZodType>(data: S) {
  return z.strictObject({ data, meta: z.strictObject({
    schemaVersion: z.literal(USP_SCHEMA_VERSION), requestId: CoreIdSchema, scope: UspScopeSchema,
  }).readonly() }).readonly();
}
export const UspErrorEnvelopeSchema = z.strictObject({ error: z.strictObject({
  code: CoreIdSchema, message: coreText(1024), retryable: z.boolean(), requestId: CoreIdSchema,
}).readonly() }).readonly();
export const UspResolveTargetRequestSchema = z.strictObject({
  pin: UspTargetPinSchema, scope: UspSnapshotScopeSchema,
}).readonly();
export const UspReadEvidenceRequestSchema = z.strictObject({
  pointer: UspEvidencePointerSchema, scope: UspSnapshotScopeSchema,
  action: z.enum(['preview', 'extract', 'original']),
}).readonly();
export const UspReadScopeRequestSchema = z.strictObject({
  scope: UspSnapshotScopeSchema, cursor: coreText(4096).nullable(),
  limit: z.number().int().min(1).max(100),
}).readonly();

/** Use for untrusted JSON; rejects cycles, accessors, non-finite numbers and reserved keys. */
export const parseUsp = parseCore;
export type TargetPin = z.infer<typeof UspTargetPinSchema>;
export type IntakeScope = z.infer<typeof UspIntakeScopeSchema>;
export type SnapshotScope = z.infer<typeof UspSnapshotScopeSchema>;
export type UspScope = z.infer<typeof UspScopeSchema>;
export type AssetRef = z.infer<typeof UspAssetRefSchema>;
export type MutationGuard = z.infer<typeof UspMutationGuardSchema>;
export type RequestContext = z.infer<typeof UspRequestContextSchema>;
export type EvidencePointer = z.infer<typeof UspEvidencePointerSchema>;
export type ProposalSelection = z.infer<typeof UspProposalSelectionSchema>;
export type DataManifestId = z.infer<typeof DataManifestIdSchema>;
export type SceneManifestId = z.infer<typeof SceneManifestIdSchema>;
export type InputManifestId = z.infer<typeof InputManifestIdSchema>;
export type ServiceResult<T> =
  | { readonly state: 'available'; readonly data: T }
  | { readonly state: 'pending'; readonly jobId: string }
  | { readonly state: 'not_assessed' | 'unavailable'; readonly reasonCode: string };
