import {z} from 'zod';
export const GisGeometryDispositionSchema=z.object({
  total:z.number().int().min(1).max(2000),accepted:z.number().int().min(0).max(2000),rejected:z.number().int().min(0).max(2000),
  rejections:z.array(z.object({featureIndex:z.number().int().nonnegative(),sourceKey:z.string().max(256).nullable(),
    code:z.enum(['INVALID_GEOMETRY','GEOMETRY_KIND']),reason:z.string().min(1).max(500)})).max(2000),
}).superRefine((value,ctx)=>{
  if(value.accepted+value.rejected!==value.total||value.rejections.length!==value.rejected||
    new Set(value.rejections.map(row=>row.featureIndex)).size!==value.rejected||value.rejections.some(row=>row.featureIndex>=value.total))
    ctx.addIssue({code:'custom',message:'Geometry disposition counts and original feature indexes must agree'});
});
export const GisQuarantineSchema=GisGeometryDispositionSchema.safeExtend({version:z.literal('gis-quarantine/1'),
  sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceId:z.uuid().optional(),sourceRevision:z.number().int().positive().optional(),
  message:z.string().min(1).max(1000),complete:z.literal(false)});
export type GisGeometryDisposition=z.infer<typeof GisGeometryDispositionSchema>;
export type GisQuarantine=z.infer<typeof GisQuarantineSchema>;
