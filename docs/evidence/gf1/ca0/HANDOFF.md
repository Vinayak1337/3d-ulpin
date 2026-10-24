```text
TASK   CA0 — probed retained map original to draft package                 GATE GF1
WORKS  The tray proposes or asks for a layout; approval automatically produces its cited draft.
SEE IT node docs/evidence/gf1/ca0/run-runtime.mjs <new-receipt.json>
INPUTS Unchanged NYC buildings-original.geojson and largest other vector sidewalk.geojson; test_only.
GAPS   Per-recipe approval; no second buildings layout; CA5 long acquisition; existing checker CRLF mismatch.
DESIGN Existing dispatcher/fenced jobs and manual mapping; exact retained receipt; site-only binding.
COMMITS Product 74e00e76..bf721803; harness 0cabe913; runtime b1a472ab; pins 813d1725.
CHECKS 199/199 tests; backend/runtime types and native OpenAPI pass; Python checker exits 1 (recorded gap).
NEXT   Lead reviews/integrates; CA6 repairs default large review; later layout-scoped approval contract/check.
```

| Step | Person | System | Result | ms |
|---|---|---|---|---:|
| Retain/probe | Test operator adds file | Intake + dispatcher | needs_answer; no recipe | 561.647 |
| Layout | Test operator chooses ID/geometry | Author + approve | Approved; job enqueued | 62.074 |
| Draft | None | Dispatcher executes | read/on_map; original positions kept | 5405.733 |
| Record | Test operator reviews | Actual review + commit | Cited revision-1 exteriors | 46631.721 |
| Packet/card | Test operator confirms citation | Snapshot/plan/packet/card | Complete; exact feature cited | 390.708 |
| Second file | None | Real-file schema inventory | No matching buildings layout | 1175.462 |
| Difficult file | Test operator adds sidewalk | Same intake/job path | needs_answer; no recipe | 492.837 |

The bound intake case's site is where its first map file was placed. Its frame stays unassigned because the file
established no vertical benchmark. The site frame lives on the site and package case. No frame/context/revision
was replaced. A later file in the same batch must use that site's area, or an officer uses a separate batch.

`runtime-06.json` proves actual PostgreSQL execution, CA5 review without scaffolding, CA1 recording, CA2 capture,
and CA4 packet/card. The retained receipt remains `needs_input`; admission is exact and record-only. No analytical
geometry, height, rights, title, ownership or issuance qualification is granted.

The rehearsal used eight connections with CA5's longer acquisition allowance, not a product repair. No second
file matches the first buildings schema; memory repinning and nontransfer of approval are unit-tested. No live
provider or cancellation-versus-started-manual-execution race was qualified. Other case/build workflows remain
read-only. Far-away existing-area behavior is static: the normalizer's CRS/50-km checks are not a place matcher.

`attempts.json` records the request-key, single-target selection and memory-storage ETag rehearsal corrections.
The final run rejected no SQL. Re-registration preserved needs_answer and read/on_map without extra jobs.
Every owned container was removed and all original vector hashes stayed unchanged.
The Python API checker still compares a CRLF runtime receipt with its LF digest; that receipt and its qualification
ledger are unchanged. Native OpenAPI generate/check pass with unchanged schema and only refreshed producer pins.

Run `node docs/evidence/gf1/ca0/verify-delivery.mjs` to verify the saved runtime, originals, accepted Step 0,
protected paths and producer pins. Full counts, timings, inputs and limits are in `result.json`.
