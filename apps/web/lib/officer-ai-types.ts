import type { PreparationFact } from '@ulpin/contracts';

export interface OfficerAiStatus {
  provider: 'nous'; configured: boolean;
  state: 'unconfigured' | 'available' | 'unavailable'; message: string;
  model?: string; catalogCheckedAt?: string; freeVerified: boolean;
  capabilities?: { image: boolean; structuredOutput: boolean };
  quota: { state: 'unknown' | 'reported'; remaining?: string; reset?: string };
}
export interface OfficerAiCandidate extends Omit<PreparationFact, 'id'> {
  id: string; citations: { partId: string; quote: string }[];
  rationale: string;
}
export interface OfficerAiSuggestion {
  id: string;
  kind: 'source_role' | 'entity_association';
  partId: string; sourceRevisionId: string; locator: string;
  role?: 'floor_plan' | 'section' | 'level_schedule' | 'survey' | 'reference' | 'unknown';
  entityId?: string; matchedIdentifier?: string;
  quote: string; rationale: string; evidenceState: 'unresolved';
  imageRegion?: {x:number;y:number;width:number;height:number};
}
export interface OfficerAiRun {
  id: string; packageId: string; packageRevision: number; requestKey: string;
  state: 'blocked' | 'running' | 'succeeded' | 'needs_input' | 'failed' | 'stale' | 'applied';
  provider: 'nous'; model?: string; inputFingerprint: string;
  sourceHashes: { sourceRevisionId: string; sha256: string }[];
  partHashes: { partId: string; sha256: string }[];
  imageRegions?: { partId: string; region: {x:number;y:number;width:number;height:number} }[];
  derivatives?: { partId: string; sourceSha256: string; sha256: string; width:number; height:number; region:{x:number;y:number;width:number;height:number}; sourcePixels?:number[]; pixelRegion?:number[]; orientation?:string; method:string }[];
  partIds: string[]; entityIds: string[]; promptVersion: string; schemaVersion: string;
  candidates: OfficerAiCandidate[]; questions: string[];
  suggestions?: OfficerAiSuggestion[];
  answers?: {question:string;answer:string}[];
  validationErrors: string[]; message?: string; cached?: boolean; cachedFromRunId?: string;
  calls: { latencyMs: number; inputTokens?: number; outputTokens?: number; responseId?: string; httpStatus?: number; outputHash?: string }[];
  budget: { maxCalls: number; maxOutputTokens: number; timeoutMs: number };
  startedAt: string; completedAt?: string; appliedRevision?: number;
  appliedCandidateIds?: string[];
}
