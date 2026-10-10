import {CityJSONIngestionService,isCityJSONProtectedSource} from '../usp/ingestion/cityjson';
import {IFCIngestionService,isIFCProtectedSource} from '../usp/ingestion/ifc';
import {DXFIngestionService,isDXFProtectedSource} from '../usp/ingestion/dxf';
import {KMLIngestionService,isKMLProtectedSource} from '../usp/ingestion/kml';
import {CityGMLIngestionService,isCityGMLProtectedSource} from '../usp/ingestion/citygml';
import {ObjIngestionService,isObjProtectedSource} from '../usp/ingestion/obj';
import {GltfIngestionService,isGltfProtectedSource} from '../usp/ingestion/gltf';
import {GeoParquetIngestionService,isGeoParquetProtectedSource} from '../usp/ingestion/geoparquet';
import { AppError } from '../../infrastructure/errors';
import { readObject, sha256 } from '../../infrastructure/storage';
import { largeOriginalDownload } from '../usp/ingestion/download';
import {DocumentIngestionService} from '../usp/ingestion/documents';
import {transaction} from '../../infrastructure/db';
import {documentAuthorityTx} from '../usp/ingestion/document-authority';
import {
  addUnit, applyLevels, createCase, getCase, getSource, listCases,
  loadDemoInputs, prepareCase, readDemoFile, readRealDemoAsset,
  requestBuild, retryJob, updateUnit, uploadSource,
} from './domain';

/** Case intake and original-byte access through the existing job/storage authority. */
export class CaseIntakeService {
  list = listCases;
  create = createCase;
  detail = getCase;
  upload = uploadSource;
  loadRealNycInputs = loadDemoInputs;
  prepare = prepareCase;
  applyLevels = applyLevels;
  build = requestBuild;
  addUnit = addUnit;
  updateUnit = updateUnit;
  retry = retryJob;
  demoFile = readDemoFile;
  realNycAsset = readRealDemoAsset;

  async sourceFile(id: string) {
    const source = await getSource(id);
    if(isKMLProtectedSource(source))
      return {...await new KMLIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(isObjProtectedSource(source))
      return {...await new ObjIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(isGltfProtectedSource(source))
      return {...await new GltfIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(isCityGMLProtectedSource(source))
      return {...await new CityGMLIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(isGeoParquetProtectedSource(source))
      return {...await new GeoParquetIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(isDXFProtectedSource(source))
      return {...await new DXFIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(isIFCProtectedSource(source))
      return {...await new IFCIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(isCityJSONProtectedSource(source))
      return {...await new CityJSONIngestionService().original(source.case_id,id),cacheControl:'private, no-store'};
    if(source.inspection?.documentOriginal)return new DocumentIngestionService().original(source.case_id,id);
    await transaction(client=>documentAuthorityTx(client,source,'original'));
    const bytes = await readObject(source.object_key);
    if (sha256(bytes) !== source.sha256 || bytes.length !== Number(source.bytes)) {
      throw new AppError(422, 'SOURCE_INTEGRITY', 'The retained original does not match its source receipt.');
    }
    await transaction(client=>documentAuthorityTx(client,source,'original'));
    return {bytes, name: source.name, mimeType: source.mime_type};
  }
  async streamedSourceFile(id:string,signal:AbortSignal){
    const source=await getSource(id);
    if(isObjProtectedSource(source))return null;
    if(isGltfProtectedSource(source))return null;
    if(isKMLProtectedSource(source))return null;
    if(isCityGMLProtectedSource(source))return null;
    if(isGeoParquetProtectedSource(source))return null;
    if(isIFCProtectedSource(source))return null;
    if(isDXFProtectedSource(source))return null;
    if(isCityJSONProtectedSource(source))return null;
    return source.profile==='large-original-v1'?largeOriginalDownload(id,signal):null;
  }
}
