import {z} from "zod";
import {CoreIdSchema,CorePositiveRevisionSchema,CoreRefSchema,CoreRevisionRefSchema,CoreSafeIntegerSchema,CoreSha256Schema,coreText} from "./scalars";

const typedRef=<N extends string>(namespace:N)=>z.strictObject({namespace:z.literal(namespace),id:CoreIdSchema}).readonly();
const versionRef=<N extends string>(namespace:N)=>z.strictObject({ref:typedRef(namespace),revision:CorePositiveRevisionSchema}).readonly();
export const CoreAccessSchema=z.enum(["public","operator","restricted"]);
export const CoreDatasetSchema=z.strictObject({
  ref:typedRef("dataset"),revision:CorePositiveRevisionSchema,label:coreText(512),
  classification:z.enum(["observed","planned","hypothetical","synthetic","unknown"]),
  attribution:coreText(2048).nullable(),license:coreText(512).nullable(),access:CoreAccessSchema,
}).readonly();
export const CoreAssetSchema=z.strictObject({
  ref:typedRef("asset"),revision:CorePositiveRevisionSchema,kind:z.enum(["original","derived"]),
  mediaType:z.string().min(3).max(255).regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?: *;[^\u0000-\u001f\u007f]*)?(?![\s\S])/),
  sha256:CoreSha256Schema.nullable(),bytes:CoreSafeIntegerSchema.nullable(),
  storage:z.discriminatedUnion("state",[
    z.strictObject({state:z.literal("registered"),blobRef:typedRef("source_blob")}).readonly(),
    z.strictObject({state:z.literal("unavailable"),reason:coreText(1024)}).readonly(),
  ]),
  integrity:z.literal("metadata_only"),
  access:CoreAccessSchema,retention:z.strictObject({policy:z.enum(["preserve_original","managed_derivative"]),legalHold:z.boolean().nullable()}).readonly(),
  parentAssets:z.array(versionRef("asset")).max(64).readonly(),
}).readonly();
export const CoreSourceRevisionSchema=z.strictObject({
  ref:typedRef("source_revision"),revision:CorePositiveRevisionSchema,
  family:typedRef("source_family").nullable(),familyOrdinal:CorePositiveRevisionSchema.nullable(),
  label:coreText(512),profile:CoreIdSchema,method:z.enum(["source","manual","derived","synthetic","unknown"]),
  dataset:versionRef("dataset").nullable(),assets:z.array(versionRef("asset")).max(64).readonly(),
  workflows:z.array(CoreRefSchema).max(256).readonly(),access:CoreAccessSchema,
}).readonly();
export const CoreNormalizedRegionSchema=z.strictObject({
  x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1),unit:z.literal("normalized"),
}).readonly();
const range=z.strictObject({start:CorePositiveRevisionSchema,end:CorePositiveRevisionSchema}).readonly();
const pointer=z.string().max(4096).regex(/^(?:\/(?:[^~]|~[01])*)*(?![\s\S])/);
export const CoreLocatorSchema=z.discriminatedUnion("kind",[
  z.strictObject({kind:z.literal("whole_asset")}).readonly(),
  z.strictObject({kind:z.literal("feature"),featureId:coreText(512),layer:coreText(256).optional()}).readonly(),
  z.strictObject({kind:z.literal("page"),page:CorePositiveRevisionSchema,region:CoreNormalizedRegionSchema.optional()}).readonly(),
  z.strictObject({kind:z.literal("image_region"),region:CoreNormalizedRegionSchema}).readonly(),
  z.strictObject({kind:z.literal("rows"),range}).readonly(),
  z.strictObject({kind:z.literal("lines"),range}).readonly(),
  z.strictObject({kind:z.literal("json_pointer"),pointer}).readonly(),
  z.strictObject({kind:z.literal("model_element"),elementId:coreText(512),elementType:CoreIdSchema}).readonly(),
  z.strictObject({kind:z.literal("verbatim"),locator:z.string().min(1).max(4096)}).readonly(),
]);
export const CoreSourcePartSchema=z.strictObject({
  ref:typedRef("source_part"),revision:CorePositiveRevisionSchema,source:versionRef("source_revision"),
  asset:versionRef("asset").nullable(),
  locators:z.array(CoreLocatorSchema).min(1).max(8).readonly(),access:CoreAccessSchema,
}).readonly();
export const CORE_EVIDENCE_POLICY={
  inheritedPurposes:["context","record"],inheritanceRelations:["part_of","occupies_level"],
  preciseLocators:["feature","page","image_region","rows","lines","json_pointer","model_element"],
  exactPurposes:["geometry","levels"],normalizedTolerance:1e-12,
} as const;
export const CoreEvidenceLinkSchema=z.strictObject({
  ref:typedRef("evidence_link"),revision:CorePositiveRevisionSchema,target:CoreRefSchema,part:versionRef("source_part"),
  purpose:z.enum(["context","geometry","levels","record","appearance"]),state:z.enum(["active","unlinked"]),
  inheritance:z.discriminatedUnion("kind",[
    z.strictObject({kind:z.literal("direct")}).readonly(),
    z.strictObject({kind:z.literal("inherited"),parentLink:versionRef("evidence_link"),via:z.array(CoreIdSchema).min(1).max(16).readonly()}).readonly(),
  ]),
}).readonly();
export const CoreSourceCatalogSchema=z.strictObject({
  datasets:z.array(CoreDatasetSchema).max(2000).readonly(),assets:z.array(CoreAssetSchema).max(10000).readonly(),
  sources:z.array(CoreSourceRevisionSchema).max(4000).readonly(),parts:z.array(CoreSourcePartSchema).max(20000).readonly(),
  links:z.array(CoreEvidenceLinkSchema).max(20000).readonly(),
  linkHistory:z.array(CoreEvidenceLinkSchema).max(40000).readonly().optional(),
}).readonly();
export const CoreUnlinkEvidenceSchema=z.strictObject({link:versionRef("evidence_link")}).readonly();
export type CoreAsset=z.infer<typeof CoreAssetSchema>;
export type CoreSourceRevision=z.infer<typeof CoreSourceRevisionSchema>;
export type CoreSourcePart=z.infer<typeof CoreSourcePartSchema>;
export type CoreEvidenceLink=z.infer<typeof CoreEvidenceLinkSchema>;
export type CoreSourceCatalog=z.infer<typeof CoreSourceCatalogSchema>;
export type CoreLocator=z.infer<typeof CoreLocatorSchema>;
