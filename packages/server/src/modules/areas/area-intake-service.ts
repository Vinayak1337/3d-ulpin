import type { GisInspection } from '@ulpin/contracts';
import { query } from '../../infrastructure/db';
import { AppError, notFound } from '../../infrastructure/errors';
import { inspectGisBytes, validateUnmappedGisIdentity } from '../cases/gis-inspection';
import { createSourceCase, receiveCaseDocument } from '../cases/source-cases';
import { createSourceWorkspace, sourceWorkspaceForCase } from '../cases/source-workspaces';
import { SOURCE_CATALOG, acquireSource, importAcquisition, probeAcquisition } from './area-acquisitions';
import { bindExternalIdentifier, resolveAreaIdentifier } from './area-resolver';
import {
  addFact, answerQuestion, areaContext, areaGeo, attachDocument, commitPackage,
  copyCaseDocuments, createPackageCorrection, getPackage, ingestArea, listAreas,
  rebasePackage, reviewPackage, runAreaCheck, type DocumentFile,
} from './areas';
import { areaScenarioRetired } from './area-scenario';
import type { z } from 'zod';
import type {
  acquisitionImportSchema, areaImportMetadataSchema, copyCaseDocumentsSchema,
  externalIdentifierSchema, packageAnswerSchema, packageFactSchema,
} from './area-validation';

/** Domain orchestration for area/source intake; HTTP parsing stays in Nest. */
export class AreaIntakeService {
  createSourceCase = createSourceCase;
  receiveCaseDocument = receiveCaseDocument;
  createSourceWorkspace = createSourceWorkspace;
  sourceWorkspaceForCase = sourceWorkspaceForCase;
  catalog() { return SOURCE_CATALOG; }
  listAreas = listAreas;
  context = areaContext;
  retiredScenario = areaScenarioRetired;
  resolve = resolveAreaIdentifier;
  bindIdentifier(input: z.output<typeof externalIdentifierSchema>) { return bindExternalIdentifier(input); }
  probe = probeAcquisition;
  acquire = acquireSource;
  async acquisition(id: string) {
    return (await query('SELECT body FROM area_acquisitions WHERE id=$1', [id])).rows[0]?.body || notFound();
  }
  async inspect(file: {name: string; bytes: Uint8Array}, layer: FormDataEntryValue | null) {
    return inspectGisBytes(
      file, layer,
      input => areaGeo<Omit<GisInspection, 'suggestedTitle' | 'suggestedNamespace'>>('inspect-gis', input),
    );
  }
  async importGis(input: z.output<typeof areaImportMetadataSchema> & { filename: string; bytes: Uint8Array }) {
    if (!input.bytes.length || input.bytes.length > 16 * 1024 * 1024) {
      throw new AppError(413, 'FILE_SIZE', 'Choose a nonempty GIS file up to 16 MiB.');
    }
    if (!input.mapping.idField) {
      await validateUnmappedGisIdentity(
        input.format, input.bytes,
        value => areaGeo<{featureIdEligible: boolean}>('inspect-gis', value),
      );
    }
    return ingestArea(input);
  }
  importAcquisition(input: z.output<typeof acquisitionImportSchema>) {
    return importAcquisition(input.acquisitionId, input.areaId, input.expectedAreaRevision, input.name);
  }
  package = getPackage;
  async questions(id: string) { return (await getPackage(id)).questions; }
  correct = createPackageCorrection;
  answer(id: string, input: z.output<typeof packageAnswerSchema>) {
    return answerQuestion(id, input.expectedRevision, input.questionId, input.answer);
  }
  review = reviewPackage;
  rebase = rebasePackage;
  commit = commitPackage;
  copyDocuments(id: string, input: z.output<typeof copyCaseDocumentsSchema>) {
    return copyCaseDocuments(id, input);
  }
  async document(id: string, expectedRevision: number, file: DocumentFile, sourceOnly: boolean) {
    if (sourceOnly && !(await getPackage(id)).sourceWorkspace) {
      throw new AppError(422, 'SOURCE_WORKSPACE', 'Source-only documents require an explicit source workspace.');
    }
    return attachDocument(id, expectedRevision, file);
  }
  fact(id: string, input: z.output<typeof packageFactSchema>) {
    return addFact(id, input.expectedRevision, input.claim);
  }
  check = runAreaCheck;
  async checkResult(id: string) {
    return (await query('SELECT body FROM area_check_runs WHERE id=$1', [id])).rows[0]?.body || notFound();
  }
}
