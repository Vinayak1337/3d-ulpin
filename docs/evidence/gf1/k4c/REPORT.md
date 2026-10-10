TASK   K4c — source-only identity: guard fix, label-only citation, card region binding            GATE GF1 / GF-T15
Branch `task/k4c-source-card` in `E:/Projects/ulpin-wt/k1`. Offline protocol evidence only; no runtime, query or write.
Steps 0 and 1 were done by the first worker. A second worker resumed at step 2 and reviewed that worker's uncommitted files.

WORKS
- Step 0: `validateSourceStatedIdentityTx` applies the unknown-location rule to `review.locations[row.id]` as well as
  `review.location`. One regression test per path. `docs/evidence/gf1/k4b/` no longer holds the seven intermediate
  JSON files or `refresh-pins.py`.
- Step 1: the unit citation is now the boxed label only. Final region `[596, 390, 644, 409]` pt on page 1
  (2586 × 1695 pt, top-left origin). The 4× crop (192 × 76 px) shows the boxed `UNIT-3B` and nothing else:
  no `UNIT-3A`, no other label, no neighbouring plan line. Measured margins from the ink to the region edge are
  5.0 / 5.0 / 6.0 / 4.25 pt (left, top, right, bottom), within the 6 pt limit. The broad K4b crop stays as context
  evidence only. The new request body (`source-space-request.json`) has a new `requestKey`;
  `expectedCanonicalRevision` is a placeholder to be read at run time.
- Step 2: a card plan can now be created for a source-only space from its own recorded citation. The existing
  packet-PDF planner and card projection do this; no second planner, template family or SQL was added.
  - For a `source-stated-space/1` record only, `targetTx` takes the recorded `sourceOnly.evidence` as the region
    binding. It requires all of: the record revision is the one in the snapshot; the cited source, revision and SHA-256
    equal the original captured in the same snapshot; the region lies inside the page box.
  - The bound citation is an ordinary `registry-document-region-citation/1`. Its id is `regionCitationId(...)`, so every
    downstream check (`assertRegionCitation`, source access, crop re-validation at execution, receipts) works unchanged.
  - The card shows the space literal, the floor literal, the building's recorded name, the assigned code with its
    check symbol, and the citation (page, region, source id, revision, SHA-256). It shows geometry, measurements, render,
    parcel assertions, level ordinal and use as unavailable, and rights as not assessed.
    The crop is the linked packet PDF (`packetSha256` on the card).

SEE IT
`pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/packets/source-stated-binding.test.ts`
and `docs/evidence/gf1/k4c/visual-evidence.json` (hash-pinned tight crop and outlined page under `E:/BhuAayam-data/task-data/k4c/`).

INPUTS
- Good: retained Tower 3 plan1 sheet (source `5293cd72-2377-4deb-a51c-c76d11ccb429`, revision 1, SHA-256
  `2b9f8803…c865`). The tests use the retained real crop of a technical region `[2265, 1545, 2530, 1680]` of that same
  sheet for renderer bytes and proof. The live label region is a different one, `[596, 390, 644, 409]`.
- Difficult: a space whose cited region reaches outside a smaller page box; a stale revision; tampered evidence hash and
  region; a changed retained original; and a geometry-bearing record on the same path.

GAPS
- Not run live. The offline double covers snapshot → review → assign → plan → card facts. It does not run plan
  confirm, execute, the PDF render or the card PDF; those paths were not changed apart from passing the stored
  binding through and re-verifying it.
- The crop of the tight region has never been produced by the real renderer: the 48 × 19 pt label gives a small PNG
  (about 144 × 57 px). The first live plan will show whether the renderer accepts it.
- The card shows the assigned code's locator `NO-ANCHOR / ?01 / L? / ?001` under "Recorded location", which is
  the existing projection for a source-only code. It is a technical display, not a source unit number.
- The entry `bindingId` for this path is a handle, not an id read from a record. Compute it with the formula below.

DESIGN
- `packets/source-stated-binding.ts` (new): `sourceStatementHandle(target)`; `prepareSourceStatementBindings` does the
  page and crop I/O outside SQL locks, as other native region work does; `sourceStatementBindingsTx` re-verifies
  the binding against the snapshot record and captured original inside the planning transaction.
- `pdf-authority.ts`: `targetTx` takes the recorded bindings of an existing plan or the prepared ones. For a
  source-only target it uses `sourceStatementBindingsTx`; every other target takes the old path unchanged.
  `plannedBindings(plan)` feeds confirm, execute, read and authorize. `pdf-service.ts`, `plan-authority.ts`: plumbing only,
  plus an optional `pages` seam in `PdfPacketIo`.
- `card-source-facts.ts` (new) and `card-projection.ts`: the six extra facts, read from the snapshot's floor and building.
- Tests share one set of helpers moved into `source-stated-identity.test-fixture.ts`; the fixture gained the plan SQL.
- Reviewed and rewritten from the first worker's uncommitted draft: the extra contract field is gone and the citation
  keeps its ordinary id. The draft's page-metadata call was untyped.

COMMITS
- `5930550d` fix(identity): source-only location guard covers per-record locations
- `2465b5af` docs(identity): label-only citation for UNIT-3B
- `a91e641e` feat(packets): plan a card for a source-only space from its recorded citation
- (this commit) docs(identity): K4c evidence and the live sequence

CHECKS
All run on the final tree: backend typecheck 0; 24 focused tests pass (incl. 3 new binding tests and 2 guard tests);
41 tests in `usp-packet-pdf`, `usp-property-card`, `usp-packet-plans`, `usp-project-identity-authority`,
`usp-project-identity-code` pass; API controller tests for packet plans and property cards pass;
`python scripts/db/verify_extraction.py` 0; `git diff --check` 0;
true-LF export of the final HEAD (`git -c core.autocrlf=false archive HEAD | tar -x` into a fresh directory under
`E:/BhuAayam-data/task-data/k4c/`) `python scripts/api/check.py` exits 1 with only `API-DOC: runtime receipt changed`. No new line over 120 characters in files I created;
edited dense files were wrapped where my change crossed 120. No contract field changed, so OpenAPI and client types
are unchanged and `pnpm studio:typecheck` was not needed. `refresh-contract.ts` re-pinned the touched producer files;
its entry for `source-stated-identity.test-fixture.ts` (a `.test-fixture.ts` path) was dropped from
`docs/api/source-pins.json` as instructed.

NEXT
Live sequence for the next task, after the demo checkout is rolled to reviewed staging. Owner: the runtime worker.
Tower building `6f95d04e-2067-4ac8-a3c2-6cc21ea46325`, site `ed4bc3ae-1b02-412e-a5cc-02accf693a1b`.
1. Read `GET /api/v1/buildings/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/canonical`; take `revisionId`, check the G+41/G+42
   conflict is unchanged, and write the digest into the request. Stop if A3d's roll-out changed dependencies.
2. Record `POST /api/v1/buildings/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/source-spaces` with the body in
   `docs/evidence/gf1/k4c/source-space-request.json` (`expectedCanonicalRevision` filled in) and `Idempotency-Key` equal
   to its `requestKey`. Save `spaceId`, `spaceRevision` (1), `floorId`.
3. Snapshot `POST /api/v1/usp/snapshots` with
   `{scopeId, selection:{kind:'targets', pins:[{ref:{namespace:'registry_record', id:spaceId}, revision:1}]}}`.
4. Review `POST /api/v1/usp/identity/reviews` with `{operation:'assign', scope:<snapshot.scope>, recordIds:[spaceId],
   expectedVersions:{[spaceId]:1}, reason, evidence:[{sourceId:'5293cd72-2377-4deb-a51c-c76d11ccb429', revision:1,
   locator:'page 1; region pt [596,390,644,409]; literal UNIT-3B'}], location:{anchorState:'not_supplied', parcels:[],
   locator:{structureKind:'?', structureNumber:1, levels:['L?'], spaceKind:'?', spaceNumber:1}}}`.
   The locator string must equal the stored `evidence[0].locator` of the space.
5. Assign `POST /api/v1/usp/identity/assign` with `{scope:<snapshot.scope>, expectedManifestId:<snapshot.id>, reviewId,
   requestKey:<fresh uuid>, recordId:spaceId, expectedRecordVersion:1}`. Save the receipt: its `snapshot` is the
   post-assign scope (space at revision 2) and is the scope used for steps 7–10.
6. Read back `GET .../canonical` (assigned code and check symbol on the space, geometry and dimensions unknown) and
   `POST /api/v1/usp/identity/resolve` with `{scope:<receipt.snapshot>, identifier:<assigned code>}`.
7. Compute the entry handle (the same value `sourceStatementHandle` returns), with `N` the space revision from the
   assign receipt (2):
   `python -c "import json,hashlib;print(hashlib.sha256(json.dumps({'version':'source-stated-space/1','target':{'ref':{'namespace':'registry_record','id':'<spaceId>'},'revision':N}},sort_keys=True,separators=(',',':')).encode()).hexdigest())"`.
   Create the plan with `POST /api/v1/usp/packets/plans/create`:
   `{input:{target:{ref:{namespace:'registry_record', id:spaceId}, revision:N}, scope:<receipt.snapshot>,
   purpose:'record_evidence', format:'pdf', recipe:'pack1-single-region-image/1', expiresAt:<within 24 h>,
   entries:[{bindingId:<handle>, required:true, inclusionReason:'Officer-cited label UNIT-3B'}]},
   guard:{mode:'create', requestKey:<uuid>}}`.
   Expect `entries[0].state:'included'`, `requiredContext:'available'`; if `blocked`, stop and report the entry.
8. Confirm `POST .../plans/confirm` `{planId, version:1, planSha256, reviewed:true, guard:{mode:'update', requestKey,
   expectedVersion:1, expectedManifestId:<receipt.snapshot.manifestId>}}`; execute `POST .../plans/execute`
   `{planId, version:1, confirmationId, guard:{mode:'create', requestKey}}`; the crop PDF downloads from
   `GET /api/v1/usp/packets/pdf/{packetId}/download`.
9. Card plan and render: `POST /api/v1/usp/property-cards/generate` `{planId, planVersion:1, cardId:null,
   expiresAt:<within 24 h>, guard:{mode:'create', requestKey}}`. Then read `GET /api/v1/usp/property-cards/{cardId}/revisions/1`
   (resolver) and check the six facts and the unavailable facts.
- Lead to look at before it runs: (a) the tight-region crop through the real renderer is untested (small PNG);
  (b) steps 8–9 were not exercised offline for this record kind, only plan creation and card facts; (c) the live
  request key in `source-space-request.json` is new and must not be reused; (d) the LF-export check was run by hand,
  not through the K4b `check-lf-export.py` (it writes a receipt into `docs/evidence/gf1/k4b/`).
