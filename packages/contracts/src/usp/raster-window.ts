import {z} from 'zod';

export const RASTER_WINDOW_VERSION='raster-window/1' as const;
export const RASTER_WINDOW_LIMITS=Object.freeze({originalBytes:16*1024*1024,sourcePixels:100_000_000,
  retainedSources:64,retainedBytes:256*1024*1024,
  sourceBands:4,windowSide:256,windowPixels:256*256,windowRawBytes:2*1024*1024,
  artifactBytes:4*1024*1024,resultBytes:32*1024,jobsPerSource:32,active:2});
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().nonnegative();
const positive=z.number().int().positive();
export const RasterPixelWindowSchema=z.strictObject({x:rev.max(100_000),y:rev.max(100_000),
  width:positive.max(RASTER_WINDOW_LIMITS.windowSide),height:positive.max(RASTER_WINDOW_LIMITS.windowSide)});
export const RasterLineageSchema=z.strictObject({kind:z.enum(['original','native_grid_derivative','unknown']),
  issuer:z.string().min(1).max(300).nullable(),originalUrl:z.url().max(2048).nullable(),
  acquiredAt:z.iso.datetime().nullable(),permissionReference:z.string().max(2048).nullable(),
  geography:z.string().max(500).nullable(),upstreamBytes:positive.nullable(),upstreamRetained:z.boolean().nullable(),
  parentSha256:hash.nullable(),limitations:z.array(z.string().max(1000)).max(20),note:z.string().max(1000).nullable()});
export const RasterRetainSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  lineage:RasterLineageSchema});
export const RasterWindowRequestSchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:positive,sourceSha256:hash,window:RasterPixelWindowSchema});
export const RasterOriginalSchema=z.strictObject({version:z.literal(RASTER_WINDOW_VERSION),subject:z.string().min(1).max(256),
  sha256:hash,bytes:positive.max(RASTER_WINDOW_LIMITS.originalBytes),receivedAt:z.iso.datetime(),
  lineageState:z.literal('caller_declared'),lineage:RasterLineageSchema});
export const RasterWindowInputSchema=z.strictObject({version:z.literal(RASTER_WINDOW_VERSION),jobId:id,caseId:id,
  caseRevision:rev,caseContextSha256:hash,sourceId:id,sourceFamilyId:id,sourceRevision:positive,
  sourceSha256:hash,sourceBytes:positive.max(RASTER_WINDOW_LIMITS.originalBytes),objectKey:z.string().min(1).max(512),
  subject:z.string().min(1).max(256),accessSha256:hash,readerSha256:hash,window:RasterPixelWindowSchema.nullable()});
export const RasterArtifactSchema=z.strictObject({key:z.string().min(1).max(512),sha256:hash,
  bytes:positive.max(RASTER_WINDOW_LIMITS.artifactBytes),mediaType:z.literal('image/tiff')});
const finite=z.number().finite(),optionalText=z.string().max(8192).nullable();
export const RasterWindowMetadataSchema=z.strictObject({sourceWidth:positive,sourceHeight:positive,sourceBands:positive,
  sourceTransform:z.tuple([finite,finite,finite,finite,finite,finite]),windowTransform:z.tuple([finite,finite,finite,finite,finite,finite]),
  sourceCrsWkt:optionalText,sourceCrsAuthority:z.string().max(100).nullable(),
  verticalReference:z.string().max(500).nullable(),verticalReferenceStatus:z.enum(['known','unknown']),
  resolution:z.tuple([finite,finite]),window:RasterPixelWindowSchema,
  nativeBounds:z.tuple([finite,finite,finite,finite]),
  bands:z.array(z.strictObject({index:positive,dtype:z.string().max(32),nodata:finite.nullable(),
    nodataKind:z.enum(['absent','finite','nan','positive_infinity','negative_infinity']),
    maskedPixels:rev,validPixels:rev})).min(1).max(RASTER_WINDOW_LIMITS.sourceBands),
  globalPlacement:z.literal('not_qualified')});
const RasterWindowResultBaseSchema=z.strictObject({version:z.literal(RASTER_WINDOW_VERSION),
  input:RasterWindowInputSchema,metadata:RasterWindowMetadataSchema,artifact:RasterArtifactSchema,
  createdAt:z.iso.datetime()});
export const RasterWindowResultSchema=RasterWindowResultBaseSchema.superRefine((value,ctx)=>{
  if(value.metadata.bands.length!==value.metadata.sourceBands ||
    value.metadata.verticalReferenceStatus==='known'!==Boolean(value.metadata.verticalReference) ||
    value.metadata.bands.some(b=>b.maskedPixels+b.validPixels!==value.metadata.window.width*value.metadata.window.height||
      (b.nodataKind==='finite')!==Boolean(b.nodata!==null)))
    ctx.addIssue({code:'custom',message:'Raster metadata must describe the exact pixel window and bands.'});
});
export const RasterWindowStatusSchema=z.strictObject({version:z.literal(RASTER_WINDOW_VERSION),caseId:id,sourceId:id,
  jobId:id,currentCaseRevision:rev,sourceRevision:positive,sourceSha256:hash,
  status:z.enum(['queued','running','completed','failed','stale']),code:z.string().nullable(),
  result:RasterWindowResultBaseSchema.omit({input:true}).nullable()});
export const RasterRetainReceiptSchema=z.strictObject({version:z.literal(RASTER_WINDOW_VERSION),caseId:id,
  caseRevision:rev,sourceId:id,sourceRevision:positive,sourceSha256:hash,bytes:positive,jobId:id});
export const RasterWindowQueueReceiptSchema=z.strictObject({version:z.literal(RASTER_WINDOW_VERSION),caseId:id,
  sourceId:id,jobId:id});
export type RasterWindowInput=z.infer<typeof RasterWindowInputSchema>;
export type RasterWindowResult=z.infer<typeof RasterWindowResultSchema>;
