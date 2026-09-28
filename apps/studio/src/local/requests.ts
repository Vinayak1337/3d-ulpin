import type { PublicRequestStatus, RegisterRequest, RequestKind, RequestState } from '@ulpin/api-client/draft';
import { buildingCode } from './codes';
import { REQUEST_KINDS } from './requestKinds';
import { lake } from './sources';
import { visibleFeatures } from './story';

/**
 * Requests from the public (REQUEST-01), held on this deployment until the request service is linked.
 * The portal files them; officers review them in the Studio. Kept in localStorage, so a portal tab and a
 * Studio tab on the same workstation see the same requests.
 */
const KEY = 'bhuaayam.requests';
const OFFICER = 'Duty officer';

function readAll(): RegisterRequest[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RegisterRequest[]; } catch { return []; }
}
function writeAll(items: RegisterRequest[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage refused */ }
}

/** RQ-2026-00001: year and a running number, easy to read out on the phone. */
function nextRef(items: RegisterRequest[]): string {
  const year = new Date().getFullYear();
  const n = items.filter((r) => r.ref.startsWith(`RQ-${year}-`)).length + 1;
  return `RQ-${year}-${String(n).padStart(5, '0')}`;
}

export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function fileRequest(form: FormData): Promise<PublicRequestStatus> {
  const text = (k: string) => String(form.get(k) ?? '').trim();
  const kind = text('kind') as RequestKind;
  const buildingId = text('buildingId');
  const building = visibleFeatures().find((f) => f.id === buildingId && f.kind === 'building');
  if (!building) throw new RequestError(404, 'building_not_found', 'This building is not in the register.');
  if (!(kind in REQUEST_KINDS)) throw new RequestError(400, 'kind_invalid', 'Choose what you are requesting.');
  const name = text('name'), mobile = text('mobile').replace(/\D/g, ''), relation = text('relation'), message = text('message');
  if (!name) throw new RequestError(400, 'name_required', 'Enter your name.');
  if (!/^[6-9]\d{9}$/.test(mobile)) throw new RequestError(400, 'mobile_invalid', 'Enter a 10-digit mobile number.');
  if (!message) throw new RequestError(400, 'message_required', 'Say what you are requesting.');
  const recordId = text('recordId') || null;
  const record = recordId ? lake.register.register.find((r) => r.id === recordId) : null;
  const files = form.getAll('file').filter((f): f is File => f instanceof File).map((f) => ({ name: f.name, bytes: f.size }));
  const items = readAll();
  const at = new Date().toISOString();
  const request: RegisterRequest = {
    ref: nextRef(items), kind, buildingId, buildingName: building.name, buildingCode: buildingCode(building.id), recordId: record?.id ?? null, recordName: record?.name ?? null,
    applicant: { name, mobile, relation: relation || 'Not stated' }, message, files, state: 'submitted', note: null, submittedAt: at, updatedAt: at,
    history: [{ state: 'submitted', at, note: null, by: 'Applicant' }],
  };
  writeAll([request, ...items]);
  return toPublic(request);
}

const toPublic = (r: RegisterRequest): PublicRequestStatus => ({
  ref: r.ref, kind: r.kind, buildingId: r.buildingId, buildingName: r.buildingName, buildingCode: r.buildingCode, recordName: r.recordName,
  state: r.state, note: r.note, submittedAt: r.submittedAt, updatedAt: r.updatedAt, history: r.history.map(({ state, at, note }) => ({ state, at, note })),
});

/** The applicant's tracker: found by reference and the mobile number it was filed with. */
export function trackRequest(ref: string, mobile: string): PublicRequestStatus | undefined {
  const found = readAll().find((r) => r.ref.toUpperCase() === ref.trim().toUpperCase());
  return found && found.applicant.mobile === mobile.replace(/\D/g, '') ? toPublic(found) : undefined;
}

export function listRequests(state: string | null): RegisterRequest[] {
  const items = readAll();
  if (!state || state === 'all') return items;
  if (state === 'open') return items.filter((r) => r.state === 'submitted' || r.state === 'in_review');
  return items.filter((r) => r.state === state);
}

export const getRequest = (ref: string) => readAll().find((r) => r.ref === ref);

const NEXT: Record<RequestState, RequestState[]> = { submitted: ['in_review', 'accepted', 'rejected'], in_review: ['accepted', 'rejected'], accepted: [], rejected: [] };

export function decideRequest(ref: string, state: RequestState, note: string | null): RegisterRequest {
  const items = readAll();
  const found = items.find((r) => r.ref === ref);
  if (!found) throw new RequestError(404, 'not_found', 'No request with this reference.');
  if (!NEXT[found.state].includes(state)) throw new RequestError(409, 'state_conflict', `A ${found.state.replace('_', ' ')} request cannot move to ${state.replace('_', ' ')}.`);
  if (state === 'rejected' && !note?.trim()) throw new RequestError(400, 'note_required', 'Give the applicant a reason.');
  const at = new Date().toISOString();
  const next: RegisterRequest = { ...found, state, note: note?.trim() || found.note, updatedAt: at, history: [...found.history, { state, at, note: note?.trim() || null, by: OFFICER }] };
  writeAll(items.map((r) => (r.ref === ref ? next : r)));
  return next;
}
