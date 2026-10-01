import { Injectable } from '@nestjs/common';
import {amendRegistryDocumentCitations,readRegistryDocumentCitations} from '@ulpin/server/modules/registry/registry-document-evidence';
import {prepareRegistryCityJSONDraft,readRegistryCityJSONDraft,removeRegistryCityJSONDraft} from '@ulpin/server/modules/registry/cityjson-draft';
import {enqueueCityJSONValidation,readCityJSONValidationStatus} from '@ulpin/server/modules/registry/cityjson-validation';
import {assessCityJSONAdmission} from '@ulpin/server/modules/registry/cityjson-admission';
import type { z } from 'zod';
import {
  commitRegistryReview, createRegistryDraft, createSite, draftDetail,
  editRegistryDraft, listSites, prepareRegistryReview, registryQuery,
  resolveRecord, siteDetail,
} from '@ulpin/server/modules/registry/registry';
import { importRegistryCase } from '@ulpin/server/modules/registry/registry-seed';
import {
  createSiteWorkspace, exportRegistryRecord, resolveRegistryIdentifier,
  searchRegistry, siteImportOptions,
} from '@ulpin/server/modules/registry/registry-operations';
import type {
  createSiteInput, createDraftInput, editDraftSchema, querySchema,
} from './input';

@Injectable()
export class RegisterService {
  nativeAdmission(draftId:string,input:unknown){return assessCityJSONAdmission(draftId,input);}
  enqueueNativeValidation(draftId:string,input:unknown){return enqueueCityJSONValidation(draftId,input);}
  nativeValidation(draftId:string,jobId:string){return readCityJSONValidationStatus(draftId,jobId);}
  prepareNativeExterior(input:unknown){return prepareRegistryCityJSONDraft(input);}
  nativeExterior(draftId:string){return readRegistryCityJSONDraft(draftId);}
  removeNativeExterior(draftId:string,input:unknown){return removeRegistryCityJSONDraft(draftId,input);}
  amendDocumentCitations(draftId:string,input:unknown){return amendRegistryDocumentCitations(draftId,input);}
  documentCitations(draftId:string){return readRegistryDocumentCitations(draftId);}
  listSites() { return listSites(); }
  createSite(input: z.infer<typeof createSiteInput>) { return createSite(input.name, input.frame, input.synthetic); }
  site(siteId: string) { return siteDetail(siteId); }
  importOptions(siteId: string) { return siteImportOptions(siteId); }
  workspace(siteId: string) { return createSiteWorkspace(siteId); }
  query(siteId: string, input: z.infer<typeof querySchema>) { return registryQuery(siteId, input); }
  draft(siteId: string, input: z.infer<typeof createDraftInput>) {
    return createRegistryDraft(siteId, input.recordId, input.body, input.requestKey);
  }
  async importCase(siteId: string | null, caseId: string, revision: number) {
    const draftId = await importRegistryCase(siteId, caseId, revision);
    return siteId ? { draftId } : { draftId, siteId: (await draftDetail(draftId)).siteId };
  }
  resolve(identifier: string) { return resolveRegistryIdentifier(identifier); }
  search(search: string, siteId?: string) { return searchRegistry(search, siteId); }
  record(identifier: string) { return resolveRecord(identifier); }
  export(identifier: string) { return exportRegistryRecord(identifier); }
  draftDetail(draftId: string) { return draftDetail(draftId); }
  editDraft(draftId: string, input: z.infer<typeof editDraftSchema>) { return editRegistryDraft(draftId, input); }
  review(draftId: string, revision: number, siteRevision: number) {
    return prepareRegistryReview(draftId, revision, siteRevision);
  }
  commit(reviewId: string, acknowledgement: string) { return commitRegistryReview(reviewId, acknowledgement); }
}
