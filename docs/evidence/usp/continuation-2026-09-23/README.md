# Staging continuation · 23 September 2026

PR [#13](https://github.com/Vinayak1337/3d-ulpin/pull/13) targets `staging` from
`codex/usp-staging-continuation-20260923`. The fetched integration base was
`2838e798af838d7646ff92b1120c62c8458103da`. The clean original main checkout and
populated local/repository services were preserved. `b3fb060` cherry-picks the
intended main-only `4551ef7` hostname/deployment handling and `/api` index; it
does not establish deployment qualification.

The user requested stopping after this current baseline/D0/D1 milestone and
pushing its code, review and evidence. Later READY/FIND/PDF/INGEST/history/rights/
impact/runtime-AI/public milestones are outside this checkpoint's implementation.

## Results and boundaries

The final local integrated run at
`304725d67e928f064d3951c3781592c3d706e377` **passed all 19 commands and all three
browser journeys, with no skipped or flaky tests**. A single real scene click
resolved exactly to U-AB01, `4ca0a61c-99d9-4806-96b7-efbb9121df6f`. Independent
read-only review accepted this bounded local milestone with no remaining
blocking findings. Both replays preserved every row in all 59 public tables.

Read the [final SQL/storage/job receipt](final/isolated-live-receipt.json),
[browser results](final/browser-summary.json), [before/after comparison](comparison.html)
and [artifact hashes](artifact-manifest.json). The isolated scope was
`local-010e44cf43cdb3f5`; owned-service cleanup exited zero.

Qualification is `local_integrated` for this D0/PACK0 workflow and
`real_source_qualified` only for the retained D1 exterior's local shape/identity.
Hosted checks remain independently recorded on [PR #13](https://github.com/Vinayak1337/3d-ulpin/pull/13/checks);
this local result does not establish `deployment_qualified`.

| Profile | Implementation and evidence |
| --- | --- |
| Baseline renderer | Sparse historical records without `epic` render under an explicit unassigned group; supplied planning references/sequences remain. Unknown epics still reject. `backlog.json` is unchanged. |
| Bundle compatibility | The original Uttam bundle's 32-table/216-column schema is pinned. Only the known nullable `jobs.started_at` addition is admitted; type, default, nullability, ordering, geometry typmod and key drift still reject. Installation adds 4,440 rows/53 original objects without changing populated baseline rows, and replay is verified. |
| D0 synthetic workflow | Actual Studio building/floor/unit selection, exact text/CSV source locators, scoped saved packet, byte/hash verification and reload. Supplied negative/unequal levels, reversible display cutaway, orbit/zoom, building switches, mobile scope and invalid-record rejection are exercised. No synthetic source is presented as a real survey. |
| D1 real exterior | One retained 3DBAG CityJSON response, native building/part IDs, 62 source vertices and 19 LoD 2.2 faces including three sloped roofs. Original bytes, face/semantic indices and local relative dimensions survive import/render/picking. No floor, unit or authoritative height is invented. |
| Data preservation | Every public table's row count and content digest is compared across each D0 and D1 import replay. Existing originals, linked revisions and source hashes remain separate from generated derivatives. Only the runner's new, uniquely owned disposable services are cleaned up. |
| D1 interactions | Shared building visibility/opacity, Fit/orbit/zoom, camera retention through inspector/source dialog/register return, native feature selection, mobile unavailable interiors, failed-source retry and one active map runtime. Stale revision, duplicate query, wrong area and disallowed origin requests reject. |
| Visual/performance limit | Actual software-WebGL browser captures support layout, interaction and source geometry checks. They do not qualify desktop/mobile GPU performance, 25–100-building scale, photographic equivalence to the retained reference or user-observed usability. |
| Geospatial/product limit | D1 uses labelled local engineering metres preserving RD New + NAP relative shape. Global placement, analytical mesh volume, real cadastral rights, PDF packets, live AI, authentication and public deployment remain unqualified. |

## Exact commands

Commands run from the isolated continuation worktree. The live runner injects
fresh loopback-only credentials privately and refuses the linked/populated
environment; do not copy an existing `.env` or reset a populated volume.

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/usp/local-isolation.mjs --run
pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-*.test.ts
pnpm test:studio
pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-*.test.ts
pnpm test:register-scope
node --test tests/dataset-bundle.test.mjs
ULPIN_PYTHON="/Users/vinayak/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
"$ULPIN_PYTHON" -m unittest discover -s docs/engineering-plan/tools/tests
"$ULPIN_PYTHON" docs/engineering-plan/tools/validate_plan.py
bash -n deploy/oci/deploy.sh
git diff --check
```

The earlier passing `c81ce5d` integrated receipt is retained in
[baseline/isolated-live-receipt.json](baseline/isolated-live-receipt.json): all
19 runner commands exited zero and the then-current three browser tests passed.
Independent review nevertheless found its basement occlusion, so it is a
baseline rather than final acceptance. [The review/correction history](../fnd/d0/README.md)
records failures before their fixes. The actual no-hit diagnostic capture and
receipt are retained under [failures](failures/pick-not-ready-receipt.json).

The local unit checks preceding the final pick correction passed: 101 USP,
55 Studio, 30 spatial-core, three register-scope, seven bundle regressions and
23 engineering-plan Python tests. Required hosted workflows provide their own
exact runner/runtime/command receipts; hosted integration is distinct from the
local production-server browser profile.

The final product correction also passed `pnpm typecheck` and `pnpm build`
(exit 0). Its readiness adapter is isolated and pinned to the locked Cesium
engine 26.3.0: bounds must be complete and the current Entity's draw command
must actually be submitted. Bounding readiness alone can precede submission by
one frame. The real single-click regression must be requalified when upgrading
that engine. The extra repeated-Focus movement assertion was removed because
repeating Focus is correctly idempotent; actual orbit/zoom and exact-pick checks
remain.

## Original source identities

| Retained input | SHA-256 |
| --- | --- |
| D1 original CityJSON | `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2` |
| D1 manifest | `1cf9ebb88700669c3eb64e6b7a55c5edd7a176c44d7ecce63b188a0767250b71` |
| D1 derived horizontal GIS | `0f0d0e8a4ddd3a32ccf1b3cdfd1c19882424f6c4aa1145885a19b4403b747fd9` |
| Uttam original bundle database | `d5b08aa68a86bae4e6b45c18cdf8c7f7f1f96087ee0d2d7b031d460c5efcfb07` |
| Committed repository database snapshot | `92cbdeb930c7b20f9a90f7857f92787ebe2562c65892ad835a758bdf1b6cfda8` |

D1 native ID is `NL.IMBAG.Pand.1655100000500568`. Acquisition, permitted use,
exact original and independent coordinate/topology oracle are retained in
[the source pack](../../../../fixtures/usp/D1/single-roof/). Attribution is
© 3DBAG by tudelft3d and 3DGI, CC BY 4.0. The integrated receipt pins D0 originals,
reviewed derivatives, server-issued identities and source revisions, and
includes live packet/job receipts. The browser independently checks its compiled
artifact hash and saved receipt. Fixture aliases never substitute for live IDs.

## Review and model settings

Read-only review findings preceded corrections: schema-type drift, omitted
historical planning references, repeated camera commands, lost source semantic
indices, ignored layer preferences, roof framing/attribution collisions and
basement occlusion. The persistent actual-pick blocker received a bounded Astra
Max diagnosis after focused attempts. The final review checked the exact source
diff, real receipt, single-click identity and actual before/after captures.

[worker-settings.json](worker-settings.json) records requested and observed
model/effort settings from client metadata, plus available cumulative usage.
These are coding-session counters including cached/repeated context, not billed
cost or runtime Sarvam budgets. No runtime provider call or credit purchase was
part of this milestone.
