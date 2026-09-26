import { z } from 'zod';
import { AppError } from '../../infrastructure/errors';
import { redactDocumentViews } from '../usp/ingest/redact';
import { preparationContinuation } from '../cases/preparation-continuation';
import { buildingDossier, openPreparation, changeAssociation, createBlockGroup } from './officer';
import { exportBlock } from './block-export';
import { readWorkQueue } from './work-queue';
import { preparationRequirements, resolvePreparationFact, setPreparationPlacement, prepareDetails } from './officer-preparation';
import { createInvestigation, getInvestigation, updateInvestigation, exportRegister } from './officer-investigations';
import {
  appendHumanPreparationFact, physicalFeatureRevisions, propertyDirectory,
  reviewBuildingDetails, workspaceDirectory,
} from './officer-operations';
import {
  answerInvestigationInput, associationInput, blockGroupInput, createInvestigationInput,
  detailReviewInput, investigationRequestInput, openPreparationInput, placementInput,
  preparationFactInput, prepareDetailsInput, resolveFactInput, updateInvestigationInput, uuid,
} from './officer-input';

export { locator as locatorSchema } from './officer-input';
const json = (value: unknown, status = 200) =>
  Response.json(redactDocumentViews(value), { status, headers: { 'Cache-Control': 'no-store' } });
async function body(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 1024 * 1024)
    throw new AppError(413, 'INPUT_LIMIT', 'This request exceeds the bounded input limit.');
  try { return await request.json(); }
  catch { throw new AppError(400, 'INVALID_JSON', 'Provide a valid request body.'); }
}

/** Temporary standard-Request compatibility adapter; native Nest routes call the services directly. */
export async function officerRoutes(request: Request, p: string[]): Promise<Response | null> {
  const method = request.method;
  const params = new URL(request.url).searchParams;
  if (p[0] === 'work-queue' && p.length === 1 && method === 'GET')
    return json(await readWorkQueue(new URL(request.url)));
  if (p[0] === 'physical-features' && p.length === 3 && p[2] === 'revisions' && method === 'GET') {
    const before = params.has('before') ? z.coerce.number().int().positive().parse(params.get('before')) : 2147483647;
    return json(await physicalFeatureRevisions(uuid.parse(p[1]), before));
  }
  if (p[0] === 'areas' && p.length === 3 && p[2] === 'register' && method === 'GET')
    return exportBlock(uuid.parse(p[1]), z.enum(['json', 'pdf', 'zip']).parse(params.get('format') || 'json'));
  if (p[0] === 'property-directory' && p.length === 1 && method === 'GET')
    return json(await propertyDirectory(uuid.parse(params.get('area'))));
  if (p[0] === 'workspace-directory' && p.length === 1 && method === 'GET')
    return json(await workspaceDirectory());
  if (p[0] === 'buildings' && p.length === 3) {
    const id = uuid.parse(p[1]);
    if (p[2] === 'dossier' && method === 'GET') return json(await buildingDossier(id));
    if (p[2] === 'register' && method === 'GET')
      return exportRegister(id, z.enum(['json', 'csv', 'html', 'pdf', 'zip']).parse(params.get('format') ?? 'json'),
        undefined, params.has('record') ? uuid.parse(params.get('record')) : undefined);
    if (p[2] === 'preparation-cases' && method === 'POST') {
      const input = openPreparationInput.parse(await body(request));
      return json(await openPreparation(id, input.expectedRevision), 201);
    }
    if (p[2] === 'detail-review' && method === 'POST') {
      const input = detailReviewInput.parse(await body(request));
      const result = await reviewBuildingDetails(id, input.expectedRevision);
      return json(result.review, result.created ? 201 : 200);
    }
  }
  if (p[0] === 'property-associations' && p.length === 1 && method === 'POST')
    return json(await changeAssociation(associationInput.parse(await body(request))), 201);
  if (p[0] === 'block-groups' && p.length === 1 && method === 'POST') {
    const input = blockGroupInput.parse(await body(request));
    return json(await createBlockGroup(input as unknown as Parameters<typeof createBlockGroup>[0]), 201);
  }
  if (p[0] === 'import-packages' && p.length === 3) {
    const id = uuid.parse(p[1]);
    if (p[2] === 'continuation' && method === 'GET') return json(await preparationContinuation(id));
    if (p[2] === 'requirements' && method === 'GET') return json(await preparationRequirements(id));
    if (p[2] === 'preparation-facts' && method === 'POST')
      return json(await appendHumanPreparationFact(id, preparationFactInput.parse(await body(request))), 201);
    if (p[2] === 'resolve-fact' && method === 'POST') {
      const input = resolveFactInput.parse(await body(request));
      return json(await resolvePreparationFact(id, input.expectedRevision, input.claimId, input.reason));
    }
    if (p[2] === 'placement' && method === 'POST') {
      const input = placementInput.parse(await body(request));
      return json(await setPreparationPlacement(id, input.expectedRevision, input));
    }
    if (p[2] === 'prepare-details' && method === 'POST') {
      const input = prepareDetailsInput.parse(await body(request));
      return json(await prepareDetails(id, input.expectedRevision), 201);
    }
  }
  if (p[0] === 'investigations') {
    if (p.length === 1 && method === 'POST')
      return json(await createInvestigation(createInvestigationInput.parse(await body(request))), 201);
    if (p.length >= 2) {
      const id = uuid.parse(p[1]);
      if (p.length === 2 && method === 'GET') return json(await getInvestigation(id));
      if (p.length === 2 && method === 'PATCH') {
        const input = updateInvestigationInput.parse(await body(request));
        return json(await updateInvestigation(id, input.expectedRevision, input));
      }
      if (p.length === 3 && p[2] === 'requests' && method === 'POST') {
        const input = investigationRequestInput.parse(await body(request));
        return json(await updateInvestigation(id, input.expectedRevision, {
          question: input.question, reason: 'In-app evidence request created.',
        }), 201);
      }
      if (p.length === 5 && p[2] === 'requests' && p[4] === 'answer' && method === 'POST') {
        const input = answerInvestigationInput.parse(await body(request));
        return json(await updateInvestigation(id, input.expectedRevision, {
          requestId: uuid.parse(p[3]), response: input.response, evidence: input.evidence,
          reason: 'Response to evidence request recorded.',
        }));
      }
      if (p.length === 3 && p[2] === 'export' && method === 'GET') {
        const investigation = await getInvestigation(id);
        return exportRegister(investigation.buildingId, z.enum(['json', 'csv', 'html', 'pdf']).parse(params.get('format') ?? 'json'), id);
      }
    }
  }
  return null;
}
