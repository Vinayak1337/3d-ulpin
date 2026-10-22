/**
 * Type surface the Studio uses from @ulpin/contracts/usp (backend-owned source, compiled with looser
 * settings than the Studio's). At runtime Vite resolves the real module; keep these signatures in sync
 * with packages/contracts/src/usp/project-identity.ts.
 */
export declare const P3_ALPHABET: string;
export declare function projectCodeForPayload(payload: string): string;
export declare function normalizeProjectCode(input: string): string | null;
