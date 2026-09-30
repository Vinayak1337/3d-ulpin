import {DocumentArchiveInspectionSchema,DOCUMENT_LIMITS,type DocumentInput,type DocumentResult} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {areaGeo} from '../../areas/areas';

/** Reuses the private processor transport; selection never supplies a path or command. */
export async function inspectDocumentArchive(input:DocumentInput,bytes:Uint8Array,
  inspect:(data:unknown)=>Promise<unknown>=data=>areaGeo('inspect-archive-member',data,DOCUMENT_LIMITS.resultBytes)):Promise<NonNullable<DocumentResult['archiveInspection']>>{
  if(!input.archiveSelection || bytes.length>DOCUMENT_LIMITS.nativeBytes || bytes.length!==input.sourceBytes || sha256(bytes)!==input.sourceSha256)
    throw new AppError(422,'ARCHIVE_SOURCE_INTEGRITY','Select a member of the bounded unchanged source ZIP.');
  let raw:unknown;
  try{raw=await inspect({base64:Buffer.from(bytes).toString('base64'),outerSha256:input.sourceSha256,...input.archiveSelection});}
  catch(error){
    if(error instanceof AppError && error.code==='AREA_PROCESSING' && /^ARCHIVE_[A-Z_]{1,70}$/.test(error.message))
      throw new AppError(422,error.message,'The selected member is ineligible or differs from its exact pins. Retry a supported GeoJSON selection.');
    throw error;
  }
  const result=DocumentArchiveInspectionSchema.parse(raw),selected=input.archiveSelection;
  if(result.lineage.outerSha256!==input.sourceSha256 || result.lineage.ordinal!==selected.ordinal ||
    result.lineage.memberSha256!==selected.memberSha256 || result.lineage.memberBytes!==selected.memberBytes)
    throw new AppError(422,'ARCHIVE_RESULT_SCOPE','Member inspection differs from the requested source/member pins.');
  return result;
}
