import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ConsolidatedRegistryReportSchema, RegistryMetadataSchema } from '@ulpin/contracts';

type JsonSchema = Record<string, unknown>;
const str = { type: 'string' };
const integer = { type: 'integer' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const anyJson = { description: 'Source-shaped JSON value retained without interpretation' };
const array = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const nullable = (schema: JsonSchema): JsonSchema => ({ ...schema, nullable: true });
const properties = (schema: JsonSchema) => schema.properties as Record<string, JsonSchema>;
const numbers = array(num);
const point = { type: 'array', items: num, minItems: 2, maxItems: 2 };
const ring = array(point);

/** Generated from the exact Zod validator run at the HTTP boundary. */
export function requestSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: 'input', target: 'openapi-3.0' }) as JsonSchema;
  return json;
}
export const consolidatedRegistryReport = requestSchema(ConsolidatedRegistryReportSchema);
export const apiError = object({ error: object({
  code: str, message: str, requestId: str, details: anyJson,
}, ['code', 'message', 'requestId']) }, ['error']);
const errors = () => [400, 403, 404, 409, 413, 422, 503]
  .map(status => ApiResponse({ status, schema: apiError as never }));
export function ApiContract(status: number, response: JsonSchema, body?: z.ZodType) {
  return applyDecorators(
    ...(body ? [ApiBody({ schema: requestSchema(body) as never })] : []),
    ApiResponse({ status, schema: response as never }), ...errors(),
  );
}
export function ApiExport(json: JsonSchema, formats: ('pdf' | 'zip' | 'csv' | 'html')[]) {
  const content: Record<string, { schema: JsonSchema }> = { 'application/json': { schema: json } };
  if (formats.includes('pdf')) content['application/pdf'] = { schema: { type: 'string', format: 'binary' } };
  if (formats.includes('zip')) content['application/zip'] = { schema: { type: 'string', format: 'binary' } };
  if (formats.includes('csv')) content['text/csv'] = { schema: str };
  if (formats.includes('html')) content['text/html'] = { schema: str };
  return applyDecorators(ApiResponse({ status: 200, content: content as never }), ...errors());
}

export const sourceBinding = object({ sourceId: str, locator: str }, ['sourceId', 'locator']);
export const frame = object({ id: str, horizontalUnit: str, verticalUnit: str, benchmark: str },
  ['id', 'horizontalUnit', 'verticalUnit', 'benchmark']);
export const locator = object({ sourceRevisionId: str, partId: str, featureId: str, page: integer,
  row: integer, jsonPointer: str, region: object({ x: num, y: num, width: num, height: num, unit: str },
    ['x', 'y', 'width', 'height', 'unit']) }, ['sourceRevisionId']);
const calibration = object({ sourceId: str, page: integer, imagePoints: array(point), worldPoints: array(point) },
  ['sourceId', 'page', 'imagePoints', 'worldPoints']);
const unitGeometry = object({ id: str, alias: str, name: str, kind: str, footprint: ring,
  lower: nullable(num), upper: nullable(num), lowerVerified: bool, upperVerified: bool,
  bindings: object({ footprint: sourceBinding, lower: sourceBinding, upper: sourceBinding, alignment: sourceBinding }),
  revision: integer, levelLabel: str, calibration, area: num, height: num, volume: num },
  ['id', 'alias', 'name', 'kind', 'footprint', 'lower', 'upper', 'lowerVerified', 'upperVerified', 'bindings', 'revision', 'levelLabel']);
export const registryRight = object({ party: str, type: str, evidence: sourceBinding }, ['party', 'type', 'evidence']);
export const registryLink = object({ targetId: str, type: str }, ['targetId', 'type']);
export const registryBody = object({ alias: str, name: str, kind: str, use: str, footprint: ring,
  geometry: unitGeometry, links: array(registryLink), rights: array(registryRight),
  evidence: array(sourceBinding), officialUlpin: str, synthetic: bool, registryMetadata: requestSchema(RegistryMetadataSchema) },
  ['alias', 'name', 'kind', 'footprint', 'links', 'rights', 'evidence', 'synthetic']);
export const registryRecord = object({ ...properties(registryBody), id: str, siteId: str, identifier: str, revision: integer },
  [...registryBody.required as string[], 'id', 'siteId', 'identifier', 'revision']);
export const registrySite = object({ id: str, identifier: str, name: str, frame, revision: integer, synthetic: bool },
  ['id', 'identifier', 'name', 'frame', 'revision', 'synthetic']);
export const registryDraft = object({ id: str, siteId: str, caseId: str, revision: integer,
  status: str, records: array(registryRecord), createdAt: str },
  ['id', 'siteId', 'caseId', 'revision', 'status', 'records', 'createdAt']);
const overlap = object({ footprint: ring, lower: num, upper: num, volume: num },
  ['footprint', 'lower', 'upper', 'volume']);
export const finding = object({ id: str, code: str, severity: str, title: str, description: str,
  unitIds: array(str), sourceIds: array(str), overlap }, ['id', 'code', 'severity', 'title', 'description', 'unitIds', 'sourceIds']);
export const registryReview = object({ id: str, draftId: str, draftRevision: integer, siteRevision: integer,
  findings: array(finding), records: array(registryRecord), before: array(registryRecord),
  inputFingerprint: str, preparationFingerprint: str, committed: bool, acknowledgement: str },
  ['id', 'draftId', 'draftRevision', 'siteRevision', 'findings', 'records', 'before', 'inputFingerprint', 'committed']);
const issue = object({ code: str, message: str, field: str, severity: str }, ['code', 'message', 'severity']);
const documentPart = object({ id: str, sourceRevisionId: str, locator: str, text: str, entityIds: array(str),
  copiedFrom: object({ caseId: str, sourceRevisionId: str, sourceHash: str, sourceRevision: integer,
    sourceProfile: str, locator: str, reason: str, copiedAt: str, actor: str },
    ['caseId', 'sourceRevisionId', 'sourceHash', 'sourceRevision', 'sourceProfile', 'locator', 'reason', 'copiedAt', 'actor']) },
  ['id', 'sourceRevisionId', 'locator', 'text', 'entityIds']);
const spatialFeature = object({ alias: str, name: str, kind: str, footprint: ring,
  levelLabel: str, draftLower: num, draftUpper: num }, ['alias', 'name', 'kind', 'footprint']);
export const sourceRevision = object({ id: str, caseId: str, familyId: str, revision: integer, name: str,
  profile: str, mimeType: str, bytes: integer, sha256: str, status: str, createdAt: str,
  inspection: nullable(object({ profile: str, status: str, issues: array(issue), summary: str, frame,
    features: array(spatialFeature), referenceParts: array(documentPart),
    levels: array(object({ alias: str, lower: nullable(num), upper: nullable(num), benchmark: str,
      unit: str, method: str, locator: str }, ['alias', 'lower', 'upper', 'benchmark', 'unit', 'method', 'locator'])),
    controls: array(object({ id: str, x: num, y: num, benchmark: str, locator: str }, ['id', 'x', 'y', 'benchmark', 'locator'])),
    image: object({ width: integer, height: integer, pages: integer }, ['width', 'height']) },
    ['profile', 'status', 'issues', 'summary'])) },
  ['id', 'caseId', 'familyId', 'revision', 'name', 'profile', 'mimeType', 'bytes', 'sha256', 'status', 'createdAt', 'inspection']);
export const caseRecord = object({ id: str, siteId: nullable(str), archived: bool, name: str,
  description: str, frame, revision: integer, createdAt: str, updatedAt: str },
  ['id', 'archived', 'name', 'description', 'frame', 'revision', 'createdAt', 'updatedAt']);
export const processingJob = object({ id: str, caseId: str, sourceId: nullable(str), operation: str,
  status: str, createdAt: str, completedAt: nullable(str), error: nullable(str), inputFingerprint: str },
  ['id', 'caseId', 'sourceId', 'operation', 'status', 'createdAt', 'completedAt', 'error', 'inputFingerprint']);
export const registryDetail = object({ site: registrySite, records: array(registryRecord),
  sources: array(sourceRevision), drafts: array(registryDraft) }, ['site', 'records', 'sources', 'drafts']);
const registryHistory = array(object({ revision: integer, body: registryBody, site_revision: integer,
  created_at: str }, ['revision', 'body', 'site_revision', 'created_at']));
export const registryResolution = object({ record: registryRecord, site: registrySite, history: registryHistory },
  ['record', 'site', 'history']);
export const resolver = { oneOf: [
  object({ kind: { type: 'string', enum: ['site'] }, site: registrySite }, ['kind', 'site']),
  object({ kind: { type: 'string', enum: ['legacy_workspace'] }, siteId: str, workspaceId: str, meaning: str, url: str },
    ['kind', 'siteId', 'workspaceId', 'meaning', 'url']),
  object({ kind: { type: 'string', enum: ['record'] }, record: registryRecord, site: registrySite,
    history: registryHistory, aliasMeaning: str }, ['kind', 'record', 'site', 'history']),
] };
export const registrySearch = array(object({ id: str, identifier: str, site_id: str, alias: str, name: str },
  ['id', 'identifier', 'site_id', 'alias', 'name']));
export const registryQuery = object({ siteId: str, registryRevision: integer, frame, synthetic: bool, mode: str,
  input: { oneOf: [
    object({ mode: { type: 'string', enum: ['point'] }, point }, ['mode', 'point']),
    object({ mode: { type: 'string', enum: ['volume'] }, footprint: ring, lower: num, upper: num }, ['mode', 'footprint', 'lower', 'upper']),
  ] },
  results: array(object({ record: registryRecord, contact: bool, volume: num, overlaps: array(overlap) },
    ['record', 'contact', 'volume', 'overlaps'])) },
  ['siteId', 'registryRevision', 'frame', 'synthetic', 'mode', 'input', 'results']);
export const registryRecordExport = object({ schema: str, ...properties(registryResolution),
  provenance: object({ sources: array(sourceRevision), note: str }, ['sources', 'note']),
  classification: str, classificationBasis: str, limitations: array(str) },
  ['schema', 'record', 'site', 'history', 'provenance', 'classification', 'classificationBasis', 'limitations']);

export const areaGeometry: JsonSchema = object({
  type: { type: 'string', enum: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'] },
  coordinates: { oneOf: [numbers, array(numbers), array(array(numbers)), array(array(array(numbers)))] },
  geometries: { type: 'array', items: { type: 'object', description: 'Recursive AreaGeometry member',
    properties: { type: str, coordinates: { oneOf: [numbers, array(numbers), array(array(numbers)), array(array(array(numbers)))] },
      geometries: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['type'] } },
}, ['type']);
const areaReference = object({ sourceCrs: str, analysisCrs: str, origin: point, anchor: point,
  transformVersion: str, verticalReference: str }, ['sourceCrs', 'analysisCrs', 'origin', 'anchor', 'transformVersion', 'verticalReference']);
const areaHeight = object({ state: str, value: nullable(num), unit: str, meaning: str, reference: str,
  originalValue: anyJson, originalUnit: str, evidence: array(locator), claimId: str, method: str },
  ['state', 'value', 'unit', 'meaning', 'reference']);
export const physicalFeature = object({ id: str, identifier: str, areaId: str, revision: integer,
  sourceRevisionId: str, datasetNamespace: str, evidence: array(locator), representation: str,
  sourceKey: str, name: str, kind: str, sourceGeometry: { type: 'object', additionalProperties: true },
  sourceReference: areaReference, geometry: areaGeometry, geographicGeometry: areaGeometry,
  height: areaHeight, worldStatus: str, properties: { type: 'object', additionalProperties: true },
  areaM2: nullable(num), geometryRole: str,
  semantics: object({ geometryRole: str, evidenceState: str, levelReference: str, sourceDate: str,
    validFrom: str, validTo: str, horizontalUncertaintyM: num, approvalStatus: str, floorCount: integer, assetId: str }),
  verticalExtent: object({ lower: num, upper: num, unit: str, reference: str, evidenceState: str,
    evidence: array(locator) }, ['lower', 'upper', 'unit', 'reference', 'evidenceState', 'evidence']),
  utilityProfile: { type: 'object', additionalProperties: true } },
  ['id', 'identifier', 'areaId', 'revision', 'sourceRevisionId', 'datasetNamespace', 'evidence', 'representation',
    'sourceKey', 'name', 'kind', 'sourceGeometry', 'geometry', 'geographicGeometry', 'height', 'worldStatus', 'properties', 'areaM2']);
export const mapArea = object({ id: str, siteId: str, name: str, revision: integer, reference: nullable(areaReference),
  extent: nullable(numbers), geographicExtent: nullable(numbers),
  administrativeUnits: array(object({ id: str, kind: str, name: str, code: str, authority: str, source: str }, ['id', 'kind', 'name'])),
  dataKind: str, featureCount: integer }, ['id', 'siteId', 'name', 'revision', 'reference', 'extent', 'geographicExtent', 'administrativeUnits']);
export const areaFinding = object({ id: str, category: str, code: str, message: str, featureIds: array(str),
  areaM2: num, volumeM3: num, geometry: areaGeometry, geographicGeometry: areaGeometry,
  participants: array(physicalFeature), method: str,
  inputRevisions: array(object({ featureId: str, revision: integer, sourceRevisionId: str },
    ['featureId', 'revision', 'sourceRevisionId'])),
  evidence: array(locator), quantities: { type: 'object', additionalProperties: num }, limitations: array(str) },
  ['id', 'category', 'code', 'message', 'featureIds']);
const findingQualification = object({ state: str, missing: array(object({ findingId: str,
  participantId: nullable(str), reason: str }, ['findingId', 'participantId', 'reason'])) }, ['state', 'missing']);
const historicalFindings = object({ purpose: str, currentAnalyticalEligibility: bool, findings: array(areaFinding) },
  ['purpose', 'currentAnalyticalEligibility', 'findings']);
const areaCheck = object({ id: str, areaId: str, areaRevision: integer, status: str, findings: array(areaFinding),
  coverage: array(str), inputFingerprint: str, createdAt: str, stale: bool, error: str },
  ['id', 'areaId', 'areaRevision', 'status', 'findings', 'coverage', 'inputFingerprint', 'createdAt']);
const dossierSource = object({ id: str, name: str, sha256: str, revision: integer, profile: str,
  createdAt: str, url: str, evidence: array(locator) }, ['id', 'name', 'sha256', 'revision', 'profile', 'createdAt', 'url', 'evidence']);
export const association = object({ id: str, revision: integer, fromId: str, toId: str, relationship: str,
  status: str, evidence: array(locator), reason: str, actor: str, updatedAt: str, fromRevision: integer, toRevision: integer },
  ['id', 'revision', 'fromId', 'toId', 'relationship', 'status', 'evidence', 'reason', 'actor', 'updatedAt', 'fromRevision', 'toRevision']);
export const blockGroup = object({ id: str, areaId: str, name: str, revision: integer, kind: str,
  boundary: areaGeometry, geographicBoundary: areaGeometry, authority: str, code: str,
  evidence: array(locator), featureIds: array(str) },
  ['id', 'areaId', 'name', 'kind', 'boundary', 'geographicBoundary', 'evidence', 'featureIds']);
const placement = object({ id: str, revision: integer, sourceFrame: str, targetFrame: str, method: str,
  matrix: numbers, verticalReference: str, verticalOffset: nullable(num), sourceVerticalReference: str,
  evidence: array(locator), status: str, controlPoints: array(object({ source: point, target: point }, ['source', 'target'])) },
  ['id', 'revision', 'sourceFrame', 'targetFrame', 'method', 'matrix', 'verticalReference', 'verticalOffset', 'evidence', 'status']);
export const preparationCase = object({ id: str, buildingId: str, areaId: str, caseId: str, packageId: str,
  revision: integer, buildingRevision: integer, placement, url: str, returnUrl: str },
  ['id', 'buildingId', 'areaId', 'caseId', 'packageId', 'revision', 'buildingRevision', 'placement', 'url', 'returnUrl']);
export const continuation = object({ packageRevision: integer, preparationRevision: integer, caseRevision: integer,
  status: str, spaceCount: integer, job: nullable(processingJob), review: nullable(registryReview) },
  ['packageRevision', 'preparationRevision', 'caseRevision', 'status', 'spaceCount', 'job', 'review']);
export const requirements = object({ footprint: array(str), exterior: array(str), detailedSpaces: array(str),
  placement: array(str), utility: array(str) }, ['footprint', 'exterior', 'detailedSpaces', 'placement', 'utility']);
export const importPackage = object({ id: str, schemaVersion: str, areaId: str, name: str, datasetNamespace: str,
  revision: integer, state: str, sourceRevisionIds: array(str), features: array(physicalFeature),
  questions: array(object({ id: str, entityId: str, property: str, message: str, blocks: str, kind: str,
    answer: object({ choice: str, value: num, reason: str, claimId: str }, ['choice', 'reason']) },
    ['id', 'entityId', 'property', 'message', 'blocks'])),
  factCandidates: array(object({ id: str, entityId: str, subject: str, property: str, value: anyJson,
    unit: str, referenceFrameId: str, evidence: array(locator), evidenceState: str, worldStatus: str, method: str },
    ['id', 'entityId', 'property', 'value', 'evidence', 'evidenceState', 'worldStatus', 'method'])),
  parts: array(documentPart), warnings: array(str), createdAt: str, acknowledgement: str,
  selectedClaimIds: array(str), factDecisions: array(object({ claimId: str, reason: str, time: str, actor: str },
    ['claimId', 'reason', 'time', 'actor'])),
  sourceWorkspace: object({ caseId: str, frame, worldStatus: str, areaReferenceFingerprint: str },
    ['caseId', 'frame', 'worldStatus', 'areaReferenceFingerprint']),
  review: object({ areaRevision: integer, packageRevision: integer, inputFingerprint: str,
    findings: array(areaFinding), coverage: array(str) }, ['areaRevision', 'packageRevision', 'inputFingerprint', 'findings', 'coverage']) },
  ['id', 'schemaVersion', 'areaId', 'name', 'datasetNamespace', 'revision', 'state', 'sourceRevisionIds', 'features',
    'questions', 'factCandidates', 'parts', 'warnings', 'createdAt']);
const detailedScene = array(object({ record: registryRecord, geographicGeometry: areaGeometry, localGeometry: areaGeometry,
  lower: num, upper: num, verticalReference: str }, ['record']));
const parcelIdentifier = object({ parcelId: str, scheme: str, value: str, issuer: str,
  evidence: object({ sourceRevisionId: str, locator: str }) }, ['parcelId', 'scheme', 'value', 'issuer', 'evidence']);
const parcels = array(object({ feature: physicalFeature, association, status: str }, ['feature', 'status']));
const registerSnapshot = object({ building: physicalFeature, area: mapArea, records: array(registryRecord),
  detailedScene, sources: array(dossierSource), associations: array(association), parcels,
  parcelIdentifiers: array(parcelIdentifier), missing: array(str) },
  ['building', 'area', 'records', 'detailedScene', 'sources', 'associations', 'parcels', 'missing']);
export const investigation = object({ id: str, revision: integer, buildingId: str, areaId: str, reference: str,
  status: str, classification: str, notes: str, nextAction: str,
  inputSnapshot: object({ areaRevision: integer, featureRevision: integer, checkId: str, fingerprint: str },
    ['areaRevision', 'featureRevision', 'fingerprint']),
  registerSnapshot, findings: array(areaFinding), evidence: array(locator),
  requests: array(object({ id: str, question: str, status: str, response: str, evidence: array(locator),
    createdAt: str, answeredAt: str }, ['id', 'question', 'status', 'evidence', 'createdAt'])),
  history: array(object({ actor: str, time: str, reason: str, status: str }, ['actor', 'time', 'reason', 'status'])),
  createdAt: str, updatedAt: str, analysisState: str, findingQualification, historicalFindings },
  ['id', 'revision', 'buildingId', 'areaId', 'reference', 'status', 'classification', 'notes', 'nextAction',
    'inputSnapshot', 'findings', 'evidence', 'requests', 'history', 'createdAt', 'updatedAt']);
export const dossier = object({ ...properties(registerSnapshot), canonicalBuildingId: str,
  representations: array(physicalFeature), groups: array(blockGroup), preparations: array(preparationCase),
  packages: array(importPackage), issues: array(areaFinding), investigations: array(investigation),
  revisions: object({ feature: integer, area: integer, registry: integer }, ['feature', 'area', 'registry']),
  check: object({ id: str, areaRevision: integer, stale: bool }, ['id', 'areaRevision', 'stale']),
  findingQualification, historicalFindings },
  [...registerSnapshot.required as string[], 'canonicalBuildingId', 'representations', 'groups', 'preparations', 'packages',
    'issues', 'investigations', 'revisions', 'findingQualification']);
export const preparedDetailsReceipt = object({ caseId: str, package: importPackage, job: processingJob,
  preparation: preparationCase, cached: bool }, ['caseId', 'package', 'job', 'preparation']);
export const workQueue = object({ total: integer, page: integer, pageSize: integer,
  items: array(object({ id: str, kind: str, name: str, areaId: nullable(str), areaName: nullable(str),
    dataKind: nullable(str), buildingId: nullable(str), sourceCount: integer, updatedAt: str,
    state: nullable(str), jobStatus: nullable(str), recordedHistory: bool, currentRecorded: bool,
    provenance: object({ classification: str, basis: str }, ['classification', 'basis']) },
    ['id', 'kind', 'name', 'areaId', 'areaName', 'dataKind', 'buildingId', 'sourceCount', 'updatedAt',
      'state', 'jobStatus', 'recordedHistory', 'provenance'])) }, ['total', 'page', 'pageSize', 'items']);
export const revisions = object({ featureId: str, currentRevision: integer,
  revisions: array(object({ revision: integer, createdAt: str, areaRevision: integer,
    packageId: nullable(str), body: physicalFeature }, ['revision', 'createdAt', 'areaRevision', 'packageId', 'body'])),
  nextBefore: nullable(integer), scope: str }, ['featureId', 'currentRevision', 'revisions', 'nextBefore', 'scope']);
export const propertyDirectory = array(object({ buildingId: str, spaces: integer, floors: integer }, ['buildingId', 'spaces', 'floors']));
export const workspaceDirectory = array(object({ id: str, name: str, revision: integer, updatedAt: str,
  buildingId: nullable(str), areaId: nullable(str), propertyName: nullable(str), sourceCount: integer },
  ['id', 'name', 'revision', 'updatedAt', 'buildingId', 'areaId', 'propertyName', 'sourceCount']));
const geometryQualification = object({ state: str, purpose: str, missing: array(object({
  ref: object({ namespace: str, id: str }, ['namespace', 'id']), revision: integer }, ['ref', 'revision'])) },
  ['state', 'purpose', 'missing']);
const sanitizedRecord = object({ id: str, identifier: str, ulpin3d: str, name: str, kind: str,
  revision: integer, use: str, footprint: ring, geometry: unitGeometry, links: array(registryLink), evidence: array(sourceBinding) },
  ['id', 'identifier', 'ulpin3d', 'name', 'kind', 'revision', 'footprint', 'links', 'evidence']);
export const propertyRegisterExport = object({ schemaVersion: str, exportedAt: str,
  property: object({ id: str, identifier: str, ulpin3d: str, name: str, revision: integer, geometryRole: str,
    worldStatus: str, geometry: areaGeometry, geographicGeometry: areaGeometry, height: areaHeight },
    ['id', 'identifier', 'ulpin3d', 'name', 'revision', 'geometryRole', 'worldStatus', 'geometry', 'height']),
  area: mapArea, associations: array(association), parcelIdentifiers: array(parcelIdentifier),
  register: array(sanitizedRecord), sources: array(dossierSource), missing: array(str),
  selection: object({ id: str, kind: str, name: str, ulpin3d: str }, ['id', 'kind', 'name', 'ulpin3d']),
  ulpin3d: str, buildingUlpin3d: str, findingsScope: str, geometryQualification,
  findings: array(areaFinding), findingQualification, historicalFindings, investigation, scope: str },
  ['schemaVersion', 'exportedAt', 'property', 'area', 'associations', 'parcelIdentifiers', 'register', 'sources', 'missing',
    'selection', 'ulpin3d', 'buildingUlpin3d', 'findingsScope', 'geometryQualification', 'findings', 'findingQualification', 'scope']);
export const blockRegisterExport = object({ schemaVersion: str, exportedAt: str, scope: str, ulpin3d: str,
  area: mapArea, parcelIdentifiers: array(parcelIdentifier), features: array(physicalFeature),
  properties: array(propertyRegisterExport), sources: array(dossierSource), geometryQualification,
  check: areaCheck, findingQualification,
  historicalCheck: object({ purpose: str, currentAnalyticalEligibility: bool, check: areaCheck },
    ['purpose', 'currentAnalyticalEligibility', 'check']), note: str },
  ['schemaVersion', 'exportedAt', 'scope', 'ulpin3d', 'area', 'parcelIdentifiers', 'features', 'properties',
    'sources', 'geometryQualification', 'findingQualification', 'note']);
export const idEnvelope = object({ id: str }, ['id']);
export const draftIdEnvelope = object({ draftId: str }, ['draftId']);
export const importedDraftEnvelope = object({ draftId: str, siteId: str }, ['draftId', 'siteId']);
