# AU2 — large map file to packages (read-only audit)

Product code is unchanged. Evidence: `chain.json`; full proposed file ownership/estimates: `proposal.json`.

| # | Status | Read-from-code finding / citation |
|---|---|---|
| 1 | Disconnected | Studio GIS drop uses direct import, not CA0 receipts. [1] |
| 2 | Retention works | Upload retains up to7 GiB; probe is64 KiB head/tail, not full counts/extent. [2] |
| 3 | Below target | Reader128 MiB/4096 parts cannot read1 GB/500000 features. [3] |
| 4 | No packages | Mapping publishes hashed observation slots, not import packages. [4] |
| 5 | No real-map stream | Real map reads area/building canonical projections; only demo draws event parts. [5] |
| 6 | Adapter missing | Imports16 MiB/2000; global index/range citation is lost by naive part submission. [6] |
| 7 | Scaling blocked | Effective area+neighbours capped2000; review/commit repeatedly load/hash full area. [7] |
| 8 | Mixed authority | Binding/package/snapshot can pass; large plan/exact evidence eligibility cannot. [8] |
| 9 | File recipe exists | Exact-source prefix layout reused within file; no destination/execute; large CRS null. [9] |

[1]: chain.json#L15
[2]: chain.json#L59
[3]: chain.json#L125
[4]: chain.json#L207
[5]: chain.json#L244
[6]: chain.json#L276
[7]: chain.json#L328
[8]: chain.json#L384
[9]: chain.json#L434

**Studio answer:** dropping an over-bound GeoJSON still takes the bounded direct-import route, not the retained
streaming-to-packages chain, so canonical streamed chunks do not progressively draw on the real map.

**Smallest proposal:** three disjoint tasks,48–66 worker-hours; every owned file is listed in `proposal.json`.

- **LP1 (16–22h):** `areas.ts`, `canonical-area.ts`, `usp/geometry.ts`, `usp/snapshots.ts`, area schema/controller/SQL.
  Bound review dependencies/display reads; preserve changed-context refusal; reuse exact revision/package membership.
- **LP2 (10–14h):** `retained-map-original.ts`, `feature-extract.ts`, `plan-authority.ts`, registry reference policy.
  Admit only completed exact large-GeoJSON receipt; keep global feature index and verified original range citations.
- **LP3 (22–30h):** upload/reader/profile/mapping/intake-draft jobs, processing dispatcher and Studio intake/map.
  One file layout; bounded packages; fenced idempotent resume/back-pressure; E1 stored confirmation.

Fix LP1/LP2 first. No second registry/job authority, new table or full-area snapshot; no blind increase of area bounds.
Late duplicates hold both targets; malformed JSON retains prefix/unknown remainder; source integrity blocks readiness.
EOF closes readiness, not tentative display. CRS/destination must be evidenced or officer-confirmed before placement.

**Architecture contradictions** (`docs/next-steps/INGESTION-ARCHITECTURE.md`):
Targets below are distinguished from delivered features.

- Line30: “ordered publication with a look-ahead of 8 parts” — declared constants, no worker look-ahead enforcement. [3]
- Line114: “bounded look-ahead (8, exists)” — same unsupported existence claim; worker flushes sequentially. [3]
- Line11: “every later file with the same layout” — approved streamed recipe is exact-source, not transferable. [9]
- Line10: “The map draws that part before the next one is finished.” — canonical mapping stops in slots. [4] [5]
- Line198: “one file ≤ 1 GB, a vector layer ≤ 500,000 features” — target, not current reader capacity. [3]

Small real-original measurement ran the existing worker on CAR-style nonce-owned tmpfs PostGIS, not populated storage:
1662 read,1661 accepted, feature1322 quarantined,17 published slots,zero packages/mapped slots;3.01s/552 features/s.
Original/Docker inventory unchanged; own container removed. NOT large-file or production-S3 throughput proof.

```text
TASK   AU2 — large map file to packages            GATE GF1 (read-only audit)
WORKS  Nine code-cited findings and a smallest-build proposal; no product behaviour changed.
SEE IT node docs/evidence/gf1/au2/verify.mjs; inspect chain.json and proposal.json
INPUTS NYC test_only unchanged building original; difficult self-intersection at global feature1322
GAPS   Studio/package bridge, scalable dependencies, exact large-source authority and reviewed E1 interface
DESIGN chain.json audit; proposal.json reuse/ownership; measure-stream.ts invokes existing fenced reader
COMMITS 45bcd57c; docs(usp): AU2 proposal, parts of a large original as import packages
CHECKS real worker/isolation receipt0; evidence verifier0; git diff --check0; no product/UI edit
NEXT   Lead approves scoped review policy and receipt/locator schema, then dispatches LP1/LP2 before LP3/E1.
```
