/**
 * Type surface the Studio uses from @ulpin/contracts/usp: its plain values and rules, so the Studio never
 * typechecks the backend-owned schemas (compiled with looser settings than the Studio's). At runtime Vite
 * resolves the real module.
 */
export * from '../../../../packages/contracts/src/usp/plain';
