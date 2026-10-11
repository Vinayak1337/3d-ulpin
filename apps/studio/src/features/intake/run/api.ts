import { api, unwrap, ApiError } from '@ulpin/api-client';
import type { Confirmation, ConfirmBody, Readiness, Target, TargetPage } from './model';

export async function readTargets(caseId: string, readiness?: Readiness, cursor?: string): Promise<TargetPage> {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/targets', {
    params: { path: { caseId }, query: { ...(readiness ? { readiness } : {}), ...(cursor ? { cursor } : {}) } },
  })) as TargetPage;
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
