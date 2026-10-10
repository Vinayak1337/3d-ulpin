import { z } from 'zod';

/** All retained table sources of a case, newest first; non-case work rows carry an empty list. */
export const WorkQueueTableSourcesSchema = z.strictObject({ tableSourceIds: z.array(z.uuid()).optional() });
export type WorkQueueTableSources = z.infer<typeof WorkQueueTableSourcesSchema>;
