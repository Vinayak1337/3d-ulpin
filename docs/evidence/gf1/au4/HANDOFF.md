TASK   AU4 — Code audit and smallest batch row/page attachment proposal       GATE GF1 / GF2
WORKS  Eight-item traced audit and four ordered, disjoint build tasks; no product changes or runtime pass.
SEE IT `docs/evidence/gf1/au4/AUDIT.md`, `chain.json`, `proposal.json`; `node docs/evidence/gf1/au4/check.mjs`.
INPUTS Source/design/E1 reads and permitted catalogue/README metadata; no original files or HTTP measurement.
GAPS   E1 lacks stage4; mapped rows cannot enter registry; native PDF parts do not reach text plans/cards.
DESIGN Receive/read in one case -> exact-key candidates -> sealed confirmation -> reviewed citation correction
       -> returned record revision -> scoped snapshot -> exact excerpt packet and cited card.
       Reuse ManualIngestionService, existing raw/mapping/document jobs, registry review and packet/card commands.
       Strict literal keys only; plural/conflicting/no-match counts stay separate; unread coverage is not absence.
       No automatic rights, floors, ownership, geometry or issuance; late files require a new correction confirmation.
COMMITS 6787d87e docs(usp): AU4 what happens to a table and a document of a batch, read from the code
        Proposal commit follows; `git log --oneline -2` gives both requested commits.
CHECKS node docs/evidence/gf1/au4/check.mjs — 0: JSON, eight items, 136 file/range references, disjoint ownership.
       git diff --check and new-file <=120-character review — 0; staged diffs read file by file.
       FX2 refresh — 1: Unexpected index bytes in ingestion/events.ts; no retry/pin edit.
       Runtime/typecheck/ui-design-check — not run: documentation-only task, no containers or product/UI edits.
NEXT   Lead approves AU4-B1..B4 and assigns seam/runtime owners; establish permissible real exact-key inputs first.

## Ordered build / file ownership

All exact paths and checks are in `proposal.json.tasks`; none was changed by this audit.
1. **B1, 6–9h:** canonical contracts/controllers, additive intake SQL + manifest/migration and generated schema.
2. **B2, 12–17h:** intake/service/ledger, exact-key evidence worker, fusion literal checks, event/dispatcher seams.
3. **B3, 18–28h:** registry citation authority, E1 readiness/confirmation/stage4, snapshots, packet/card projection.
4. **B4, 8–12h:** Studio batch/table flow and nonce-owned rehearsal evidence; run ui-design-check for those UI edits.
Total **44–66 worker-hours**, including late citation-only confirmation; estimate, not measured effort.

The audit proves no successful arbitrary register/PDF batch journey. CSV reference locator mismatch and API document
mode default `propose` are specifically called out; a build should explicitly request `native_only` for private reading.
Optional measurement was not attempted: no admissible NYC table/PDF shared-key pair was verified. Unrelated sources
can show no-match, not a successful link. Original bytes/keys were not invented and no source was acquired.
