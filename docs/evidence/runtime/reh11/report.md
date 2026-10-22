TASK   REH11 — staging rehearsal to a cited card            GATE GF5 / GF4 / GF1
WORKS  Same-batch table, closed exact-key evidence, drawn surfaces, short CSV and mixed ZIP member reading.
SEE IT node docs/evidence/runtime/reh11/verify-evidence.mjs
INPUTS Public NYC GeoJSON/register/TIFF/LAZ; two-record CSV; GeoJSON+LPC PDF ZIP; unread publisher Markdown.
GAPS   NO demo roll: the matched building stops with REGISTRY_SOURCE_UNAVAILABLE before its cited card.

## Receipt

- Named target `065a323f`; actual initial rehearsal checkout was `1952c5fb`, not dispatch's `58559aa3`.
  Both database and processor context were unchanged from that actual checkout: no migration or image roll.
  Detached target selected, frozen install, document profile rebuilt; rehearsal doctor **28 PASS, 0 FAIL**.
- Runtime was populated. One new Act 1 case and two new Act 2 cases; no cleaning or empty-start claim.
- Forecast appeared in **0.209 s**. Batch GET preceded final upload: **0.251 s** versus **2.118 s**.
  The first batch URL observer was wrong; Act 2 independently captured visible uploading in **0.074 s**.
- Layout approval to finished draft **27.900 s**, ready review **54.395 s** (job receipt timings).
- **Open the table → Read as a table** opened **753 records / 9 columns**, **0.165 s** after the read press.
  The tray still incorrectly says no batch reader takes CSV.
- Exact integer BIN key: **753 closed, 612 matched, 81 conflicting, 60 unmatched**.
  One evidence confirmation stored **100** exact matches in **10.834 s**; 512 remain unconfirmed.
  Conflicts and unmatched rows remain unresolved. Stored note is copied in `result.json`.
- Same open map, no reload: TIFF **5 → 9/9**, LAZ **2 → 6/211** drawn parts, display only.
  TIFF last reader finished **467.538 s** after retention. LAZ completion was not awaited after the card blocker.
- Selected matched **feature 1001960**, LPC logical row **702**. One recording confirmation stored;
  **1,661 recorded, 0 carded, 1 stopped**. Stop after **71.487 s**: “A cited source is not currently available.”
  No card id, excerpt or verification exists. No feature-only fallback substituted; no unchanged retry.
- Likely seam: `registry-document-evidence.ts:130–143` checks the existing original with `registrySourceTx`;
  `registry-metadata.ts:35–41` rejects its `needs_input` status. Both map and table retain that status.
  Static path and product source status observed; no SQL, runtime-log access or product changes.
- Short CSV: **2 rows / 9 columns**, table in **0.175 s**, mapping job complete in **21.218 s**.
  Zero teacher calls; 7 unanswered fields and 9 questions, not accepted facts.
- ZIP: two unchanged members retained in **15.074 s**. PDF read **18 pages** in **44.398 s**, seven cited passages.
  GeoJSON reached **1,661 ready** in **67.881 s** after approval. Neither member was recorded in Act 2.
  Markdown: “Not understood. Kept (13 KB); its kind was not recognised from its first and last bytes.”
- Worst frames: batch **367 ms**, map **467 ms**, short-CSV page **517 ms**, judge page **500 ms**.
  Open-map streaming interval: **183 ms**, **2 frames over 100 ms**. Draft frame trace was lost on navigation.
  **3 console errors**, **0 duplicate-key warnings**, **0 page errors**. No smoothness claim.
- End journey: exit **0**, **6 pass / 2 skipped** (card and citation). This is not a passed card gate.
  JRN2 fixes its API origin to 3194: a GET-only preload redirected every request to 21026 before network access.
  Transport receipts cover the preliminary and final runs; the command's printed 3194 label is not its transport.
- Rehearsal, Studio and browser stopped; all records/volumes kept. Demo doctors before/after both **28 PASS**,
  same commit, container ids and PIDs **13100 / 8824**. `ulpin-reh-01` untouched.

`result.json` contains per-step words/timings and 13 runbook corrections. Raw screenshots, four videos,
full journey output and browser log stay in `E:/BhuAayam-data/task-data/reh11/`, not Git.

NEXT: fix the recorded-original authority seam without relaxing source/access pins; rerun the stopped cited carry.
Also correct CSV tray words, add an explicit journey API target, and distinguish a stopped carry
from an empty card queue. Finish a bounded LAZ-completion rehearsal; this run proves incremental drawing only.
VERDICT: **NO** — table, evidence and surfaces work, but the requested matched-row card does not.
