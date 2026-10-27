/**
 * Type surface the Studio uses from @ulpin/contracts/usp (backend-owned source, compiled with looser
 * settings than the Studio's). At runtime Vite resolves the real module; keep these signatures in sync
 * with packages/contracts/src/usp/project-identity.ts and point-batch.ts.
 */
export { batchStep, itemPendingKinds, isIntakeReading, needsLayoutAnswer, canRetryStopped, stoppedReason,
  isPageImage, canAnswer, itemTableSource, type ItemTableSource
} from '../../../../packages/contracts/src/usp/intake-needs';
export declare const P3_ALPHABET: string;
export declare function projectCodeForPayload(payload: string): string;
export declare function normalizeProjectCode(input: string): string | null;
export declare const POINT_BATCH_RECORD_LENGTHS: Readonly<{ 0: 20; 1: 28; 2: 26; 3: 34; 6: 30; 7: 36; 8: 38 }>;
