import { z } from 'zod';

const reason = z.enum(['case_advanced', 'reader_changed', 'policy_changed', 'source_superseded']);

/** Freshness of a document result retained beside an original, stated on a read or a capture of what is recorded.
 * It never changes the retained result and never grants authority to derive or write under moved-on pins. */
export const RetainedDocumentFreshnessSchema = z.strictObject({
  current: z.boolean(),
  reasons: z.array(reason).max(4).readonly(),
}).readonly();
export type RetainedDocumentFreshness = z.infer<typeof RetainedDocumentFreshnessSchema>;
