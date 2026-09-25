import { z } from 'zod';
import { UspSnapshotScopeSchema, UspTargetPinSchema } from './common';

/** P3-CJ/1 is a private, read-only exchange of an exact recorded snapshot. */
export const UspExchangeExportSchema = z.strictObject({
  scope: UspSnapshotScopeSchema,
  targets: z.array(UspTargetPinSchema).min(1).max(100),
  licenceFamily: z.string().trim().min(1).max(120).nullable(),
  distribution: z.literal('private'),
});
export const UspExchangeCompareSchema = z.strictObject({
  scope: UspSnapshotScopeSchema,
  cityJson: z.record(z.string(), z.unknown()),
  sidecar: z.record(z.string(), z.unknown()).nullable(),
});
export type UspExchangeExport = z.infer<typeof UspExchangeExportSchema>;
export type UspExchangeCompare = z.infer<typeof UspExchangeCompareSchema>;
