TASK   EV4 — List evidence whose retained source is unavailable            GATE GF-CONTRACT
WORKS  The evidence page keeps both rows, explains missing sources and never offers them for acceptance.
SEE IT pnpm --filter @ulpin/studio test src/features/intake/evidence
INPUTS Test-only retained/missing-source fixtures; existing NYC citation fixtures were also read (scope deviation).
GAPS   Shared client types/source pins need regeneration; no live HTTP or browser qualification.

## Design

- `packages/server/src/modules/usp/ingestion/intake-evidence.ts`: a read-only projection preserves coverage and
  item/profile/family/job/result pins while making unavailable source pins null. The strict source projection and
  confirmation code are unchanged.
- `packages/contracts/src/usp/intake.ts`: nullable flat pins plus `source.state` and a required reason when
  unavailable. Complete legacy retained rows remain parseable. Refined state/pin consistency prevents unknown bytes
  becoming zero. `docs/api/openapi.json` is regenerated from the native catalogue producer.
- `apps/studio/src/features/intake/evidence/`: coverage shows the server's reason; per-candidate and whole-file
  acceptance omit unavailable sources. The key's confirmation is blocked with explanatory words because the unchanged
  server requires every coverage item to be named. Direct canonical contract types avoid a hand-copied response type.

## Verification and integration gaps

`result.json` records commands, counts, failures and the data-drive scope deviation. Backend/API and all four Studio
package typechecks pass. The final targeted server/contract run passes 13 tests; Studio passes 16; the selected
in-memory intake protocol tests pass 3. The additional initial citation-suite run passed but was outside the intended
code-only scope: it read existing NYC files and used the data-drive native interpreter. No originals were modified;
no further data-drive tests were run.

The task names paths that are absent on this checkout:

- `scripts/api/openapi.ts` is actually `apps/api/scripts/openapi.ts`. Its normal generation also changes
  `docs/api/source-pins.json`, which is outside ownership. `contract.ts` here reuses `createApiDocument` without
  writing those shared pins; its `--check` passes. The full native `--check` fails only on stale source pins.
- `apps/studio/src/api/schema.d.ts` is actually `packages/api-client/src/schema.d.ts`. The required
  `pnpm studio:api-types` command writes that unowned path, so it was not run. The feature currently imports the
  canonical contracts response type directly; there is no second hand-maintained schema or generated-file copy.

The lead should regenerate the two shared artifacts before integration:

```sh
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/openapi.ts
pnpm studio:api-types
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/openapi.ts --check
```

No release gate is claimed passed. The mixed-source regression is service/contract-level, not a live HTTP 200 receipt.
The UI design report is `ui-design-check.md`; browser keyboard and 200% zoom checks remain unqualified.
