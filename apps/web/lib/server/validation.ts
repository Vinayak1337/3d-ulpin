import { z } from "zod";

export const idSchema = z.string().uuid();
export const finite = z.number().finite().min(-1000000).max(1000000);
export const pointSchema = z.tuple([finite, finite]);
export const footprintSchema = z.array(pointSchema).min(3).max(500);
export const profileSchema = z.enum([
  "parcel-local-json-v1",
  "levels-csv-v1",
  "control-csv-v1",
  "plan-png-v1",
  "plan-pdf-v1",
]);
export const frameSchema = z.object({
  id: z.string().min(1).max(100),
  horizontalUnit: z.literal("m"),
  verticalUnit: z.literal("m"),
  benchmark: z.string().min(1).max(100),
});
export const calibrationSchema = z.object({
  sourceId: idSchema,
  page: z.number().int().min(1).max(1000),
  imagePoints: z.tuple([pointSchema, pointSchema]),
  worldPoints: z.tuple([pointSchema, pointSchema]),
});
export const createCaseSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
  })
  .strict();
export const prepareSchema = z
  .object({
    spatialSourceId: idSchema,
    levelSourceId: idSchema.optional(),
    controlSourceId: idSchema.optional(),
  })
  .strict();
export const applyLevelsSchema = z
  .object({
    sourceId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const editUnitSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    footprint: footprintSchema.optional(),
    lower: finite.optional(),
    upper: finite.optional(),
    calibration: calibrationSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.footprint !== undefined ||
      v.lower !== undefined ||
      v.upper !== undefined ||
      v.calibration !== undefined,
    { message: "Supply an outline, elevation, or calibration change." },
  );
export const addUnitSchema = z
  .object({
    alias: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["unit", "common", "basement"]),
    footprint: footprintSchema,
    lower: finite,
    upper: finite,
    levelLabel: z.string().max(80).optional(),
    calibration: calibrationSchema.optional(),
  })
  .strict();
export const buildSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export const demoSchema = z
  .object({ dataset: z.enum(["c001", "c002", "real-nyc"]) })
  .strict();

const bindingSchema = z.object({ sourceId: idSchema, locator: z.string() });
const bindingsSchema = z.object({
  footprint: bindingSchema.optional(),
  lower: bindingSchema.optional(),
  upper: bindingSchema.optional(),
  alignment: bindingSchema.optional(),
});
export const unitSchema = z.object({
  id: idSchema,
  alias: z.string(),
  name: z.string(),
  kind: z.enum(["unit", "common", "basement"]),
  footprint: footprintSchema,
  lower: finite,
  upper: finite,
  lowerVerified: z.boolean(),
  upperVerified: z.boolean(),
  bindings: bindingsSchema,
  revision: z.number().int().positive(),
  levelLabel: z.string(),
  calibration: calibrationSchema.optional(),
});
const issueSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  severity: z.enum(["error", "warning", "info"]),
});
export const inspectionSchema = z.object({
  profile: profileSchema,
  status: z.enum(["ready", "needs_input", "failed"]),
  issues: z.array(issueSchema),
  summary: z.string(),
  frame: frameSchema.optional(),
  features: z
    .array(
      z.object({
        alias: z.string(),
        name: z.string(),
        kind: z.enum(["unit", "common", "basement", "parcel", "building"]),
        footprint: footprintSchema,
        levelLabel: z.string().optional(),
        draftLower: finite.optional(),
        draftUpper: finite.optional(),
      }),
    )
    .optional(),
  levels: z
    .array(
      z.object({
        alias: z.string(),
        lower: finite.nullable(),
        upper: finite.nullable(),
        benchmark: z.string(),
        unit: z.literal("m"),
        method: z.string(),
        locator: z.string(),
      }),
    )
    .optional(),
  controls: z
    .array(
      z.object({
        id: z.string(),
        x: finite,
        y: finite,
        benchmark: z.string(),
        locator: z.string(),
      }),
    )
    .optional(),
  image: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
      pages: z.number().int().positive().optional(),
    })
    .optional(),
});
const contextSchema = z.array(
  z.object({
    alias: z.string(),
    kind: z.enum(["parcel", "building"]),
    footprint: footprintSchema,
    name: z.string().optional(),
  }),
);
export const buildResultSchema = z.object({
  frame: frameSchema,
  units: z.array(
    unitSchema.extend({
      area: z.number().finite().positive(),
      height: z.number().finite().positive(),
      volume: z.number().finite().positive(),
    }),
  ),
  context: contextSchema,
  findings: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      severity: z.enum(["error", "warning", "info"]),
      title: z.string(),
      description: z.string(),
      unitIds: z.array(idSchema),
      sourceIds: z.array(idSchema),
      overlap: z
        .object({
          footprint: footprintSchema,
          lower: finite,
          upper: finite,
          volume: z.number().finite().positive(),
        })
        .optional(),
    }),
  ),
  inputFingerprint: z.string(),
  method: z.string(),
});
