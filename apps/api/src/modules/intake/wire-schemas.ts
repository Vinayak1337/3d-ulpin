import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ClaimTranscriptionSchema } from '@ulpin/contracts';
import {GisQuarantineSchema} from '@ulpin/contracts';
import { LargeOriginalEvidenceSchema } from '@ulpin/contracts/usp';

const uuid = z.string().uuid();
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const dynamic = z.unknown().describe('Retained source-specific or processor-specific value.');
const point = z.tuple([z.number(), z.number()]);
const frame = z.object({id: z.string(), horizontalUnit: z.literal('m'), verticalUnit: z.literal('m'), benchmark: z.string()});
const areaReference = z.object({
  sourceCrs: z.string(), analysisCrs: z.string(), origin: point, anchor: point,
  transformVersion: z.string(), verticalReference: z.string(),
});
const binding = z.object({sourceId: uuid, locator: z.string()});
const part = z.object({
  id: uuid, sourceRevisionId: uuid, locator: z.string(), text: z.string(), entityIds: z.array(uuid),
  copiedFrom: z.object({
    caseId: uuid, sourceRevisionId: uuid, sourceHash: z.string(), sourceRevision: z.number().int(),
    sourceProfile: z.string(), locator: z.string(), reason: z.string(), copiedAt: z.string(), actor: z.string(),
  }).optional(),
});
const contextFeature = z.object({
  alias: z.string(), kind: z.enum(['parcel', 'building']), footprint: z.array(point),
  name: z.string().optional(), evidence: binding.optional(),
});
const calibration = z.object({sourceId: uuid, page: z.number().int(), imagePoints: z.tuple([point, point]), worldPoints: z.tuple([point, point])});
export const unit = z.object({
  id: uuid, alias: z.string(), name: z.string(), kind: z.enum(['unit', 'common', 'basement']),
  footprint: z.array(point), lower: nullable(z.number()), upper: nullable(z.number()),
  lowerVerified: z.boolean(), upperVerified: z.boolean(),
  bindings: z.object({footprint: binding.optional(), lower: binding.optional(), upper: binding.optional(), alignment: binding.optional()}),
  revision: z.number().int(), levelLabel: z.string(), calibration: calibration.optional(),
});
const issue = z.object({code: z.string(), message: z.string(), field: z.string().optional(), severity: z.enum(['error', 'warning', 'info'])});
const inspection = z.object({
  largeOriginal: LargeOriginalEvidenceSchema.optional(),
  profile: z.string(), status: z.enum(['ready', 'needs_input', 'failed']), issues: z.array(issue), summary: z.string(),
  frame: frame.optional(), features: z.array(z.object({
    alias: z.string(), name: z.string(), kind: z.string(), footprint: z.array(point),
    levelLabel: z.string().optional(), draftLower: z.number().optional(), draftUpper: z.number().optional(),
  })).optional(),
  levels: z.array(z.object({
    alias: z.string(), lower: nullable(z.number()), upper: nullable(z.number()), benchmark: z.string(),
    unit: z.literal('m'), method: z.string(), locator: z.string(),
  })).optional(),
  controls: z.array(z.object({id: z.string(), x: z.number(), y: z.number(), benchmark: z.string(), locator: z.string()})).optional(),
  image: z.object({width: z.number(), height: z.number(), pages: z.number().int().optional()}).optional(),
  referenceParts: z.array(part).optional(),
  warnings: z.array(z.string()).optional(),
}).passthrough();
export const caseRecord = z.object({
  id: uuid, siteId: nullable(uuid).optional(), archived: z.boolean(), name: z.string(),
  description: z.string(), frame, revision: z.number().int(), createdAt: z.string(), updatedAt: z.string(),
});
export const sourceRevision = z.object({
  id: uuid, caseId: uuid, familyId: uuid, revision: z.number().int(), name: z.string(),
  profile: z.string(), mimeType: z.string(), bytes: z.number().int(), sha256: z.string(),
  status: z.enum(['received', 'processing', 'ready', 'needs_input', 'failed', 'inspected']),
  createdAt: z.string(), inspection: nullable(z.union([inspection, z.object({
    status: z.literal('interpreted'), reference: areaReference, featureCount: z.number().int(),
    acquisitionId: uuid.optional(), warnings: z.array(z.string()),
  }).passthrough()])),
});
export const job = z.object({
  id: uuid, caseId: uuid, sourceId: nullable(uuid),
  operation: z.string().describe('Canonical shared job operation; case intake queues inspect and build.'),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'stale', 'cancelled']),
  createdAt: z.string(), completedAt: nullable(z.string()), error: nullable(z.string()), inputFingerprint: z.string(),
});
const model = z.object({
  id: uuid, caseId: uuid, revision: z.number().int(), frame,
  units: z.array(unit.extend({lower: z.number(), upper: z.number(), area: z.number(), height: z.number(), volume: z.number()})),
  context: z.array(contextFeature),
  findings: z.array(z.object({
    id: z.string(), code: z.string(), severity: z.enum(['error', 'warning', 'info']), title: z.string(),
    description: z.string(), unitIds: z.array(uuid), sourceIds: z.array(uuid),
    overlap: z.object({footprint: z.array(point), lower: z.number(), upper: z.number(), volume: z.number()}).optional(),
  })), inputFingerprint: z.string(), createdAt: z.string(), method: z.string(),
});
export const caseDetail = z.object({
  case: caseRecord,
  identity: z.object({
    rootId: z.string(), status: z.literal('prototype'), scope: z.literal('property-workspace'),
    floors: z.array(z.object({id: z.string(), code: z.string(), label: z.string(), parentId: z.string()})),
    spaces: z.array(z.object({id: z.string(), code: z.string(), unitId: uuid, parentId: z.string(), path: z.string()})),
  }),
  sources: z.array(sourceRevision), units: z.array(unit), jobs: z.array(job), model: nullable(model),
  context: z.array(contextFeature),
  history: z.array(z.object({id: uuid, kind: z.string(), message: z.string(), createdAt: z.string()})),
});
export const demoInputs = z.object({sourceIds: z.array(uuid)});
export const binary = {type: 'string', format: 'binary'} as const;
export const sourceCase = z.object({caseId: uuid});
export const caseDocument = z.object({caseId: uuid, sourceId: uuid, jobId:uuid.optional()});

const geometry = z.object({
  type: z.enum(['GeometryCollection', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']),
  coordinates: z.union([
    z.array(z.number()), z.array(z.array(z.number())),
    z.array(z.array(z.array(z.number()))), z.array(z.array(z.array(z.array(z.number())))),
  ]).optional(),
  geometries: z.array(dynamic.describe('Recursive AreaGeometry member.')).optional(),
});
const reference = areaReference;
const extent = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const administrativeUnit = z.object({
  id: uuid, kind: z.string(), name: z.string(), code: z.string().optional(),
  authority: z.string().optional(), source: z.string().optional(),
});
export const mapArea = z.object({
  id: uuid, siteId: uuid, name: z.string(), revision: z.number().int(),
  reference: nullable(reference), extent: nullable(extent), geographicExtent: nullable(extent),
  administrativeUnits: z.array(administrativeUnit),
  dataKind: z.enum(['real', 'demonstration', 'mixed', 'empty']).optional(),
  featureCount: z.number().optional(),
});
const locator = z.object({
  sourceRevisionId: uuid, page: z.number().int().optional(), row: z.number().int().optional(),
  partId: uuid.optional(), featureId: z.string().optional(), jsonPointer: z.string().optional(),
  region: z.object({x: z.number(), y: z.number(), width: z.number(), height: z.number(), unit: z.literal('normalized')}).optional(),
});
const physicalFeature = z.object({
  sourceFeatureIndex: z.number().int().nonnegative().optional(),
  id: uuid, identifier: z.string(), areaId: uuid, revision: z.number().int(),
  sourceRevisionId: uuid, datasetNamespace: z.string(), sourceKey: z.string(), name: z.string(),
  kind: z.enum(['building', 'parcel', 'road', 'public_land', 'utility']),
  geometry: geometry.nullable(), geographicGeometry: geometry.nullable(), sourceGeometry: dynamic,
  placement: z.literal('unknown').optional(), sourceReference: reference.optional(),
  height: z.object({
    state: z.enum(['unknown', 'unresolved', 'estimated', 'source_supported', 'reviewed']),
    value: nullable(z.number()), unit: z.literal('m'), meaning: z.string(), reference: z.string(),
    evidence: z.array(locator).optional(), claimId: uuid.optional(), method: z.string().optional(),
    originalValue: dynamic.optional(), originalUnit: z.string().optional(),
  }), worldStatus: z.enum(['observed', 'planned', 'hypothetical', 'synthetic']),
  properties: z.record(z.string(), dynamic), areaM2: nullable(z.number()),
  evidence: z.array(locator), representation: z.enum(['physical_exterior', 'physical_context']),
  geometryRole: z.string().optional(),
  semantics: z.object({
    geometryRole: z.string().optional(), evidenceState: z.string().optional(), levelReference: z.string().optional(),
    sourceDate: z.string().optional(), validFrom: z.string().optional(), validTo: z.string().optional(),
    horizontalUncertaintyM: z.number().optional(), approvalStatus: z.string().optional(),
    floorCount: z.number().optional(), assetId: z.string().optional(),
  }).optional(),
  verticalExtent: z.object({
    lower: z.number(), upper: z.number(), unit: z.literal('m'), reference: z.string(),
    evidenceState: z.string(), evidence: z.array(locator),
  }).optional(),
  utilityProfile: z.record(z.string(), dynamic).optional(),
});
const finding = z.object({
  id: uuid, category: z.enum(['geometric', 'coverage', 'rule', 'document']), code: z.string(),
  message: z.string(), featureIds: z.array(uuid), areaM2: z.number().optional(), volumeM3: z.number().optional(),
  geometry: geometry.optional(), geographicGeometry: geometry.optional(), participants: z.array(physicalFeature).optional(),
  method: z.string().optional(), inputRevisions: z.array(z.object({featureId: uuid, revision: z.number().int(), sourceRevisionId: uuid})).optional(),
  evidence: z.array(locator).optional(), quantities: z.record(z.string(), z.number()).optional(), limitations: z.array(z.string()).optional(),
});
export const areaCheck = z.object({
  id: uuid, areaId: uuid, areaRevision: z.number().int(), status: z.enum(['running', 'completed', 'failed']),
  findings: z.array(finding), coverage: z.array(z.string()), inputFingerprint: z.string(),
  createdAt: z.string(), stale: z.boolean().optional(), error: z.string().optional(),
});
export const question = z.object({
  kind: z.enum(['missing_height', 'conflicting_claims']).optional(), id: uuid,
  entityId: uuid, property: z.string(), message: z.string(), blocks: z.string(),
  answer: z.object({choice: z.enum(['keep_2d', 'estimate', 'select_claim']), value: z.number().optional(), reason: z.string(), claimId: uuid.optional()}).optional(),
});
const factCandidate = z.object({
  id: uuid, entityId: uuid, property: z.string(), value: dynamic, unit: z.string().optional(),
  referenceFrameId: z.string().optional(), evidence: z.array(locator),
  method: z.enum(['native_parse', 'ai_extraction', 'human_entry', 'derived']),
  evidenceState: z.enum(['unresolved', 'estimated', 'source_supported', 'reviewed']),
  worldStatus: z.enum(['observed', 'planned', 'hypothetical', 'synthetic']), subject: z.string().optional(),
  transcription: ClaimTranscriptionSchema.optional(),
});
export const importPackage = z.object({
  geometryFree: z.literal(true).optional(),
  administrativeContext: z.object({sourceId: uuid, sourceCrs: z.string(), units: z.array(z.object({
    id: uuid, sourceKey: z.string(), kind: z.literal('sector'), name: z.string(), rings: z.array(z.array(point)),
  }))}).optional(),
  documentPins: z.array(z.object({
    sourceId: uuid, sourceRevision: z.number().int(), sourceSha256: z.string(),
  })).optional(),
  sourceMetadata: z.array(z.object({
    key: z.string(), filename: z.string(), sourceSha256: z.string(), originalUrl: z.string(),
    issuer: z.string(), acquiredAt: z.string(),
    permission: z.literal('unconfirmed'), classification: z.literal('test_only'),
  })).optional(),
  quarantine:GisQuarantineSchema.optional(),
  id: uuid, schemaVersion: z.literal('ulpin-canonical/2'), areaId: uuid, name: z.string(),
  datasetNamespace: z.string(), revision: z.number().int(),
  state: z.enum(['RECEIVED', 'NEEDS_INPUT', 'READY_FOR_REVIEW', 'REVIEWED', 'COMMITTED']),
  sourceRevisionIds: z.array(uuid), features: z.array(physicalFeature), questions: z.array(question),
  factCandidates: z.array(factCandidate), parts: z.array(part), warnings: z.array(z.string()), createdAt: z.string(),
  sourceWorkspace: z.object({caseId: uuid, frame, worldStatus: z.enum(['observed', 'planned', 'hypothetical', 'synthetic']), areaReferenceFingerprint: z.string()}).optional(),
  review: z.object({
    areaRevision: z.number().int(), packageRevision: z.number().int(), inputFingerprint: z.string(),
    findings: z.array(finding), coverage: z.array(z.string()),
  }).optional(), acknowledgement: z.string().optional(),
  selectedClaimIds: z.array(uuid).optional(),
  factDecisions: z.array(z.object({claimId: uuid, reason: z.string(), time: z.string(), actor: z.string()})).optional(),
  sourceHash: z.string().optional(), importSignature: z.string().optional(),
  extent: extent.optional(), geographicExtent: extent.optional(),
});
export const areaContext = z.object({
  displayFeatures:z.array(physicalFeature.extend({displayState:z.literal('unrecorded_proposal').optional(),proposalPackageId:uuid.optional()})).optional(),
  area: mapArea, features: z.array(physicalFeature), packages: z.array(importPackage),
  latestCheck: nullable(areaCheck),
  parcelAssociations: z.array(z.object({
    id: uuid, revision: z.number().int(), fromId: uuid, toId: uuid,
    relationship: z.enum(['occupies_parcel', 'representation_of', 'detailed_record', 'shared_space']),
    status: z.enum(['suggested', 'confirmed', 'rejected']), evidence: z.array(locator),
    reason: z.string(), actor: z.string(), updatedAt: z.string(), fromRevision: z.number().int(), toRevision: z.number().int(),
  })).optional(),
  parcelIdentifiers: z.array(z.object({
    parcelId: uuid, scheme: z.string(), value: z.string(), issuer: z.string(),
    evidence: z.object({sourceRevisionId: uuid.optional(), locator: z.string().optional()}).passthrough(),
  })).optional(),
  sceneAssets: z.array(z.object({
    featureId: uuid, featureRevision: z.number().int(), url: z.string(), sha256: z.string(), frame: z.string(),
    position: z.tuple([z.number(), z.number(), z.number()]), heading: z.number(), provenance: z.string(), purpose: z.literal('presentation'),
  })).optional(),
});
export const gisInspection = z.object({
  quarantine:GisQuarantineSchema.optional(),
  format: z.enum(['geojson', 'arcgis', 'gpkg', 'shapefile_zip']), sourceSha256: z.string(),
  bytes: z.number().int(), layers: z.array(z.string()), layer: nullable(z.string()),
  sourceCrs: nullable(z.string()), crsEvidence: nullable(z.string()), featureCount: nullable(z.number().int()),
  geometryTypes: z.array(z.string()), fields: z.array(z.object({
    name: z.string(), complete: z.boolean(), unique: z.boolean(), idEligible: z.boolean(),
  })), featureIdEligible: z.boolean(), suggestedIdField: nullable(z.string()),
  suggestedNameField: nullable(z.string()), suggestedTitle: z.string(), suggestedNamespace: z.string(),
});
const license = z.object({status: z.enum(['public_open_data_terms', 'unresolved']), url: z.string(), note: z.string()});
const catalogEntry = z.object({
  id: z.string(), name: z.string(), provider: z.string(), datasetId: z.string(),
  datasetUrl: z.string(), metadataUrl: z.string(), queryUrl: z.string(), coverage: z.string(),
  sourceCRS: z.string(), status: z.enum(['metadata_verified', 'download_verified']),
  license, acquisitionEnabled: z.boolean(), retrievedAt: z.string(), updateFrequency: z.string(),
  privacyAllowlist: z.array(z.string()),
  adapter: z.object({id: z.string(), version: z.string(), format: z.enum(['geojson', 'arcgis']), idField: z.string(), heightField: nullable(z.string()), heightUnit: nullable(z.literal('ft')), heightMeaning: z.string()}),
  limits: z.object({maxFeatures: z.number().int(), requiresBoundedArea: z.boolean()}),
  snapshot: z.object({areaKey: z.string(), name: z.string(), sourceFile: z.string(), manifestFile: z.string(), sha256: z.string(), featureCount: z.number().int(), bboxWgs84: extent}).optional(),
  limitations: z.array(z.string()),
});
export const sourceCatalog = z.array(catalogEntry);
export const acquisitionProbe = z.object({
  sourceId: z.string(), status: z.enum(['metadata_verified', 'count_verified']),
  acquisitionEnabled: z.boolean().optional(), reason: z.string().optional(),
  featureCount: z.number().int().optional(), maxFeatures: z.number().int().optional(),
  bbox: extent.optional(), license: license.optional(), queriedAt: z.string().optional(),
});
export const acquisition = z.object({
  id: uuid, sourceId: z.string(), mode: z.enum(['saved', 'refresh']), status: z.literal('complete'),
  objectKey: z.string(), sha256: z.string(), bytes: z.number().int(),
  manifest: z.record(z.string(), dynamic).describe('Issuer/source transfer and count evidence.'),
  openedAt: z.string(), snapshotLabel: z.string(),
});
export const resolvedIdentifier = z.object({
  status: z.enum(['not_found', 'matched', 'ambiguous']),
  message: z.string().optional(),
  matches: z.array(z.object({
    kind: z.enum(['physical_feature', 'registry_record', 'site']),
    areaIds: z.array(uuid), matchEvidence: z.array(z.object({
      scheme: z.string(), value: z.string().optional(), normalized_value: z.string().optional(),
      issuer: z.string().optional(), evidence: dynamic.optional(), verification_state: z.string().optional(),
    })), url: z.string(), area: mapArea.optional(),
    feature: physicalFeature.optional(), record: z.object({
      id: uuid, identifier: z.string(), revision: z.number().int(), siteId: uuid.optional(),
    }).passthrough().optional(), site: z.object({
      id: uuid, identifier: z.string(), name: z.string(),
    }).optional(),
    relatedBuildings: z.array(z.object({
      id: uuid.optional(), identifier: z.string().optional(), feature: physicalFeature.optional(),
      relationship: z.string().optional(), status: z.string().optional(),
    }).passthrough()).optional(), confirmedBuildings: z.array(physicalFeature).optional(),
    parentParcels: z.array(z.object({id: uuid, identifier: z.string()}).passthrough()).optional(), selectionGeometry: geometry.optional(),
    contextExtent: nullable(extent).optional(),
  })),
});
export const externalIdentifier = z.object({
  scheme: z.enum(['official_ulpin', 'demo_ulpin', 'source_property_id', 'nyc_bin']),
  value: z.string(),
  evidence: z.object({
    sourceRevisionId: uuid, locator: z.string(), acceptedBy: z.string(), meaning: z.string(),
  }),
});

const error = z.object({error: z.object({
  code: z.string(), message: z.string(), requestId: uuid, details: dynamic.optional(),
})});
type SwaggerSchema = Extract<Parameters<typeof ApiResponse>[0], {schema: unknown}>['schema'];
const schema = (value: z.ZodType): SwaggerSchema =>
  z.toJSONSchema(value, {target: 'openapi-3.0'}) as unknown as SwaggerSchema;
const requestSchema = (value: z.ZodType): SwaggerSchema => z.toJSONSchema(value, {
  target: 'openapi-3.0', io: 'input', override: ({jsonSchema}) => { delete jsonSchema.readOnly; },
}) as unknown as SwaggerSchema;
export const jsonBody = (value: z.ZodType) => ApiBody({schema: requestSchema(value)});
export const retiredBranchResponse = () => ApiResponse({status: 410, schema: schema(error)});
export function wireResponse(status: number, value: z.ZodType | typeof binary, additionalErrors:number[] = []) {
  const success = value === binary ? binary : schema(value as z.ZodType);
  const failure = schema(error);
  return applyDecorators(
    ApiResponse({status, schema: success}),
    ApiResponse({status: 400, schema: failure}),
    ApiResponse({status: 403, schema: failure}),
    ApiResponse({status: 404, schema: failure}),
    ApiResponse({status: 409, schema: failure}),
    ApiResponse({status: 413, schema: failure}),
    ApiResponse({status: 415, schema: failure}),
    ApiResponse({status: 422, schema: failure}),
    ApiResponse({status: 503, schema: failure}),
    ...additionalErrors.map(status=>ApiResponse({status,schema:failure})),
  );
}
export function multipartBody(required: string[], properties: Record<string, unknown>) {
  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({schema: {type: 'object', required, properties: {file: binary, ...properties}}}),
  );
}
export function gisImportBody(
  json: z.ZodType, required: string[], properties: Record<string, unknown>, sourceBuildings?: z.ZodType,
) {
  const variants: SwaggerSchema[] = [
    requestSchema(json), {type: 'object', required, properties: {file: binary, ...properties}} as SwaggerSchema,
  ];
  if (sourceBuildings) variants.push({
    type: 'object', required: ['format', 'metadata'], additionalProperties: binary,
    properties: {
      format: {type: 'string', enum: ['document_buildings', 'administrative_context']},
      metadata: {
        type: 'string', description: 'JSON declarations; attach each unchanged original under its document key.',
        'x-sourceBuildingSchema': requestSchema(sourceBuildings),
      },
    },
  } as SwaggerSchema);
  return applyDecorators(
    ApiConsumes('application/json', 'multipart/form-data'),
    ApiBody({
      description: 'JSON retains an acquisition; multipart retains GIS or document-backed geometry-free buildings.',
      schema: {oneOf: variants},
    }),
  );
}
