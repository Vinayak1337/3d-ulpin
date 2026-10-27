import type {RasterWindowResult} from '@ulpin/contracts/usp';
import {SourceFusionRasterSelectionSchema,SourceFusionRasterSchema,type SourceFusionRasterSelection,type SourceFusionRaster}
  from '../../../../../contracts/src/source-fusion-raster';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

/** Preserve accepted literal metadata. Native bounds/CRS are declarations;
 * supplied band counts are observations, never recomputed pixel statistics. */
export function fusionRasterSourceProjection(raw:SourceFusionRasterSelection,loaded:{result:RasterWindowResult}):SourceFusionRaster{
  const selection=SourceFusionRasterSelectionSchema.parse(raw),{input,metadata,artifact}=loaded.result,pin=selection.pin;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||input.sourceRevision!==pin.sourceRevision||
    input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256||
    artifact.sha256!==selection.artifactSha256||fingerprint(metadata)!==selection.metadataSha256||fingerprint(metadata.window)!==fingerprint(selection.window))
    throw new AppError(422,'SOURCE_FUSION_SELECTION','Select the exact accepted raster window metadata and artifact pins.');
  const namespace=`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`;
  return SourceFusionRasterSchema.parse({kind:'raster',pin,namespace,sourceSetRole:'operator_selected_fragment',
    key:`${namespace}/raster/${pin.jobId}/${artifact.sha256}/metadata`,pointer:'/metadata',artifactSha256:artifact.sha256,
    artifactBytes:artifact.bytes,metadataSha256:selection.metadataSha256,
    selectionSha256:fingerprint({version:'source-fusion-raster-selection/1',pin,artifact:{sha256:artifact.sha256,bytes:artifact.bytes},
      window:metadata.window,metadataSha256:selection.metadataSha256}),
    selectionHashBasis:'accepted_source_result_input_reader_fence_artifact_window_and_metadata',metadata,
    coverage:{selectedWindows:1,scope:'exact_accepted_window_metadata',pixelContent:'not_read',otherWindows:'not_fetched',
      artifactVerification:'accepted_receipt_reference_only',geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
}
