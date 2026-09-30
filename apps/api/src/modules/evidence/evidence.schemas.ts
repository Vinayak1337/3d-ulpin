import { z } from 'zod';
import type { SchemaObject } from '@nestjs/swagger';
import {
  AssignProjectCodeSchema, ProjectIdentityMutationSchema, ProjectIdentityReviewSchema,
  ResolveProjectIdentitySchema, UspCaptureSnapshotRequestSchema, UspCommitProposalSchema,
  UspErrorEnvelopeSchema, UspExactPartResultSchema, UspExchangeCompareSchema,
  UspExchangeExportSchema, UspIdentityCommitReceiptSchema, UspPacket0ReceiptSchema,
  UspPacket0RequestSchema, UspPrepareProposalSchema, UspReadEvidenceRequestSchema,
  UspReadScopeRequestSchema, UspRegistryCommitReceiptSchema, UspResolvedTargetSchema,
  UspScopePageSchema, UspSnapshotManifestSchema, UspSnapshotScopeSchema,
  UspTargetPinSchema, UspVerticalContextSchema, UspVerticalSelectionSchema,
  UspResolveTargetRequestSchema, uspServiceResultSchema, uspSuccessEnvelopeSchema,
} from '@ulpin/contracts/usp';

// Route-specific request shapes keep the baseline action and snapshot pins visible in OpenAPI.
export const SnapshotReadRequestSchema = z.object({ scope: UspSnapshotScopeSchema }).passthrough();
export const OriginalRequestSchema = z.strictObject({
  ...UspReadEvidenceRequestSchema.unwrap().shape, action: z.literal('original'),
});
export const ExactPartRequestSchema = z.strictObject({
  ...UspReadEvidenceRequestSchema.unwrap().shape, action: z.literal('extract'),
});

const id = UspSnapshotScopeSchema.unwrap().shape.scopeId;
const sha256 = UspSnapshotScopeSchema.unwrap().shape.snapshotDigest;
const pin = UspTargetPinSchema;
const LocalGuardErrorSchema = z.strictObject({ error: z.strictObject({
  code: z.enum(['HOST_DENIED', 'ORIGIN_DENIED']), message: z.string(), requestId: id,
}) });

export const PreparedProposalSchema = z.strictObject({
  proposalId: id, version: z.number().int().positive(), state: z.literal('draft'),
});
export const IdentityReviewReceiptSchema = z.strictObject({
  reviewId: z.uuid(), commandSha256: sha256, expectedManifestId: z.uuid(),
});
export const ResolvedIdentitySchema = z.strictObject({
  recordId: z.uuid(), projectCode: z.string().regex(/^P3-[0-9A-HJKMNP-TV-Z]{20}-[0-9A-HJKMNP-TV-Z]{2}$/),
  profile: z.literal('P3/1'), status: z.enum(['assigned', 'cancelled_error', 'retired']),
  recordVersion: z.number().int().positive(), registryIdentifier: z.string(),
  location: z.string(), successors: z.array(z.uuid()),
});

const loss = z.strictObject({ objectId: z.string().nullable(), field: z.string(),
  category: z.enum(['unsupported', 'omitted_by_profile', 'withheld']), reason: z.string() });
const frame = z.strictObject({ horizontal: z.string(), vertical: z.string(), unit: z.literal('m') });
const cityObject = z.strictObject({
  type: z.enum(['Building', 'BuildingStorey', 'BuildingUnit']),
  attributes: z.strictObject({ recordId: z.uuid(), recordRevision: z.number().int().positive(),
    manifestDigest: sha256, projectCode: z.string().nullable(),
    identifierScheme: z.literal('application-project-p3-1'), name: z.string().nullable() }),
  parents: z.array(z.uuid()).optional(), children: z.array(z.uuid()).optional(),
});
const cityJson = z.strictObject({
  type: z.literal('CityJSON'), version: z.literal('2.0'),
  transform: z.strictObject({ scale: z.tuple([z.number(), z.number(), z.number()]),
    translate: z.tuple([z.number(), z.number(), z.number()]) }),
  metadata: z.strictObject({ referenceSystem: z.string(), verticalReference: z.string(), identifier: id }),
  CityObjects: z.record(z.string(), cityObject), vertices: z.array(z.tuple([z.number(), z.number(), z.number()])),
});
const source = z.strictObject({ id: z.uuid(), revision: z.number().int().positive(), sha256,
  licenceFamily: z.string().nullable(), bodySha256: sha256,
  // Captured source metadata is format-specific; the object key is removed by the service.
  metadata: z.record(z.string(), z.unknown()).describe('Format-specific captured source fields; private object key removed'),
});
const exchangeRecord = z.strictObject({ id: z.uuid(), pin, bodySha256: sha256,
  // General exchange omits private citation pins; the captured hash is not the served-body hash.
  body: z.record(z.string(), z.unknown()).describe('Registry body projection with private document citations omitted; source-profile fields remain dynamic'),
  bodyProjection: z.strictObject({ profile: z.literal('registry-private-projection/1'), sha256,
    sha256Basis: z.literal('canonical_served_body'), capturedBodySha256: sha256,
    capturedBodyHashBasis: z.literal('immutable_captured_body') }),
  sourceIds: z.array(z.uuid()),
  licenceFamily: z.string().nullable(), omittedFromCityJson: z.boolean() });
const sidecar = z.strictObject({ profile: z.literal('P3-CJ/1'), manifestId: id,
  manifestDigest: sha256, cityJsonSha256: sha256,
  cityJsonEncoding: z.literal('JSON.stringify UTF-8'), access: z.literal('private'),
  codeNamespace: z.literal('P3/1'), frame, exportLicenceFamily: z.string().nullable(),
  requestedPins: z.array(pin), records: z.array(exchangeRecord), sources: z.array(source),
  omissions: z.array(z.strictObject({ field: z.literal('documentCitations'),
    category: z.literal('omitted_by_profile'), reason: z.string() })),
  losses: z.array(loss),
});
const ladm = z.strictObject({ profile: z.literal('P3-LADM/1'), basis: z.string(),
  fields: z.array(z.strictObject({ objectId: z.uuid(), field: z.string(), role: z.string(),
    coverage: z.enum(['mapped', 'extension', 'unsupported', 'withheld']) })),
  unmapped: z.array(z.strictObject({ objectId: z.string().nullable(), field: z.string(), reason: z.string() })),
});
export const CityJsonExportResultSchema = z.strictObject({
  cityJson, sidecar, ladm, losses: z.array(loss),
});
export const CityJsonCompareResultSchema = z.strictObject({
  profile: z.literal('P3-CJ/1'), manifestId: id, state: z.enum(['compared', 'conflict']),
  comparisons: z.array(z.strictObject({ objectId: z.string().nullable(), field: z.string(),
    category: z.enum(['exact', 'normalized_equivalent', 'omitted_by_profile', 'unsupported', 'withheld', 'conflict']),
    detail: z.string().optional() })),
  mutation: z.literal('none; reviewed commands are required'),
});

export const evidenceSchemas = {
  snapshots: { request: UspCaptureSnapshotRequestSchema, response: UspSnapshotManifestSchema },
  snapshotRead: { request: SnapshotReadRequestSchema, response: UspSnapshotManifestSchema },
  scopeRead: { request: UspReadScopeRequestSchema, response: UspScopePageSchema },
  targetResolve: { request: UspResolveTargetRequestSchema, response: uspServiceResultSchema(UspResolvedTargetSchema) },
  targetVertical: { request: UspVerticalSelectionSchema, response: uspServiceResultSchema(UspVerticalContextSchema) },
  original: { request: OriginalRequestSchema },
  exactPart: { request: ExactPartRequestSchema, response: UspExactPartResultSchema },
  prepare: { request: UspPrepareProposalSchema, response: PreparedProposalSchema },
  commit: { request: UspCommitProposalSchema, response: UspRegistryCommitReceiptSchema },
  identityReview: { request: ProjectIdentityReviewSchema, response: IdentityReviewReceiptSchema },
  identityAssign: { request: AssignProjectCodeSchema, response: UspIdentityCommitReceiptSchema },
  identityMutate: { request: ProjectIdentityMutationSchema, response: UspIdentityCommitReceiptSchema },
  identityResolve: { request: ResolveProjectIdentitySchema, response: ResolvedIdentitySchema },
  cityJsonExport: { request: UspExchangeExportSchema, response: CityJsonExportResultSchema },
  cityJsonCompare: { request: UspExchangeCompareSchema, response: CityJsonCompareResultSchema },
  packetCreate: { request: UspPacket0RequestSchema, response: UspPacket0ReceiptSchema },
  packetBinary: { contentTypes: ['text/plain', 'text/csv'] as const,
    hashHeader: 'X-Artifact-SHA256' as const, receipt: UspPacket0ReceiptSchema },
  packetReceipt: { response: UspPacket0ReceiptSchema },
  error: UspErrorEnvelopeSchema,
  forbiddenError: z.union([UspErrorEnvelopeSchema, LocalGuardErrorSchema]),
} as const;

export function openApiSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any' }) as SchemaObject;
}

/** Zod readonly freezes parsed values; it does not make required client input read-only. */
export function requestApiSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input',
    override: ({ jsonSchema }) => { delete (jsonSchema as Record<string, unknown>).readOnly; },
  }) as SchemaObject;
}

export function envelopeSchema(schema: z.ZodType): SchemaObject {
  return openApiSchema(uspSuccessEnvelopeSchema(schema));
}
