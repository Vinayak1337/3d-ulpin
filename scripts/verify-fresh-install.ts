/** Retired saved-snapshot rehearsal. Historical implementation remains in Git. */
console.error(
  'The saved-snapshot fresh-install rehearsal is retired. No process, service, data or volume was changed. '
  + 'Use the guarded real-source Nest procedure in scripts/usp/REAL_SOURCE_RUNTIME.md after lead authorization.',
);
process.exitCode = 1;
