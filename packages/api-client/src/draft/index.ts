/**
 * Draft contracts: shapes the Studio needs where the backend card is still pending.
 * They are proposals for the backend lanes, not published API. Each names its card.
 */

/** A value read from a record, with the source that supports it. `sourceId` null = no source linked. */
export interface SourcedValue<T> {
  value: T;
  sourceId: string | null;
  source: string | null;
  locator: string | null;
}

export type RightsCategory = 'exclusive' | 'shared' | 'public' | 'unknown';
export type SpaceReviewStatus = 'draft' | 'needs_review' | 'reviewed';
export type CheckState = 'blocking' | 'needs_review' | 'not_assessed' | 'passed';

/**
 * GET /api/v1/buildings/{buildingId}/ledger — READY-01 (readiness), RIGHTS-01 (rights and shares),
 * HISTORY-02 (revisions). One projection of the building's records for the inspector and register.
 */
export interface BuildingLedger {
  buildingId: string;
  revision: number;
  status: SpaceReviewStatus;
  address: string | null;
  parcelUlpin: string | null;
  declaration: string | null;
  siteDatum: string | null;
  /** Ground elevation in the site datum; scene heights are elevation minus this. */
  groundElevationM: number | null;
  shareBasis: string | null;
  shareTotalPct: number | null;
  shareEvidence: { sourceId: string; source: string; locator: string } | null;
  spaces: Array<{
    spaceId: string;
    rights: RightsCategory;
    status: SpaceReviewStatus;
    carpetAreaM2: SourcedValue<number> | null;
    declaredAreaM2: SourcedValue<number> | null;
    sharePct: SourcedValue<number> | null;
    parking: SourcedValue<string> | null;
  }>;
  readiness: { task: string; dimensions: Array<{ name: string; value: number | null; label?: string }> };
  checks: Array<{ name: string; detail: string | null; state: CheckState; findingId: string | null }>;
  checkMethod: string;
  /** Per finding: the calculation shown to the officer, its evidence and the actions it allows. */
  findingDetails: Array<{
    findingId: string;
    calculation: string[];
    evidence: Array<{ kind?: 'feature' | 'table' | 'document'; state?: 'estimated' | 'missing'; sourceId: string | null; source: string | null; locator: string | null }>;
    actions: string[];
  }>;
  /** HISTORY-02: the sanctioned/observed pair for the deviation check; null until both exist. */
  deviation: {
    state: 'needs_review' | 'passed' | 'not_assessed';
    sanctioned: { label: string; storeys: number; heightM: number; sourceId: string; source: string; locator: string };
    observed: { label: string; storeys: number; heightM: number; rooftopAreaM2: number | null; surveyedAt: string; sourceId: string; source: string; locator: string };
    setback: 'compared' | 'not_comparable';
    exclusions: string | null;
    /** The observed-only volume, in the site datum. */
    volume: { geometry: { type: 'Polygon'; coordinates: number[][][] }; lowerM: number; upperM: number } | null;
    note: string;
  } | null;
  revisions: Array<{ kind: 'recorded' | 'evidence' | 'draft'; title: string; actor: string; at: string; hash: string; previousHash: string | null }>;
  sources: Array<{ sourceId: string; kind: 'feature' | 'table' | 'document'; name: string; file: string; summary: string }>;
}

/** Where a next action or count leads, resolved by the Studio to a route. */
export type WorkTarget =
  | { kind: 'add-files' }
  | { kind: 'register'; buildingId: string }
  | { kind: 'finding'; areaId: string; buildingId: string; findingId: string }
  | { kind: 'review'; areaId: string; buildingId: string; levelId: string }
  | { kind: 'level'; areaId: string; buildingId: string; levelId: string }
  | { kind: 'space'; areaId: string; buildingId: string; levelId: string; spaceId: string };

/** GET /api/v1/work-board — READY-01: stage, next action and readiness per work-queue item. */
export interface WorkBoard {
  items: Array<{
    id: string;
    stage: 'add_files' | 'review' | 'check' | 'recorded';
    detail: string | null;
    nextAction: { label: string; target: WorkTarget };
    readiness: { met: number; unknown: number; of: number };
  }>;
  counts: Array<{ key: string; value: number; label: string; target: WorkTarget }>;
}
