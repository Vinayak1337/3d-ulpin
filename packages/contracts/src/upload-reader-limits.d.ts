/** Narrow browser type surface; runtime exports reuse the existing reader constants. */
export declare const STREAMING_VECTOR_LIMITS: Readonly<{ sourceBytes: number }>;
export declare const RASTER_WINDOW_LIMITS: Readonly<{ originalBytes: number }>;
export declare const POINT_BATCH_LIMITS: Readonly<{ originalBytes: number; sourcePoints: number; batchPoints: number }>;
export declare const IFC_LIMITS: Readonly<{ originalBytes: number }>;
export declare const DOCUMENT_LIMITS: Readonly<{
  originalBytes: number; nativeBytes: number; page: number; jobs: number; ocrPages: number; ocrMaxPage: number;
  ocrItems: number; ocrBatchPages: number; parts: number;
}>;
export declare const DOCUMENT_PAGE_LIMITS: Readonly<{
  originalBytes: number; pages: number; pixels: number; side: number;
}>;
export declare function documentScannedPages(native: {
  format: string; status: string; warnings: readonly string[];
}): number[];
export declare const INTAKE_PAGE_IMAGE_LIMITS: Readonly<{ originalBytes: number }>;
export declare const INTAKE_TABLE_READER_FORMATS: readonly string[];
export declare const INTAKE_FORMAT_NAMES: Readonly<Record<string, string>>;
export declare const INTAKE_LEGACY_WORKBOOK_WORDS: string;
export declare const INTAKE_TARGET_LIMITS: Readonly<{
  draftTargets: number; confirmationTargets: number; page: number;
}>;
export declare const INTAKE_EVIDENCE_LIMITS: Readonly<{
  literalChars: number; quoteChars: number; tables: number; documents: number; page: number; targets: number;
  decisions: number; sources: number;
}>;
export declare const DXF_LIMITS: Readonly<{ originalBytes: number; entities: number; pages: number; pageBytes: number }>;
export declare const CITYGML_LIMITS: Readonly<{ originalBytes: number }>;
export declare const CITYJSON_LIMITS: Readonly<{ originalBytes: number }>;
export declare const GLTF_LIMITS: Readonly<{ originalBytes: number }>;
export declare const OBJ_LIMITS: Readonly<{ originalBytes: number }>;
export declare const LARGE_ORIGINAL_V2_LIMITS: Readonly<{ maxOriginalBytes: number }>;
export declare const TABULAR_LIMITS: Readonly<{ bytes: number }>;
export declare const TABULAR_STREAM_LIMITS: Readonly<{ bytes: number }>;
export declare const NATIVE_GIS_LIMITS: Readonly<{ sourceBytes: typeof STREAMING_VECTOR_LIMITS.sourceBytes }>;
