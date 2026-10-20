import { api, unwrap, ApiError } from '@ulpin/api-client';
import { isNotFound } from '../../identity/registryCard';
import { chooseReady, confirmablePackages, INTAKE_TARGET_LIMITS, nextRecorded,
  type Confirmation, type ConfirmBody, type Readiness, type Target, type TargetPage } from './model';

export async function readTargets(caseId: string, readiness?: Readiness, cursor?: string): Promise<TargetPage> {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/targets', {
    params: { path: { caseId }, query: { ...(readiness ? { readiness } : {}), ...(cursor ? { cursor } : {}) } },
  })) as TargetPage;
}

export async function readFirstReady(caseId: string): Promise<Target[]> {
  let page = await readTargets(caseId, 'ready');
  let choice = chooseReady(page.items, confirmablePackages(page));
  while (page.nextCursor && choice.length < INTAKE_TARGET_LIMITS.confirmationTargets) {
    page = await readTargets(caseId, 'ready', page.nextCursor);
    choice = chooseReady([...choice, ...page.items], confirmablePackages(page));
  }
  return choice;
}

export async function readNextRecorded(caseId: string): Promise<Target[]> {
  let page = await readTargets(caseId, 'recorded');
  let choice = nextRecorded(page.items);
  while (page.nextCursor && choice.length < INTAKE_TARGET_LIMITS.confirmationTargets) {
    page = await readTargets(caseId, 'recorded', page.nextCursor);
    choice = nextRecorded([...choice, ...page.items]);
  }
  return choice;
}

/** The intake target naming one building, or null when the server holds none. */
export async function readTargetByFeature(featureId: string, packageId?: string): Promise<Target | null> {
  try {
    return unwrap(await api.GET('/api/v1/ingestion/intake/targets/by-feature', {
      params: { query: { featureId, ...(packageId ? { packageId } : {}) } },
    })) as Target;
  } catch (failure) {
    if (isNotFound(failure)) return null;
    throw failure;
  }
}

export async function readConfirmation(caseId: string, confirmationId: string): Promise<Confirmation> {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}', {
    params: { path: { caseId, confirmationId } },
  })) as Confirmation;
}

export async function sendConfirmation(caseId: string, body: ConfirmBody): Promise<Confirmation> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/confirmations', {
    params: { path: { caseId } }, body,
  })) as Confirmation;
}

export async function retryConfirmation(caseId: string, confirmationId: string): Promise<Confirmation> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}/retry', {
    params: { path: { caseId, confirmationId } }, body: {},
  })) as Confirmation;
}

export async function prioritizeTarget(caseId: string, targetId: string): Promise<Target> {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/targets/{targetId}/priority', {
    params: { path: { caseId, targetId } }, body: {},
  })) as Target;
}

export function failureWords(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'The server gave no answer. Refresh the batch before making another confirmation.';
}
