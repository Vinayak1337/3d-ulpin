import { z } from "zod";
import { CoreIdSchema, CoreOperationIdSchema, CoreRefSchema, CoreRevisionSchema, coreText } from "./scalars";

export const CORE_ENTITY_KINDS = ["building", "building_part", "level", "space", "parcel", "road", "rail", "utility", "utility_network", "road_network", "rail_network", "public_land", "terrain", "vegetation", "registry_record"] as const;
export const CoreEntityKindSchema = z.enum(CORE_ENTITY_KINDS);
export type CoreEntityKind = z.infer<typeof CoreEntityKindSchema>;
type Pair = readonly [CoreEntityKind, CoreEntityKind];
const sameKindPairs = CORE_ENTITY_KINDS.map(kind => [kind, kind] as const);
const physicalKinds = CORE_ENTITY_KINDS.filter(kind => kind !== "registry_record");

/** A finite endpoint table, shared with Python; not an uploaded rule language. */
export const CORE_RELATION_POLICY = {
  part_of: { pairs: [
    ["building_part","building"],["building_part","building_part"],
    ["level","building"],["level","building_part"],
    ["space","building"],["space","building_part"],["space","level"],
    ["parcel","parcel"],["utility","utility_network"],["road","road_network"],["rail","rail_network"],
  ] as readonly Pair[], cycleGroup: "containment", symmetric: false },
  occupies_level: { pairs: [["space","level"]] as readonly Pair[], cycleGroup: null, symmetric: false },
  associated_parcel: { pairs: ["building","building_part","space","road","rail","utility","registry_record"].map(kind => [kind,"parcel"] as Pair), cycleGroup: null, symmetric: false },
  recorded_by: { pairs: [...physicalKinds.map(kind => [kind,"registry_record"] as Pair),...physicalKinds.map(kind=>[kind,kind] as Pair)], cycleGroup: null, symmetric: false },
  serves: { pairs: ["utility","utility_network"].flatMap(from => ["building","building_part","space","road","rail","public_land"].map(to => [from,to] as Pair)), cycleGroup: null, symmetric: false },
  crosses: { pairs: [...["utility","road","rail"].flatMap(from => ["utility","road","rail","parcel"].map(to => [from,to] as Pair)), ...["utility","road","rail"].map(to=>["parcel",to] as Pair)], cycleGroup: null, symmetric: true },
  split_from: { pairs: sameKindPairs, cycleGroup: "lineage", symmetric: false },
  merged_from: { pairs: sameKindPairs, cycleGroup: "lineage", symmetric: false },
} as const;
export const CoreRelationKindSchema = z.enum(Object.keys(CORE_RELATION_POLICY) as [keyof typeof CORE_RELATION_POLICY, ...(keyof typeof CORE_RELATION_POLICY)[]]);
export const CoreIdentifierSchema = z.strictObject({
  scheme: CoreIdSchema, issuer: coreText(256), value: coreText(512),
  status: z.enum(["reported", "prototype", "verified"]), historical: z.boolean(),
}).readonly();
export const CoreMembershipSchema = z.strictObject({
  collection: CoreRefSchema, role: z.enum(["authoring", "coverage", "administrative"]),
}).readonly();
export const CoreLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("active") }).readonly(),
  z.strictObject({ state: z.literal("retired"), mode: z.enum(["split","merge"]), changeId: CoreOperationIdSchema, replacedBy: z.array(CoreRefSchema).min(1).max(64).readonly(), reason: coreText(1024) }).readonly(),
]);
export const CoreEntitySchema = z.strictObject({
  ref: CoreRefSchema, revision: CoreRevisionSchema, kind: CoreEntityKindSchema,
  label: coreText(512), identifiers: z.array(CoreIdentifierSchema).max(100).readonly(),
  memberships: z.array(CoreMembershipSchema).max(256).readonly(), lifecycle: CoreLifecycleSchema,
}).readonly();
export const CoreRelationSchema = z.strictObject({
  id: CoreIdSchema, revision: CoreRevisionSchema, kind: CoreRelationKindSchema,
  from: CoreRefSchema, to: CoreRefSchema, note: coreText(1024),
  changeId: CoreOperationIdSchema.optional(),
}).readonly();
export const CoreIdentifierQuerySchema = z.strictObject({scheme:CoreIdSchema,issuer:coreText(256).optional(),value:coreText(512)}).readonly();
export const CoreIdentityGraphSchema = z.strictObject({
  entities: z.array(CoreEntitySchema).max(10_000).readonly(),
  relations: z.array(CoreRelationSchema).max(40_000).readonly(),
}).readonly();
export const CoreIdentityCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rename"), changeId: CoreOperationIdSchema, target: CoreRefSchema, expectedRevision: CoreRevisionSchema, label: coreText(512), reason: coreText(1024) }).readonly(),
  z.strictObject({ kind: z.literal("split"), changeId: CoreOperationIdSchema, target: CoreRefSchema, expectedRevision: CoreRevisionSchema, children: z.array(CoreEntitySchema).min(2).max(64).readonly(), reason: coreText(1024) }).readonly(),
  z.strictObject({ kind: z.literal("merge"), changeId: CoreOperationIdSchema, sources: z.array(z.strictObject({ref:CoreRefSchema,expectedRevision:CoreRevisionSchema}).readonly()).min(2).max(64).readonly(), result: CoreEntitySchema, reason: coreText(1024) }).readonly(),
]);
export type CoreEntity = z.infer<typeof CoreEntitySchema>;
export type CoreRelation = z.infer<typeof CoreRelationSchema>;
export type CoreIdentityGraph = z.infer<typeof CoreIdentityGraphSchema>;
export type CoreIdentityCommand = z.infer<typeof CoreIdentityCommandSchema>;
