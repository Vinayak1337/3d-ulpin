import { z } from 'zod';
import type { ImportPackage, PhysicalFeature } from '../area';

const id = z.string().uuid();
const text = z.string().trim().min(1).max(500);
const citation = z.strictObject({
  documentKey: text,
  page: z.number().int().positive().max(10000),
  locator: text,
  quote: text.optional(),
});

/** Original-backed human transcriptions, not extracted facts or analytical geometry. */
export const SourceBuildingImportSchema = z.strictObject({
  format: z.literal('document_buildings'),
  requestKey: id,
  namespace: z.string().trim().min(1).max(150),
  name: z.string().trim().min(1).max(150),
  areaId: id.optional(),
  expectedAreaRevision: z.number().int().nonnegative().optional(),
  documents: z.array(z.strictObject({
    key: text,
    filename: text,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    originalUrl: z.string().url().max(2000),
    issuer: text,
    acquiredAt: z.string().min(1).max(100),
    permission: z.literal('unconfirmed'),
    classification: z.literal('test_only'),
  })).min(1).max(8),
  buildings: z.array(z.strictObject({
    sourceKey: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    geometry: z.null(),
    footprint: z.null(),
    placement: z.literal('unknown'),
    worldStatus: z.enum(['observed', 'planned']),
    citations: z.array(citation).min(1).max(20),
    claims: z.array(z.strictObject({
      property: z.enum(['building.storeyLabel', 'building.storeyCount', 'building.floorCount']),
      value: z.union([text, z.number().int().nonnegative()]),
      method: z.literal('source_literal'),
      citations: z.array(citation).min(1).max(20),
    })).max(30),
  })).min(1).max(100),
}).superRefine((input, ctx) => {
  const keys = new Set(input.documents.map(document => document.key));
  if (keys.size !== input.documents.length) {
    ctx.addIssue({ code: 'custom', message: 'Document keys must be distinct.' });
  }
  if (new Set(input.buildings.map(building => building.sourceKey)).size !== input.buildings.length) {
    ctx.addIssue({ code: 'custom', message: 'Building source keys must be distinct.' });
  }
  for (const building of input.buildings) {
    const citations = [...building.citations, ...building.claims.flatMap(claim => claim.citations)];
    if (citations.some(entry => !keys.has(entry.documentKey))) {
      ctx.addIssue({ code: 'custom', message: 'Every citation must name an attached original.' });
    }
  }
  if (input.areaId && input.expectedAreaRevision === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Pin the destination area revision.' });
  }
});
export type SourceBuildingImport = z.infer<typeof SourceBuildingImportSchema>;
export type SourceBuildingFeature = Omit<
  PhysicalFeature, 'geometry' | 'geographicGeometry' | 'sourceGeometry'
> & { geometry: null; geographicGeometry: null; sourceGeometry: null; placement: 'unknown' };
export type SourceBuildingPackage = Omit<ImportPackage, 'features'> & {
  geometryFree: true;
  features: SourceBuildingFeature[];
  documentPins: { sourceId: string; sourceRevision: number; sourceSha256: string }[];
  sourceMetadata: SourceBuildingImport['documents'];
};
