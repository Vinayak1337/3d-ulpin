import type {PointBatchResult} from '@ulpin/contracts/usp';
import {SourceFusionPointSelectionSchema,SourceFusionPointSchema,type SourceFusionPointSelection,type SourceFusionPoint}
  from '../../../../../contracts/src/source-fusion-point';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';

/** Preserve accepted literal metadata. Native bounds/CRS are declarations;
 * supplied counts and record layout are observations, never decoded statistics. */
export function fusionPointSourceProjection(raw:SourceFusionPointSelection,loaded:{result:PointBatchResult}):SourceFusionPoint{
  const selection=SourceFusionPointSelectionSchema.parse(raw),{input,metadata,artifact}=loaded.result,pin=selection.pin;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||input.sourceRevision!==pin.sourceRevision||
    input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||input.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256||
    artifact.sha256!==selection.artifactSha256||fingerprint(metadata)!==selection.metadataSha256||fingerprint(metadata.batch)!==fingerprint(selection.batch))
    throw new AppError(422,'SOURCE_FUSION_SELECTION','Select the exact accepted point batch metadata and artifact pins.');
  const namespace=`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`;
  return SourceFusionPointSchema.parse({kind:'point',pin,namespace,sourceSetRole:'operator_selected_fragment',
    key:`${namespace}/point/${pin.jobId}/${artifact.sha256}/metadata`,pointer:'/metadata',artifactSha256:artifact.sha256,
    artifactBytes:artifact.bytes,metadataSha256:selection.metadataSha256,
    selectionSha256:fingerprint({version:'source-fusion-point-selection/1',pin,artifact:{sha256:artifact.sha256,bytes:artifact.bytes},
      batch:metadata.batch,metadataSha256:selection.metadataSha256}),
    selectionHashBasis:'accepted_source_result_input_reader_fence_artifact_batch_and_metadata',metadata,
    coverage:{selectedBatches:1,scope:'exact_accepted_batch_metadata',pointRecords:'not_read',otherBatches:'not_fetched',
      artifactVerification:'accepted_receipt_reference_only',geometryQualification:'not_assessed',propertyMatching:'unsupported'}});
}
