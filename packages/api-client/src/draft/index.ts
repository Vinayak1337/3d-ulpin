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
  | { kind: 'add-files'; batchId?: string }
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

/** GET /api/v1/sources/{sourceId}/pages — DOC-01: the pages of a retained document and where locators point. */
export interface DocumentPages {
  sourceId: string;
  name: string;
  revision: string;
  pageCount: number;
  /** `calibration` maps local metres (east, north) to page units: page = origin + metres × scale, north up. */
  pages: Array<{ page: number; label: string; url: string; calibration: { scale: number; origin: [number, number] } | null }>;
  /** `region` (page units: x, y, width, height) is the part of the page the locator names. */
  anchors: Array<{ locator: string; page: number; region: [number, number, number, number] | null }>;
}

/** GET /api/v1/buildings/{buildingId}/levels/{levelId}/review — EXTRACT-02: what an officer reviews on a level. */
export interface LevelReview {
  buildingId: string;
  levelId: string;
  level: string;
  stage: 'review';
  sheet: { sourceId: string; source: string; page: number; pages: number[]; revision: string } | null;
  /** The space the candidates were extracted inside, when the plan is a unit layout. */
  withinSpaceId: string | null;
  method: string;
  candidates: Array<{
    id: string;
    label: string;
    kind: 'room' | 'wall';
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    dimensions: string;
    areaM2: number;
    confidence: 'high' | 'medium' | 'low';
    locator: string;
  }>;
  /** A level with nothing to extract: the question the officer answers. */
  question?: string;
}

/** GET /api/v1/import-batches/{batchId} — INGEST-03: a saved batch, what was found in each file and its open questions. */
export interface ImportBatch {
  id: string;
  name: string;
  areaId: string;
  buildingId: string | null;
  /** Where the batch continues after import (the level to review). */
  reviewLevelId: string | null;
  savedAt: string;
  files: Array<{
    name: string;
    sourceId: string | null;
    detected: string;
    /** Null with `crsApplies` true: the file is spatial but states no CRS. */
    crs: string | null;
    crsApplies?: boolean;
    crsOptions?: string[];
    contents: string;
    mapping: 'reused' | 'proposed' | 'manual';
    note?: string;
  }>;
  questions: Array<{ id: string; file: string; field: string; text: string; answers: Array<{ value: string; label: string }>; otherFields: string[] }>;
}

/**
 * Public portal (PUBLIC-01): released facts only. No owner or party names, no documents, no utilities.
 * A record is released once recorded or once a proposed 3D ULPIN is assigned to it.
 */
export interface PublicRecordSummary {
  id: string;
  name: string;
  buildingId: string;
  buildingName: string;
  address: string | null;
  level: string | null;
  carpetAreaM2: number | null;
  code: string | null;
  location: string[] | null;
  status: 'recorded' | 'assigned';
}

/** GET /api/v1/public/records?q= */
export interface PublicSearch {
  q: string;
  total: number;
  items: PublicRecordSummary[];
  /** Units in the matched buildings that are not released yet (counted, never listed). */
  notReleased: number;
}

export interface PublicStorey { id: string; label: string; lowerM: number | null; upperM: number | null; estimated: boolean; belowGround: boolean; use: string | null }
export interface PublicSpace { id: string; name: string | null; released: boolean; shared: boolean; polygon: { type: 'Polygon'; coordinates: number[][][] }; lowerM: number | null; upperM: number | null }

/** GET /api/v1/public/buildings/{buildingId}: the building's released massing and records. */
export interface PublicBuilding {
  id: string;
  name: string;
  areaId: string;
  address: string | null;
  parcelUlpin: string | null;
  datum: string | null;
  groundM: number | null;
  footprint: { type: 'Polygon'; coordinates: number[][][] };
  storeys: Array<PublicStorey & { spaces: PublicSpace[] }>;
  records: PublicRecordSummary[];
  notReleased: number;
  updatedAt: string;
}

/** GET /api/v1/public/records/{recordId} */
export interface PublicRecord extends PublicRecordSummary {
  levelId: string | null;
  lowerM: number | null;
  upperM: number | null;
  datum: string | null;
  parcelUlpin: string | null;
  sharePct: number | null;
  sharedSpaces: string[];
  revision: number;
  revisionHash: string;
  updatedAt: string;
}

/** GET /api/v1/public/areas/{areaId}/map: base map and building massing, with released counts per building. */
export interface PublicMap {
  area: { id: string; name: string; reference: { sourceCrs: string; verticalReference: string } | null };
  /** Same feature shape as the area context, limited to buildings, parcels, roads and public land. */
  features: Array<Record<string, unknown> & { id: string; kind: string; name: string }>;
  released: Array<{ buildingId: string; records: number }>;
}
