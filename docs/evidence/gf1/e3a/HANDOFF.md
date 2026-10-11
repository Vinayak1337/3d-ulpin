```text
TASK   E3a — Studio drop through intake and batch tray            GATE GF1 / GF5 (partial)
WORKS  Drop several GeoJSON originals into one batch and watch their probe facts, states and stored reasons.
SEE IT pnpm studio:dev
INPUTS NYC pack: buildings-original.geojson + difficult sidewalk.geojson; both test_only, unchanged.
GAPS   API omits layout/package references and destination suggestions; propose/approve/package link unavailable.
DESIGN AddFilesDialog routes to IntakeDropDialog; retainBatch serially retains/enrols using current case pins.
       BatchPage/IntakeTray read typed manifests; useBatchStream invalidates on events with a 5-second quiet fallback.
       LayoutQuestion reads eligible fields but fails closed; section#intake-run-panel is the merge seam below the tray.
COMMITS See task branch log; no push, no protected paths or table changes.
CHECKS pnpm studio:typecheck 0; pnpm studio:test 0 (376 Studio tests); real partial browser walk 0; design scan 0.
NEXT   Expose fields listed in step0.json, finish CA0 author/read-back/approve/link, mount the run panel and rehearse.
```

`result.json` records results and gaps; `design-check.md` records the skill review. `runtime-visual-final.json`
is the final live receipt with the screenshot paths outside Git. `controls-qualified.json` holds small real
responses used by the contract tests. The runtime creates its own labelled, ephemeral PostGIS/MinIO containers
and stops only those containers, its API, Vite and inspection bridge. No presentation/demo runtime was used.

The walk deliberately ends at the question: CA0's script can read the private inspection's suggested destination
from SQL, but this Studio may not. `IntakeItemSchema`/`intakeItem(row)` omit the durable `plan_ref`, and the profile
omits identifier/title/namespace suggestions. No alternate route, guessed namespace, selected sample field or
server modification was introduced. There is no authored-body equality test because no author request can
legitimately be made; the test commit's prescribed subject does not qualify that unbuilt part.

Early runtime launcher faults and the bounded zoom comparison are preserved in the small runtime receipts.
Screens show 1,662 building features from the retained receipt; they do not substitute CA0's 1,661 accepted draft
features. Both real inputs finish `probed` with placement `needs_answer`; the latter is not an item-state enum.

Resume only after the lead resolves the exact response gaps. Review and commit remain on the existing package
screen; confirmation/target/card UI belongs at the clearly named merge seam, not in this task's files.
