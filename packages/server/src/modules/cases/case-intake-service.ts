import { AppError } from '../../infrastructure/errors';
import { readObject, sha256 } from '../../infrastructure/storage';
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
    const bytes = await readObject(source.object_key);
    if (sha256(bytes) !== source.sha256 || bytes.length !== Number(source.bytes)) {
      throw new AppError(422, 'SOURCE_INTEGRITY', 'The retained original does not match its source receipt.');
    }
    return {bytes, name: source.name, mimeType: source.mime_type};
  }
}
