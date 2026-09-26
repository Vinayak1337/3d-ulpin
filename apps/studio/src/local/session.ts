/**
 * The state of this workstation's imports, as the local data layer serves it: when the area survey was
 * imported and when the building's floor documents were. Each local route answers from these, so the
 * Studio starts empty, the map fills while an import streams, and floors appear once their files are in.
 * Kept in localStorage; `?reset-session` in any URL clears it (and the officer's workflow store).
 */
const KEY = 'bhuaayam.session';

/** How long each import streams, ms. */
export const AREA_STREAM_MS = 16_000;
export const FLOORS_STREAM_MS = 10_000;

interface Session { areaStartedAt: number | null; floorsStartedAt: number | null; areaPackageId: string | null; floorsImportId: string | null; floorsFiles: string[] }
const EMPTY: Session = { areaStartedAt: null, floorsStartedAt: null, areaPackageId: null, floorsImportId: null, floorsFiles: [] };

export function readSession(): Session {
  try { return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) }; } catch { return EMPTY; }
}

export function writeSession(patch: Partial<Session>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readSession(), ...patch })); } catch { /* storage refused: stays empty */ }
}

export function resetSession() {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

const progress = (startedAt: number | null, ms: number) => (startedAt === null ? 0 : Math.min(1, (Date.now() - startedAt) / ms));
/** 0 before the area import, 1 once it has streamed in. */
export const areaProgress = () => progress(readSession().areaStartedAt, AREA_STREAM_MS);
/** 0 before the floor documents are imported, 1 once all levels are in. */
export const floorsProgress = () => progress(readSession().floorsStartedAt, FLOORS_STREAM_MS);
