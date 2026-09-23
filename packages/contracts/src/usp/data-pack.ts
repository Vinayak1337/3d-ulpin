import { z } from 'zod';
import { CoreIdSchema, CorePositiveRevisionSchema, CoreSafeIntegerSchema, CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { CoreAssetSchema, CoreDatasetSchema } from '../spatial/core/source-schema';

/** Dataset preparation contract, not the application's normalized property schema. */
export const USP_DATA_PACK_SCHEMA = 'usp-data-pack/1' as const;
export const UspRelativeAssetPathSchema = coreText(512).refine(path => {
  if (path.startsWith('/') || path.includes('\\') || path.includes(':')) return false;
  return path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}, 'Expected a contained relative file path');
export const UspVerificationStageSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not_run') }).readonly(),
  z.strictObject({ status: z.literal('passed'), evidenceRef: coreText(512) }).readonly(),
  z.strictObject({ status: z.literal('failed'), reason: coreText(1024), evidenceRef: coreText(512) }).readonly(),
  z.strictObject({ status: z.literal('not_applicable'), reason: coreText(1024) }).readonly(),
]);
const stages = z.strictObject({
  catalogue_checked: UspVerificationStageSchema,
  bytes_preserved: UspVerificationStageSchema,
  parsed: UspVerificationStageSchema,
  rendered: UspVerificationStageSchema,
  workflow_verified: UspVerificationStageSchema,
}).readonly();
const origin = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('authored'), generatorRef: coreText(512) }).readonly(),
  z.strictObject({ kind: z.literal('external'), url: z.string().max(2048).url().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
    } catch { return false; }
  }, 'Expected public HTTPS source URL without credentials or fragment') }).readonly(),
  z.strictObject({ kind: z.literal('supplied'), reference: coreText(512) }).readonly(),
]);
const bytes = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('available'), path: UspRelativeAssetPathSchema,
    sha256: CoreSha256Schema, bytes: CoreSafeIntegerSchema }).readonly(),
  z.strictObject({ state: z.literal('unavailable'), reason: coreText(1024) }).readonly(),
]);
const permission = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('documented'), reference: coreText(512),
    permittedUses: z.array(z.enum(['research', 'demo', 'redistribution'])).min(1).max(3).readonly() }).readonly(),
  z.strictObject({ state: z.literal('unconfirmed'), reason: coreText(1024) }).readonly(),
]);
export const UspPackAssetSchema = z.strictObject({
  id: CoreIdSchema, mediaType: CoreAssetSchema.unwrap().shape.mediaType,
  classification: CoreDatasetSchema.unwrap().shape.classification,
  origin, sourceVersion: coreText(256).nullable(), attribution: coreText(2048).nullable(), permission,
  // Missing metadata has no automatic metre, datum, date or authority default.
  reference: z.strictObject({ horizontalCrs: coreText(512).nullable(), verticalReference: coreText(512).nullable(),
    horizontalUnit: coreText(64).nullable(), verticalUnit: coreText(64).nullable(), sourceDate: coreText(128).nullable(),
  }).readonly(),
  content: bytes, dependencies: z.array(CoreIdSchema).max(100).readonly(), verification: stages,
}).superRefine((asset, ctx) => {
  const checks = asset.verification;
  const passed = (key: keyof typeof checks) => checks[key].status === 'passed';
  if (asset.content.state === 'unavailable' && ['bytes_preserved', 'parsed', 'rendered', 'workflow_verified'].some(key => passed(key as keyof typeof checks))) {
    ctx.addIssue({ code: 'custom', path: ['verification'], message: 'Unavailable bytes cannot qualify downstream stages' });
  }
  if ((passed('parsed') || passed('rendered') || passed('workflow_verified')) && !passed('bytes_preserved')) {
    ctx.addIssue({ code: 'custom', path: ['verification'], message: 'Downstream qualification needs preserved-byte evidence' });
  }
  // A source-only document can pass its workflow without rendering; no forced spatial claim.
  if ((passed('rendered') || passed('workflow_verified')) && !passed('parsed')) {
    ctx.addIssue({ code: 'custom', path: ['verification'], message: 'Rendered/workflow qualification needs parsing evidence' });
  }
  if (new Set(asset.dependencies).size !== asset.dependencies.length || asset.dependencies.includes(asset.id)) {
    ctx.addIssue({ code: 'custom', path: ['dependencies'], message: 'Duplicate or self dependency' });
  }
}).readonly();

export const UspDataPackSchema = z.strictObject({
  schemaVersion: z.literal(USP_DATA_PACK_SCHEMA), packId: z.enum(['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']),
  version: CorePositiveRevisionSchema, profile: CoreIdSchema, description: coreText(2048),
  assets: z.array(UspPackAssetSchema).min(1).max(100).readonly(),
  expectedPath: UspRelativeAssetPathSchema,
  expectedCapabilities: z.array(coreText(128)).min(1).max(64).readonly(),
  missingCapabilities: z.array(coreText(128)).max(64).readonly(),
}).superRefine((pack, ctx) => {
  const ids = new Set(pack.assets.map(asset => asset.id));
  if (ids.size !== pack.assets.length) ctx.addIssue({ code: 'custom', path: ['assets'], message: 'Duplicate asset identity' });
  const paths = pack.assets.flatMap(asset => asset.content.state === 'available' ? [asset.content.path] : []);
  if (new Set(paths).size !== paths.length) ctx.addIssue({ code: 'custom', path: ['assets'], message: 'Duplicate local asset path' });
  if (!paths.includes(pack.expectedPath)) ctx.addIssue({ code: 'custom', path: ['expectedPath'], message: 'Expected results must be a declared hash-pinned asset' });
  for (const [index, asset] of pack.assets.entries()) {
    if (asset.dependencies.some(id => !ids.has(id))) ctx.addIssue({ code: 'custom', path: ['assets', index, 'dependencies'], message: 'Undeclared dependency; declare a missing asset explicitly' });
    if (pack.packId === 'D0' && asset.classification !== 'synthetic') ctx.addIssue({ code: 'custom', path: ['assets', index, 'classification'], message: 'D0 assets must remain synthetic' });
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const byId = new Map(pack.assets.map(asset => [asset.id, asset]));
  function visit(id: string): boolean {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const child of byId.get(id)?.dependencies ?? []) if (!visit(child)) return false;
    visiting.delete(id); visited.add(id); return true;
  }
  if (pack.assets.some(asset => !visit(asset.id))) ctx.addIssue({ code: 'custom', path: ['assets'], message: 'Cyclic asset dependencies' });
  if (new Set(pack.expectedCapabilities).size !== pack.expectedCapabilities.length
    || new Set(pack.missingCapabilities).size !== pack.missingCapabilities.length
    || pack.expectedCapabilities.some(value => pack.missingCapabilities.includes(value))) {
    ctx.addIssue({ code: 'custom', path: ['expectedCapabilities'], message: 'Duplicate or contradictory capability declarations' });
  }
}).readonly();
export type UspDataPack = z.infer<typeof UspDataPackSchema>;
