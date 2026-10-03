import {z} from 'zod';
import type {GeoParquetResult} from '../../../../../contracts/src/usp/geoparquet-ingestion';
import {SourceFusionGeoParquetSelectionSchema,SourceFusionGeoParquetSchema,type SourceFusionGeoParquetSelection,type SourceFusionGeoParquet} from '../../../../../contracts/src/source-fusion-geoparquet';
import {SourceFusionLiteralObjectSchema,SOURCE_FUSION_LIMITS} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

const fail=():never=>{throw new AppError(422,'SOURCE_FUSION_SELECTION','The exact accepted GeoParquet row records differ from their pins.');};
const literals=z.array(SourceFusionLiteralObjectSchema);
const nativeSchema=z.object({format:z.literal('usp-native-geoparquet/1'),source:SourceFusionLiteralObjectSchema,
  reader:SourceFusionLiteralObjectSchema,schema:SourceFusionLiteralObjectSchema,geoMetadata:SourceFusionLiteralObjectSchema,
  profile:SourceFusionLiteralObjectSchema,rowGroups:literals.max(128),rows:literals.max(1000),
  semantics:SourceFusionLiteralObjectSchema,window:SourceFusionLiteralObjectSchema});

/** Exact rows from one accepted window. Global row index, group-local index and
 * array ordinal are separate; neither other windows nor unselected rows expand. */
export function fusionGeoParquetSourceProjection(raw:SourceFusionGeoParquetSelection,
  loaded:{result:GeoParquetResult;native:unknown}):SourceFusionGeoParquet{
  const selection=SourceFusionGeoParquetSelectionSchema.parse(raw),{input,summary,artifact}=loaded.result,pin=selection.pin;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||input.sourceRevision!==pin.sourceRevision||
    input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256||
    artifact.sha256!==selection.artifactSha256)return fail();
  const native=nativeSchema.parse(loaded.native);
  if(native.source.sha256!==input.sourceSha256||native.source.bytes!==input.sourceBytes||fingerprint(native.window)!==fingerprint(summary.window)||
    native.rows.length!==summary.window.returnedRows||native.rowGroups.length!==summary.rowGroupCount||
    !Array.isArray(native.schema.columns)||native.schema.columns.length!==summary.columnCount||
    native.semantics.globalPlacementQualified!==false||native.semantics.transformApplied!==false||native.semantics.measurementQualified!==false||
    native.semantics.canonicalIdentityAssigned!==false||native.semantics.originalValuesOnly!==true)return fail();
  if(summary.window.status!=='available'||!native.rows.length)
    throw new AppError(422,'SOURCE_FUSION_GEOPARQUET_NO_ROWS','This accepted window has no selectable rows. Inspect a supported GeoParquet window first.');
  const columns=native.schema.columns as Record<string,any>[];
  if(new Set(columns.map(c=>c.name)).size!==columns.length||columns.some((c,i)=>c.columnIndex!==i||typeof c.name!=='string'))return fail();
  const byIndex=new Map<number,{ordinal:number;record:Record<string,any>;rowIndexInGroup:number}>();
  for(const [ordinal,record] of native.rows.entries()){
    const rowIndex=record.rowIndex,groupIndex=record.rowGroupIndex;
    if(typeof rowIndex!=='number'||rowIndex!==input.selection.startRowIndex+ordinal||typeof groupIndex!=='number'||!Number.isSafeInteger(groupIndex))return fail();
    const group=native.rowGroups[groupIndex];
    if(!group||group.rowGroupIndex!==groupIndex||typeof group.startRowIndex!=='number'||typeof group.numRows!=='number')return fail();
    const rowIndexInGroup=rowIndex-group.startRowIndex;
    if(!Number.isSafeInteger(rowIndexInGroup)||rowIndexInGroup<0||rowIndexInGroup>=group.numRows)return fail();
    const cells=SourceFusionLiteralObjectSchema.parse(record.columns);
    if(Object.keys(cells).length!==columns.length)return fail();
    for(const [index,column] of columns.entries()){
      const cell=cells[column.name];if(!cell||typeof cell!=='object'||Array.isArray(cell))return fail();
      const loc=cell.locator;if(!loc||typeof loc!=='object'||Array.isArray(loc)||loc.rowIndex!==rowIndex||loc.rowGroupIndex!==groupIndex||
        loc.rowIndexInGroup!==rowIndexInGroup||loc.columnName!==column.name||loc.columnIndex!==index)return fail();
    }
    byIndex.set(rowIndex,{ordinal,record,rowIndexInGroup});
  }
  const sorted=[...selection.rowIndices].sort((a,b)=>a-b),ns=`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`;
  const rows=sorted.map(rowIndex=>{
    const row=byIndex.get(rowIndex);if(!row)throw new AppError(422,'SOURCE_FUSION_GEOPARQUET_ROW_WINDOW',
      'Select a source-native row returned by this exact accepted window. Inspect another window explicitly for other rows.');
    return {rowIndex,ordinal:row.ordinal,rowGroupIndex:row.record.rowGroupIndex,rowIndexInGroup:row.rowIndexInGroup,
      key:`${ns}/geoparquet/${pin.jobId}/${artifact.sha256}/row/${rowIndex}`,pointer:`/rows/${row.ordinal}`,
      recordSha256:fingerprint(row.record),record:row.record};
  });
  const projected=SourceFusionGeoParquetSchema.parse({kind:'geoparquet',pin,namespace:ns,sourceSetRole:'operator_selected_fragment',summary,
    artifactSha256:artifact.sha256,artifactBytes:artifact.bytes,
    selectionSha256:fingerprint({version:'source-fusion-geoparquet-selection/1',pin,artifact:{sha256:artifact.sha256,bytes:artifact.bytes},
      window:summary.window,selection:input.selection,continuation:input.continuation,rowIndices:sorted}),
    selectionHashBasis:'accepted_source_result_input_reader_fence_artifact_window_parent_and_sorted_row_indices',
    nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',enrolledSelection:input.selection,continuation:input.continuation,
    source:native.source,reader:native.reader,schema:native.schema,geoMetadata:native.geoMetadata,profile:native.profile,
    rowGroups:native.rowGroups,semantics:native.semantics,rows,
    coverage:{selectedRows:rows.length,availableNativeRows:native.rows.length,totalSourceRows:summary.window.totalRows,
      scope:'explicit_row_records_and_exact_window_metadata',unselectedRows:'not_expanded',continuationRowsFetch:'not_performed',
      geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
  if(Buffer.byteLength(JSON.stringify(projected))>SOURCE_FUSION_LIMITS.responseBytes-8192)
    throw new AppError(413,'SOURCE_FUSION_RESPONSE_LIMIT','Select fewer or smaller GeoParquet row fragments.');
  return projected;
}
