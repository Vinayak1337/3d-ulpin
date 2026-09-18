import {z} from "zod";
import {CoreIdSchema,CorePositiveRevisionSchema,CoreRefSchema,CoreRevisionSchema,CoreRevisionRefSchema,coreText,coreValueSchema} from "./scalars";
import {CoreFrameRevisionSchema} from "./frame-schema";

const versionRef=<N extends string>(namespace:N)=>z.strictObject({ref:z.strictObject({namespace:z.literal(namespace),id:CoreIdSchema}).readonly(),revision:CorePositiveRevisionSchema}).readonly();
export const CoreRepresentationRevisionSchema=z.strictObject({ref:z.strictObject({namespace:z.literal("representation"),id:CoreIdSchema}).readonly(),revision:CoreRevisionSchema}).readonly();
export const CorePartRevisionSchema=versionRef("source_part");
const xy=z.tuple([z.number(),z.number()]).readonly();
const ring=z.array(xy).min(4).max(2048).readonly();
const polygon=z.array(ring).min(1).max(128).readonly();
export const CorePolygonSchema=z.discriminatedUnion("type",[
  z.strictObject({type:z.literal("Polygon"),coordinates:polygon}).readonly(),
  z.strictObject({type:z.literal("MultiPolygon"),coordinates:z.array(polygon).min(1).max(128).readonly()}).readonly(),
]);
export const CorePlanarGeometrySchema=z.discriminatedUnion("type",[
  z.strictObject({type:z.literal("Point"),coordinates:xy}).readonly(),
  z.strictObject({type:z.literal("LineString"),coordinates:z.array(xy).min(2).max(2048).readonly()}).readonly(),
  ...CorePolygonSchema.options,
]);
export const CORE_GEOMETRY_POLICY={
  method:"bounded-planar-v1",
  maximumPositions:50000,
  maximumTopologyComparisons:200000,
  epsilonMetres:1e-9,
  areaFloorMetres2:1e-12,
  nonAnalyticalRoles:["display_only","unspecified"],
  volumeRoles:["exterior","floor_boundary","unit_boundary","restriction","design_outline"],
  reportedUnits:{horizontal_area:["m2","ft2","ha"],gross_floor_area:["m2","ft2","ha"],net_floor_area:["m2","ft2","ha"],parcel_area:["m2","ft2","ha"],prism_volume:["m3","ft3"],planar_length:["m","ft"]},
} as const;
export const CoreGeometryRoleSchema=z.enum(["unspecified","design_outline","recorded_road_land","restriction","ground_footprint","roof_projection","exterior","floor_boundary","unit_boundary","recorded_parcel","road_surface","alignment","public_land","terrain_surface","display_only"]);
export const CoreGeometryProfileSchema=z.discriminatedUnion("profile",[
  z.strictObject({profile:z.literal("planar"),geometry:CorePlanarGeometrySchema}).readonly(),
  z.strictObject({profile:z.literal("prism"),footprint:CorePolygonSchema,
    interval:z.strictObject({lowerMetres:z.number(),upperMetres:z.number(),reference:CoreRevisionRefSchema}).readonly().nullable(),
  }).readonly(),
  z.strictObject({profile:z.literal("asset"),asset:versionRef("asset"),format:CoreIdSchema}).readonly(),
  z.strictObject({profile:z.literal("unavailable"),reason:coreText(1024)}).readonly(),
]);
export const CoreRepresentationSchema=z.strictObject({
  ref:z.strictObject({namespace:z.literal("representation"),id:CoreIdSchema}).readonly(),revision:CoreRevisionSchema,
  entity:CoreRefSchema,frame:CoreFrameRevisionSchema.nullable(),role:CoreGeometryRoleSchema,
  geometry:CoreGeometryProfileSchema,sourceParts:z.array(CorePartRevisionSchema).max(256).readonly(),
}).readonly();
export const CoreReportedQuantitySchema=z.strictObject({
  ref:z.strictObject({namespace:z.literal("reported_quantity"),id:CoreIdSchema}).readonly(),revision:CorePositiveRevisionSchema,
  entity:CoreRefSchema,definition:z.enum(["horizontal_area","gross_floor_area","net_floor_area","parcel_area","prism_volume","planar_length"]),
  unit:z.enum(["m","ft","m2","ft2","ha","m3","ft3"]),amount:coreValueSchema(z.number().nonnegative()),sourcePart:CorePartRevisionSchema,
}).readonly();
export const CoreGeometryCatalogSchema=z.strictObject({
  representations:z.array(CoreRepresentationSchema).max(10000).readonly(),reportedQuantities:z.array(CoreReportedQuantitySchema).max(20000).readonly(),
}).readonly();
export const CoreMeasureRequestSchema=z.strictObject({representation:CoreRepresentationRevisionSchema,definition:z.enum(["horizontal_area","prism_volume","planar_length"])}).readonly();
export type CorePlanarGeometry=z.infer<typeof CorePlanarGeometrySchema>;
export type CoreRepresentation=z.infer<typeof CoreRepresentationSchema>;
export type CoreGeometryCatalog=z.infer<typeof CoreGeometryCatalogSchema>;
export type CoreMeasureRequest=z.infer<typeof CoreMeasureRequestSchema>;
