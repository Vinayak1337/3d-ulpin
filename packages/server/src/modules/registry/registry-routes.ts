import { idSchema } from '../../infrastructure/validation';
import {amendRegistryDocumentCitations,readRegistryDocumentCitations} from './registry-document-evidence';
import { AppError } from '../../infrastructure/errors';
import {
  createSite, listSites, siteDetail, resolveRecord, createRegistryDraft,
  draftDetail, editRegistryDraft, prepareRegistryReview, commitRegistryReview, registryQuery,
} from './registry';
import {
  commitReviewInput, createDraftInput, createSiteInput, editDraftSchema,
  importSiteInput, querySchema, registryImportInput, reviewDraftInput,
} from './registry-input';
import { importRegistryCase } from './registry-seed';
import {
  createSiteWorkspace, exportRegistryRecord, resolveRegistryIdentifier,
  searchRegistry, siteImportOptions,
} from './registry-operations';

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function readBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
}
async function readCitationBody(request:Request){
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(!reader)throw new AppError(400,'INVALID_JSON','Request body must be valid JSON.');
  try{
    for(;;){const chunk=await reader.read();if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>32*1024){await reader.cancel();throw new AppError(413,'REGISTRY_DOCUMENT_INPUT_LIMIT','Citation selection exceeds 32 KiB.');}
      chunks.push(chunk.value);
    }
  }finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{throw new AppError(400,'INVALID_JSON','Request body must be valid JSON.');}
}

/** Temporary standard-Request compatibility adapter; native Nest routes call the services directly. */
export async function registryRoutes(request: Request, p: string[]): Promise<Response | null> {
  const method = request.method;
  if (p[0] === 'registry-imports' && p.length === 1 && method === 'POST') {
    const input = registryImportInput.parse(await readBody(request));
    const draftId = await importRegistryCase(null, input.caseId, input.expectedRevision);
    return json({ draftId, siteId: (await draftDetail(draftId)).siteId }, 201);
  }
  if (p[0] === 'sites') {
    if (p.length === 1 && method === 'GET') return json(await listSites());
    if (p.length === 1 && method === 'POST') {
      const input = createSiteInput.parse(await readBody(request));
      return json(await createSite(input.name, input.frame, input.synthetic), 201);
    }
    const id = idSchema.parse(p[1]);
    if (p.length === 2 && method === 'GET') return json(await siteDetail(id));
    if (p.length === 3 && p[2] === 'import-options' && method === 'GET') return json(await siteImportOptions(id));
    if (p.length === 3 && p[2] === 'workspace' && method === 'POST') return json(await createSiteWorkspace(id), 201);
    if (p.length === 3 && p[2] === 'query' && method === 'POST')
      return json(await registryQuery(id, querySchema.parse(await readBody(request))));
    if (p.length === 3 && p[2] === 'drafts' && method === 'POST') {
      const input = createDraftInput.parse(await readBody(request));
      return json(await createRegistryDraft(id, input.recordId, input.body, input.requestKey), 201);
    }
    if (p.length === 3 && p[2] === 'import' && method === 'POST') {
      const input = importSiteInput.parse(await readBody(request));
      return json({ draftId: await importRegistryCase(id, input.caseId, input.expectedRevision) }, 201);
    }
  }
  if (p[0] === 'resolve' && p.length === 2 && method === 'GET')
    return json(await resolveRegistryIdentifier(p[1]));
  if (p[0] === 'registry' && method === 'GET') {
    if (p.length === 1) {
      const params = new URL(request.url).searchParams;
      const siteId = params.get('site');
      return json(await searchRegistry((params.get('q') || '').slice(0, 150), siteId ? idSchema.parse(siteId) : undefined));
    }
    if (p.length === 3 && p[2] === 'export') return exportRegistryRecord(p[1]);
    if (p.length === 2) return json(await resolveRecord(p[1]));
  }
  if (p[0] === 'registry-drafts') {
    const id = idSchema.parse(p[1]);
    if(p.length===3&&p[2]==='document-citations'){
      if(new URL(request.url).searchParams.size)throw new AppError(422,'REGISTRY_DOCUMENT_QUERY','This citation operation has no query fields.');
      if(method==='GET')return json(await readRegistryDocumentCitations(id));
      if(method==='POST'){
        return json(await amendRegistryDocumentCitations(id,await readCitationBody(request)));
      }
    }
    if (p.length === 2 && method === 'GET') return json(await draftDetail(id));
    if (p.length === 2 && method === 'PATCH')
      return json(await editRegistryDraft(id, editDraftSchema.parse(await readBody(request))));
    if (p.length === 3 && p[2] === 'review' && method === 'POST') {
      const input = reviewDraftInput.parse(await readBody(request));
      return json(await prepareRegistryReview(id, input.expectedRevision, input.expectedSiteRevision));
    }
  }
  if (p[0] === 'registry-reviews' && p.length === 3 && p[2] === 'commit' && method === 'POST') {
    const input = commitReviewInput.parse(await readBody(request));
    return json(await commitRegistryReview(idSchema.parse(p[1]), input.acknowledgement));
  }
  return null;
}
