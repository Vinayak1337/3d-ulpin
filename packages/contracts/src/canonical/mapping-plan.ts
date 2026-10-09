import {z} from 'zod';
import {MappingTargetSchema} from './targets';

export const MAPPING_PLAN_V2_VERSION='mapping-plan/2' as const;
export const MappingSourceKindSchema=z.enum(['tabular','gis_attributes']);
export const MappingInferredTypeSchema=z.enum(['text','number','date','boolean','geometry','object','array','mixed','unknown']);
export const MappingSourceUnitSchema=z.enum(['m2','ft2','sq_yd','gaj','marla','bigha','kanal','cent','guntha','m','ft','count']);
export const MappingLiteralKindSchema=z.enum(['text_literal','number','date_dmy','date_iso']);
/** Only versioned, code-owned lookup tables; plans cannot carry enum entries. */
export const MappingEnumTableIdSchema=z.enum(['building_use@1','unit_type@1','level_kind@1','space_kind@1','document_status@1']);
export const MappingSourceFieldSchema=z.string().min(1).max(512);
export const MappingV2OperationSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('copy')}),
  z.strictObject({kind:z.literal('enum_lookup'),tableId:MappingEnumTableIdSchema}),
  z.strictObject({kind:z.literal('unit_convert'),sourceUnit:MappingSourceUnitSchema}),
  z.strictObject({kind:z.literal('parse_literal'),literalKind:MappingLiteralKindSchema}),
  z.strictObject({kind:z.literal('link_parent_key'),parentField:MappingSourceFieldSchema}),
]);
export const MappingMethodSchema=z.string().max(300).regex(/^(?:(?:model|learner):[^\s:@]+@[^\s:@]+|reviewer:[^\s:]+|memory:[^\s:]+)$/);
/** Zero-based logical data-row/feature index; CSV headers are excluded. */
export const MappingCellCitationSchema=z.strictObject({sourceRef:z.string().min(1).max(2048),
  row:z.number().int().nonnegative(),column:MappingSourceFieldSchema});
export const MappingV2FieldSchema=z.strictObject({sourceField:MappingSourceFieldSchema,target:MappingTargetSchema,
  operation:MappingV2OperationSchema,confidence:z.number().min(0).max(1),rationale:z.string().min(1).max(2000),
  citations:z.array(MappingCellCitationSchema).max(20).optional()});
/** Explanation/citations are inert metadata. Executable parameters contain only closed tokens or inventory references. */
export const MappingPlanV2Schema=z.strictObject({version:z.literal(MAPPING_PLAN_V2_VERSION),
  layoutFingerprint:z.string().regex(/^[a-f0-9]{64}$/),sourceKind:MappingSourceKindSchema,method:MappingMethodSchema,
  fields:z.array(MappingV2FieldSchema).min(1).max(256)});
export const MappingLayoutFieldSchema=z.strictObject({name:MappingSourceFieldSchema,inferredType:MappingInferredTypeSchema,
  declaredUnit:MappingSourceUnitSchema.optional()});
export const CanonicalMappedValueSchema=z.strictObject({value:z.union([z.string(),z.number().finite(),z.record(z.string(),z.unknown()),z.null()]),
  state:z.enum(['unknown','absent','null','withheld','conflicting','estimated','candidate','source_supported','reviewed','needs_input']),
  unit:z.enum(['m2','m','count']).optional(),citations:z.array(MappingCellCitationSchema).min(1),
  method:z.string().min(1),literal:z.unknown().optional(),issueCode:z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  conversionSource:z.string().url().optional(),sourceCrs:z.string().min(1).optional()});
const profileRate=z.number().min(0).max(1);
/** A derivative-only profile. No source paths, coordinates, raw rows or provenance secrets. */
export const ColumnProfileSchema=z.strictObject({
  name:MappingSourceFieldSchema,inferredType:MappingInferredTypeSchema,declaredUnit:MappingSourceUnitSchema.optional(),
  valueShapes:z.strictObject({dateDmyRate:profileRate,dateIsoRate:profileRate,lakhGroupingRate:profileRate,
    devanagariDigitRate:profileRate,khasraLikeRate:profileRate,floorLabelRate:profileRate,
    nullRate:profileRate,blankRate:profileRate,distinctRatio:profileRate}),
  // Do not pad small inputs with fabricated examples: fewer than five observed cells is explicit.
  maskedSamples:z.array(z.string().max(256)).max(20),
});
export const ColumnProfileDocumentSchema=z.strictObject({version:z.literal('column-profile/1'),
  sourceKind:MappingSourceKindSchema,layoutFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  columns:z.array(ColumnProfileSchema).min(1).max(256),sampleShortfall:z.boolean()});
export type ColumnProfile=z.infer<typeof ColumnProfileSchema>;
export type ColumnProfileDocument=z.infer<typeof ColumnProfileDocumentSchema>;
export type MappingPlanV2=z.infer<typeof MappingPlanV2Schema>;
export type MappingV2Operation=z.infer<typeof MappingV2OperationSchema>;
export type MappingLayoutField=z.infer<typeof MappingLayoutFieldSchema>;
export type MappingCellCitation=z.infer<typeof MappingCellCitationSchema>;
export type CanonicalMappedValue=z.infer<typeof CanonicalMappedValueSchema>;
