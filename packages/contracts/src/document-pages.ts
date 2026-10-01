import {z} from 'zod';

export const DOCUMENT_PAGE_LIMITS=Object.freeze({originalBytes:16*1024**2,pages:400,pageSize:50,
  metadataBytes:128*1024,pngBytes:8*1024**2,pixels:1_600_000,side:1400,seconds:30,memoryBytes:2*1024**3});
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid().transform(value=>value.toLowerCase());
const integer=(minimum:number,maximum:number)=>z.string().regex(/^(0|[1-9]\d*)$/)
  .transform(Number).pipe(z.number().int().min(minimum).max(maximum));
export const DocumentPagePinSchema=z.strictObject({revision:integer(1,Number.MAX_SAFE_INTEGER),sha256:hash});
export const DocumentPagesQuerySchema=DocumentPagePinSchema.extend({
  offset:integer(0,399).default(0),limit:integer(1,50).default(25)});
export const DocumentPageNumberSchema=integer(1,400);
const coordinate=z.number().finite().min(-10_000_000).max(10_000_000),box=z.tuple([coordinate,coordinate,coordinate,coordinate]);
export const DocumentPageFrameSchema=z.strictObject({kind:z.literal('pdf_display_page_top_left_points'),
  rotation:z.number().int().min(0).max(359),width:z.number().finite().positive().max(10_000_000),
  height:z.number().finite().positive().max(10_000_000)});
export const DocumentPageInfoSchema=z.strictObject({page:z.number().int().min(1).max(400),
  label:z.string().min(1).max(200),sourceLabel:z.string().max(200).nullable(),frame:DocumentPageFrameSchema,
  mediaBox:box,cropBox:box,boxConvention:z.literal('pymupdf_page_rectangles/1'),
  renderSupport:z.enum(['supported','unsupported'])});
export const DocumentPageRenderSchema=z.strictObject({page:z.number().int().min(1).max(400),
  sha256:hash,bytes:z.number().int().positive().max(DOCUMENT_PAGE_LIMITS.pngBytes),
  pixels:z.tuple([z.number().int().positive().max(1400),z.number().int().positive().max(1400)]),
  scale:z.number().finite().positive().max(3),pixelOrigin:z.tuple([z.number().int(),z.number().int()]),
  dpi:z.tuple([z.number().finite().positive(),z.number().finite().positive()])});
/** Internal supervised output. It never supplies object keys, executable paths or URLs. */
export const DocumentPagesWorkerSchema=z.strictObject({version:z.literal('document-pages-local/1'),
  sourceSha256:hash,sourceBytes:z.number().int().positive().max(DOCUMENT_PAGE_LIMITS.originalBytes),
  pageCount:z.number().int().min(1).max(400),offset:z.number().int().min(0).max(399),
  limit:z.number().int().min(1).max(50),pages:z.array(DocumentPageInfoSchema).min(1).max(50),
  render:DocumentPageRenderSchema.nullable()});
export const DocumentPagesSchema=z.strictObject({version:z.literal('document-pages/1'),sourceId:id,caseId:id,
  caseRevision:z.number().int().nonnegative(),sourceRevision:z.number().int().positive(),sourceSha256:hash,
  sourceBytes:z.number().int().positive().max(DOCUMENT_PAGE_LIMITS.originalBytes),name:z.string().max(150),
  revision:z.string().regex(/^[1-9]\d*$/),pageCount:z.number().int().min(1).max(400),
  offset:z.number().int().min(0).max(399),limit:z.number().int().min(1).max(50),hasMore:z.boolean(),
  pages:z.array(DocumentPageInfoSchema.extend({url:z.string().max(512).nullable(),
    locator:z.strictObject({kind:z.literal('pdf_page'),page:z.number().int().min(1).max(400)}),calibration:z.null()})).max(50),
  anchors:z.array(z.strictObject({locator:z.string().regex(/^page:[1-9]\d*$/),page:z.number().int().min(1).max(400),region:z.null()})).max(50)});
export type DocumentPagePin=z.output<typeof DocumentPagePinSchema>;
export type DocumentPagesWorker=z.output<typeof DocumentPagesWorkerSchema>;
