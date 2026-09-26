import { z } from 'zod';
import { frameSchema, idSchema } from '../../infrastructure/validation';
import { editDraftSchema, querySchema, recordBodySchema } from './registry';
const uuid = idSchema;
const revision = z.number().int().nonnegative();

export const registryImportInput = z.object({
  caseId: uuid, expectedRevision: revision, destination: z.literal('separate-site'),
}).strict();
export const createSiteInput = z.object({
  name: z.string().trim().min(1).max(100), frame: frameSchema.strict(),
  synthetic: z.boolean().default(true),
}).strict();
export const createDraftInput = z.object({
  recordId: uuid.optional(), body: recordBodySchema.optional(), requestKey: uuid.optional(),
}).strict();
export const importSiteInput = z.object({ caseId: uuid, expectedRevision: revision }).strict();
export const reviewDraftInput = z.object({
  expectedRevision: z.number().int().positive(), expectedSiteRevision: revision,
}).strict();
export const commitReviewInput = z.object({ acknowledgement: z.string().max(2000).default('') }).strict();
export { editDraftSchema, querySchema };

