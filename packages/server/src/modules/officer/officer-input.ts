import { z } from 'zod';
import { idSchema } from '../../infrastructure/validation';
import { factProperties } from './officer-preparation';

export const uuid = idSchema;
export const revision = z.number().int().nonnegative();
export const label = z.string().trim().min(1).max(200);
export const reason = z.string().trim().min(1).max(2000);
export const locator = z.object({
  sourceRevisionId: uuid,
  partId: uuid.optional(),
  featureId: z.string().max(150).optional(),
  page: z.number().int().positive().optional(),
  row: z.number().int().positive().optional(),
  jsonPointer: z.string().max(500).optional(),
  region: z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().positive().max(1), height: z.number().positive().max(1),
    unit: z.literal('normalized'),
  }).optional(),
}).strict();
export const evidence = z.array(locator).min(1).max(30);
const point = z.tuple([
  z.number().finite().min(-1e7).max(1e7),
  z.number().finite().min(-1e7).max(1e7),
]);

export const openPreparationInput = z.object({ expectedRevision: revision, requestKey: uuid }).strict();
export const detailReviewInput = z.object({ expectedRevision: revision }).strict();
export const associationInput = z.object({
  id: uuid.optional(), fromId: uuid, toId: uuid,
  relationship: z.enum(['occupies_parcel', 'representation_of', 'detailed_record', 'shared_space']),
  status: z.enum(['suggested', 'confirmed', 'rejected']),
  expectedRevision: revision, expectedFromRevision: revision, expectedToRevision: revision,
  evidence, reason,
}).strict();
export const blockGroupInput = z.object({
  areaId: uuid, name: label,
  kind: z.enum(['analysis_extent', 'layout_block', 'development_block', 'ward', 'locality']),
  authority: label.optional(), code: label.optional(),
  boundary: z.unknown().describe('GeoJSON polygon or multipolygon; validity is checked by PostGIS'),
  evidence, featureIds: z.array(uuid).min(1).max(2000), expectedRevision: revision,
}).strict();
export const preparationFactInput = z.object({
  expectedRevision: revision, entityId: uuid.optional(),
  subject: z.string().trim().min(1).max(60).optional(),
  property: z.enum(factProperties), value: z.unknown(),
  unit: label.optional(), referenceFrameId: label.optional(), evidence,
}).strict();
export const resolveFactInput = z.object({ expectedRevision: revision, claimId: uuid, reason }).strict();
export const placementInput = z.object({
  expectedRevision: revision, sourceFrame: label, verticalReference: label,
  sourceVerticalReference: label.optional(),
  verticalOffset: z.number().finite().min(-10000).max(10000),
  controlPoints: z.array(z.object({ source: point, target: point })).length(2).optional(),
  evidence, reason,
}).strict();
export const prepareDetailsInput = z.object({ expectedRevision: revision }).strict();
export const createInvestigationInput = z.object({
  buildingId: uuid, expectedRevision: revision, requestKey: uuid.optional(),
  reference: label, classification: label, checkId: uuid.optional(),
  findingIds: z.array(uuid).max(200).optional(), notes: z.string().max(10000).optional(),
}).strict();
export const investigationStatus = z.enum(['OPEN', 'NEEDS_EVIDENCE', 'READY_FOR_REVIEW', 'REVIEWED', 'CLOSED']);
export const updateInvestigationInput = z.object({
  expectedRevision: revision, status: investigationStatus.optional(),
  notes: z.string().max(10000).optional(), nextAction: reason.optional(), reason,
}).strict();
export const investigationRequestInput = z.object({ expectedRevision: revision, question: reason }).strict();
export const answerInvestigationInput = z.object({
  expectedRevision: revision, response: reason, evidence: z.array(locator).max(30).optional(),
}).strict();
