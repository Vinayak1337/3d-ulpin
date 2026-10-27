```text
TASK   KN1 — layout height and zero-target packages; kind blocked            GATE GF1 / GF5
WORKS  A building layout states height honestly; a package needs no building target to prepare or confirm.
SEE IT node docs/evidence/gf1/kn1/run-runtime.mjs <new-receipt.json>
INPUTS Five unchanged NYC vectors; buildings good, hydrography/sidewalk difficult; labelled feet fixture.
GAPS   Stop rule b blocks kind/five drafts; NYC unit undocumented; old CA0 bytes unavailable; K5 seam scaffolded.
DESIGN ingestion.ts + registry.ts validate three height facts and pass them to the unchanged normalizer.
       intake-draft-worker.ts retains height in layout memory, never the prior approval.
       intake-targets.ts queues preparation once and lists item-owned packages with zero counts.
       intake-confirmations.ts checks item membership, retaining review pins and cross-case refusal.
COMMITS 1364843d docs(usp): KN1 step 0, what the direct import's mapping states and the layout does not
        ad4502f3 feat(ingestion): a layout states the height with its unit and meaning
        755ce429 feat(ingestion): a package with no building is prepared and can be confirmed
        a9fbd0d6 fix(ingestion): height meaning follows direct import normalization
        7d755cfe test(ingestion): KN1 scoped HTTP rehearsal and regenerated height contract
        Evidence commit follows this report; see git log.
CHECKS pnpm typecheck:backend — 0; pnpm studio:typecheck — 0
       Isolated-env ingestion + retained-case-binding + packet tests — 0, 192 passed
       openapi.ts generate / --check / refresh-contract.ts 217f46f2 — 0 / 0 / 0
       PYTHONDONTWRITEBYTECODE=1 python scripts/api/check.py — 0
       Standalone harness tsc — 0; runtime runner — 0; git diff --check — 0
NEXT   Assign both unowned compatibility guards with kind support; rerun five drafts without K5 scaffolding.
```

The generic feature-target extension failed backend compilation in `streamed-profile.ts:57` and
`mapping-plan-v2.ts:383-387`, neither owned. It was reverted under stop rule (b), not bypassed with building
labels or casts. `kind-blocker.json` gives the smallest guards; `CHECKPOINT.md` lists the remaining work.
The final partial walk uses actual HTTP for case/source/layout/package/confirmation commands and reads.
SQL is confined to migration/job observation, plus the explicitly marked zero-target setup control.
That control imports real hydrography directly, installs item membership, invokes the owned target seam,
then proves automatic preparation and HTTP confirmation/recording with zero targets and cross-case denial.
It does not qualify automatic non-building drafting. No multi-package LP1 conclusion is claimed.

The pack's three-line `README.txt` has no height dictionary. Its `source-info/manifest.json:101` documents
LiDAR NAVD88 metres, not a building field, and line 114 says DEM sample units are not assumed.
Neither licenses a unit guess for building `height_roof`; the walk leaves height unknown.
A labelled fixture states 30 ft above ground, and both HTTP paths return 9.144 m, `source_supported`,
`native_parse`, with their own source citations. A null-height fixture remains unknown in the adjacent test.

CA0's saved walk contains recipe IDs/stages, not the historical plan/hash. Its temporary DB is gone.
The new persisted doitt_id/geometry plan round-trips its bytes/hash/recipe/approval unchanged;
that is explicitly not recovered CA0 historical evidence. Measurements, failure attempts and qualifications
are in `result.json`, `attempts.json`, and `runtime.json`. All five original hashes are unchanged,
no provider was called, and only each run's nonce-owned container was checked and removed.
