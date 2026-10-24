# M1 evidence audit — Q1

Commit: `57eb2bc7ad53514daa50469f8d4ea2b976d4002e`.
As of: 10 October 2026; committed evidence only. Gate: Wednesday 14 October 2026 (API).

**M1 is not closed.** Live Sarvam is absent; building recall misses the target; blind positives are sparse.

## WORKS — boxes by state

| proven_live | proven_offline | partial | not_started | blocked | Total |
|---:|---:|---:|---:|---:|---:|
| 5 | 8 | 8 | 0 | 5 | 26 |

- Full-box states include P3/P4 acceptance, not just implementation existence.
- proven_offline is not a runtime-gate pass; proven_live is a historical receipt, not a fresh health check.
- Building evaluation exists, but its intended recall gate is unmet; B9 results are not in this checkout.
- No external data, held-out inputs, credentials, network, runtime request, model or GPU was used.
- Held-out numbers below are existing Git count/metric receipts, never new scoring.
- Code references explain gaps; code or an unexecuted test is never counted as execution proof.
- Module-relative next-task paths resolve under packages/server/src/modules; score.py is under gf-ai/storeys.
- Exact checklist strings exceed 120 columns in JSON; all other new non-table lines fit the limit.
- teacherCalls in older live receipts can mean failed replay attempts, not Sarvam network calls.
- R4/J1b serve 83965a21; this audit does not assert that newer staging code ran live.

Read each group horizontally. E-numbers resolve to the exact files in the evidence index below.
Empty cells mean no missing deliverable/blocker/next task at the stated proof level.

## Buildings

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| ML-B1 | preregistration committed before any holdout run; | proven_offline | **E01** `preregistration_commit; holdout_runs`: 7d33e221; holdout_runs=0 at B1; Git ancestor check=0 before baseline code.<br>**E02** `at; git_sha`: First baseline at 2026-10-09T19:52:11.623940+00:00, after the prereg commit. |  |  |  |
| ML-B2 | installed RF-DETR and fine-tuned RF-DETR-Seg evaluated on the frozen RAMP Karnataka holdout (per-building precision/recall at IoU ≥ 0.5, false positives on empty tiles); | partial | **E02** `coverage; metrics.per_building; metrics.false_buildings_on_empty`: 1273 chips; P=0.6879394267171444 (3816/5547); R=0.41559573077760836 (3816/9182). 92 false buildings / 355 empty chips; IoU match threshold=0.5.<br>**E03** `coverage; metrics.per_building; metrics.false_buildings_on_empty`: 1273 chips; P=0.8363968008979935 (5961/7127); R=0.6492049662382923 (5961/9182). 15 false buildings / 355 empty chips; PyTorch-cuda, not full ONNX holdout scoring.<br>**E04** `building_mask.thresholds`: precision_min=0.75; recall_min=0.7. Measurement done; recall acceptance missed. | A building candidate meeting the recall gate, or an explicit unmet-gate decision. | another task: B9 retrain/selection; outcome not in Git. | Review B9 result.json/card against frozen criteria; never reopen old holdouts. |
| ML-B3 | model card and ONNX parity; | proven_offline | **E05** `registration_status; instance_parity_20_dev_chips; evaluation_claim_scope`: Card binds epoch-4 weights/profile/licence; final-instance v2 passed on 20 DEV chips only.<br>**E06** `outcome; parity`: passed_20_of_20; minimum mask IoU=0.9993451211525868; score delta=9.2e-05. Box-corner delta=0.0 source pixels; threshold-band exceptions=0; graph unchanged.<br>**E07** `status; chips; max_abs_difference; tolerance`: Raw tensor v1 failed on the same 20 chips: masks=70.30064392089844 vs tolerance=0.001. v1 failed and v2 passed are different protocols; neither is full ONNX holdout accuracy. |  |  |  |
| ML-B4 | a new model id served by `/spatial-ml`. | proven_live | **E08** `servedApiCommit; roofprint; imagery`: 395e7770; rfdetr-ramp-ka-seg-medium-b3-v1; 22 chips, 2 batches, 80 candidates. CPU/demo-only/test_only; 13 nonempty, 9 empty; registry acceptance remains refused (422). |  |  |  |

## Plans

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| ML-P1 | the vector plan reader turns Bihar Magnolia pages into rooms with literal labels, dimensions and metric areas, plus a consistency report; | partial | **E09** `receipts[0].pageResults.2; allIdentical; checks`: 18 candidates; 17 parsed labels; 10 stated-dimension pairs; consistency=9 ok/8 unknown/1 mismatch. 9/11 parsed-name dimension checks=0.8181818181818182; 9/12 any literals=0.75.<br>**E10** `inputs[0]; gaps`: Original: 1 vector floor-plan PDF page, requested 3; NOT SCALE THE DRAWING; areas diagnostic.<br>**E08** `servedApiCommit; rooms`: 395e7770 serves 18 candidate rooms; plan-local scale candidate; placement unknown. | Three real vector-page qualification and source-supported completeness; not 18 exact measured rooms. | data: Two more suitable vector pages; absent literals cannot be invented. | Qualify scripts/plans/read_vector_plan.py on supplied pages; retain gaps and consistency. |
| ML-P2 | scanned pages give CubiCasa candidates with a scale, or `no_scale`. | proven_offline | **E11** `recordedRealExecutions; results; qualification`: Tower 3: 218 room candidates across 4 panels; all 4 no_scale; 1124 OCR observations. 100 foreign test plans: meanClassIoU=0.5236082680954804; not Indian accuracy or API admission. |  |  |  |

## Documents

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| ML-D1 | storeys, unit counts and floor labels from RERA PDFs, by rules plus the Sarvam agent; | blocked | **E12** `baseline; agent; demo`: Rules dev floors R=0.0 (0/7), P=0.0 (0/2); units R=0.25 (1/4), P=1.0 (1/1). Agent metrics=null; teacher_unavailable; Tower 3 finds G+42, misses G+41 and unit count 81.<br>**E13** `sources[*].calls; sources[*].states`: Every source has calls=0 and teacher_unavailable; no live Sarvam extraction.<br>**E14** `dev.alternative; tower3; conclusion`: Alternative floor P=1.0 (1/1), R=0.1429 (1/7); loses G+42; not a full replacement. | A verified Sarvam development/demo extraction receipt, compared per field with the rule baseline. | owner: Approve Sarvam tariff, total/day INR caps and calls/person/day.<br>another task: K9 project-owned document interpreter before stable runtime qualification. | Run ai/document-storey-agent.ts after gateway approval; score verified public demo facts. |
| ML-D2 | every value carries a verified quote; | partial | **E15** `storeyCount.alternatives[0]; labels; building.write`: G+42 and retained label alternatives carry quotes/locators and quote_at_locator; write=none.<br>**E16** `verify_item; filter_verified`: Implementation checks quote at source hash/page/region and numbers; not a route-run receipt.<br>**E17** `packet.quotationVerification; servedCodeCommit`: 54fb3522 persisted 10 proposals, but quotationVerification=not_machine_verified. | Route-integrated quote filtering before persistence, with accepted and rejected real-value receipts. |  | Wire quote filtering into ingestion/document-proposals.ts; check real packets and bad quotes. |
| ML-D3 | scored against the official RERA registry fields; | partial | **E12** `baseline; holdout.metrics; agent.metrics`: Rules holdout: 3 records, floor R=0.0 (0/3), P=null (n=0); unit truth n=0, scores null. Dev label recall=0.75 (3/4), explicitly d2_candidate_observation_not_truth; agent metrics=null.<br>**E14** `claimScope; dev.alternative`: Development-only comparison; units P=0.5 (1/2), R=0.25 (1/4); no new holdout claim. | Registry-scored agent development results and independently scoreable label/count coverage. | owner: Sarvam gateway spending approval; held-out documents still never go to a teacher.<br>data: Independent floor-label truth; blank official unit counts cannot be scored. | Extend storeys/a5/score.py receipts for verified agent dev outputs; keep blank truth null. |
| ML-D4 | Tower 3 stays `conflicting`. | proven_live | **E18** `servedNativeCheckout; tower`: 40f077d0; reviewed schedule conflicting; G+41/G+42 retained; expandedLevels=0.<br>**E19** `finalRuntime.servedCommit; step3.readBack`: fbe525f7 live canonical read stays conflicting after identity assignment; heights unknown. |  |  |  |

## Learner

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| ML-L1 | Stage A runs online; | proven_live | **E20** `runtime.codeCommit; learning; approval; qualification`: dac2a7cd live approval: v43 to v44, partialFitCalls=1, committedAfterUpdate=0. Lead-entered verified unknown labels; not independent officer truth or positive takeover. |  |  |  |
| ML-L2 | on a multi-chunk file and on a second, similar file, Sarvam calls per chunk drop while precision on committed fields stays 1.0, or the field abstains. | blocked | **E21** `teacherCallCurve; student.calibration`: Replay curves=[1,0,0] and [1,0,0] on 2 files; networkCalls=0; no cold-chunk improvement. Calibration precision=1 on 4 committed unknown fields / 6 fields; 0 positive commits.<br>**E20** `first.metrics; second.metrics; learning`: Live 33-row then 8-row files: teacherCalls all 0; accepted memory reused; no positive accuracy.<br>**E22** `arms[0]; heldOut`: 527 pooled fields: 0 positive commits, 53 unknown commits; heldOut n=2, 2 abstained. | A two-file live Sarvam call curve with committed-field denominators and explicit abstentions. | owner: Approve live Sarvam costs and spending limits.<br>another task: A4d verification/retrain/count receipt is not in Git; do not predict gain. | Qualify scripts/agent/measure-a4.ts via 2 API files; count calls, attempts and abstentions. |

## Sarvam teacher

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| AG-S1 | goes through the gateway with a budget ledger and structured output; | blocked | **E23** `inputs; tests; live; limitations`: 2 real inputs: 1 control reservation/settlement each; 131760 control micro-INR each; live.calls=0.<br>**E24** `checks[0]; ownerInputsMissing`: 10/10 config tests; tariff/caps unapproved; no live PostgreSQL ledger concurrency/restart proof.<br>**Manual/replay:** Manual needs_input and software-control structured outputs work; replay makes no paid admission.<br>**Live-only:** Actual Sarvam schema compliance, usage, price settlement and charged PostgreSQL call lifecycle. | One live structured Sarvam response with PostgreSQL admission, settlement and served-commit receipt. | owner: Approve tariff, total/day INR caps and calls/person/day. | Qualify model-gateway/gateway.ts with 1 public dev call; reconcile the PostgreSQL ledger. |
| AG-S2 | every response is recorded, and replay mode works; | blocked | **E23** `inputs[*].replayed; replay; live`: Both real input profiles replay recorded_software_control; replayPaidAdmissions=0; live.calls=0.<br>**Manual/replay:** Control recordings replay; manual/failure paths produce no fabricated provider answer.<br>**Live-only:** A genuine provider response survives redaction/storage and can be replayed byte-bound without charge. | A real Sarvam response recording replayed by input hash with no new provider dispatch or debit. | owner: Gateway tariff/spend approval before the first real recording. | Record/replay 1 approved scripts/agent/mapping-teacher.ts call; pin the served commit. |
| AG-S3 | it fails closed when credits or the network fail. | proven_offline | **E23** `failureModes; tests; invariants`: 15 new checks, 21 gateway/mapping checks, 0 failures; HTTP 402, quota, timeout/network controls.<br>**E25** `controls; qualification`: 3 failure controls: 16 questions each, candidateCells=0, providerDispatches=0; software-only.<br>**Manual/replay:** Credit/outage/replay-miss controls return manual needs_input; no key rotation or registry write.<br>**Live-only:** Actual provider outage/credit response and its ledger settlement remain unobserved, not required here. |  |  |  |

## Canonical vocabulary and MappingPlan v2

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| AG-V1 | covers building, parcel, unit, level, space and document facts; | proven_offline | **E26** `checks[1]; scope`: 13/13 canonical/mapping/adaptive tests passed; contract/executor foundation, not accuracy.<br>**E27** `CANONICAL_TARGETS`: Read catalogue defines all 6 fact domains; source code corroborates the executed contract checks.<br>**Manual/replay:** The same deterministic vocabulary is available to manual and replay plans.<br>**Live-only:** No live call needed for catalogue coverage; provider selection accuracy is a separate box. |  |  |  |
| AG-V2 | operations: copy, enum lookup, unit conversion with a sourced factor, literal parse, parent-key link; | proven_offline | **E26** `checks[1]; limitations`: 13/13 tests cover executor/units; gaj and regional units correctly needs_input, not guessed.<br>**E28** `executor controls; parent links; unchanged real NYC source`: Executed suite includes source copy, declared ft2 conversion, date parse and unique parent checks.<br>**E29** `UNIT_TABLE`: Code-owned NIST factors ft2=0.09290304, sq_yd=0.83612736; unsupported regional units abstain.<br>**E30** `t1bVerifiedExamples; fitTargetCounts`: 193/193 T1b fields verified, including 2 unit.type lookup examples; pseudo-labels, not truth.<br>**Manual/replay:** Code executes allowed operations from manual/replay plans; factors never come from the teacher.<br>**Live-only:** No live call needed for deterministic operations; successful provider proposals remain unmeasured. |  |  |  |
| AG-V3 | literals are rejected; | proven_offline | **E26** `literalRejections; checks[1]`: literal_epsg and literal_factor rejected: MAPPING_LITERAL_FORBIDDEN; 13/13 suite passed.<br>**E31** `stable literal rejection and target/operation/source/unit/parent checks fail closed`: Executed suite also checks coordinates, invented identifiers and tool=approve; test-only attacks.<br>**Manual/replay:** Manual and replay plans share the strict validator; literal injection controls are rejected.<br>**Live-only:** No live call required for rejection; resistance to real malicious provider inputs is unmeasured. |  |  |  |
| AG-V4 | works on tabular files (CSV/XLSX) and GIS attributes. | proven_offline | **E26** `inputs; checks[1]`: LGD CSV: 1 row/8 unknown cells; GMDA GIS: 2 rows/6 unknown cells; NYC positive seam test passed.<br>**E20** `runtime.codeCommit; first; second; xlsx`: dac2a7cd live CSV 33/8 rows; selected XLSX 60 rows, 4 SSE frames; propose-only, all unknown.<br>**Manual/replay:** CSV/XLSX live subset plus GIS offline checks; no cross-format positive accuracy claim.<br>**Live-only:** Provider meaning inference on unfamiliar layouts is separate; deterministic format support needs none. |  |  |  |

## The chunked loop

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| AG-C1 | order: memory → student → teacher → verifier → officer questions → deterministic executor; | partial | **E32** `controls; approvedLearningControl`: 30 focused tests; real bytes/local Python with SQL/S3 doubles; unapproved learning refuses.<br>**E33** `step1.after; step2.import; step3`: 4d03be3f; live new/memory/memory over 3 chunks; questions=9/0/0; teacher unavailable. TNHB: 102 draft rows/51 chunks; 1 replay attempt, 50 memory layouts; no approved positive plan.<br>**Manual/replay:** Live manual fallback and memory order work; replay misses; student positive takeover unproven.<br>**Live-only:** A real Sarvam answer traverses the same sequence; offline replay can qualify orchestration first. | A successful teacher/replay proposal verified, questioned, reviewed and executed in route order. |  | Qualify ingestion/chunk-mapping-agent.ts on a real dev table/control replay; assert order. |
| AG-C2 | progress over SSE; | proven_live | **E33** `step1.after; step2.import; step3`: 4d03be3f automatic dispatcher: 3 mapping SSE frames/3 chunks; TNHB 51 frames/51 chunks.<br>**Manual/replay:** Live SSE progress exists with gateway off and honest unresolved draft outcomes.<br>**Live-only:** Successful provider latency and teacher-response events are not observed; SSE transport needs none. |  |  |  |
| AG-C3 | nothing commits without review. | proven_live | **E20** `runtime.codeCommit; approval; learning; counts`: dac2a7cd: proposed-to-approved recipe precedes 1 partial_fit; registry lists/counts unchanged.<br>**E32** `controls.covered; design.authority`: 30 software checks include unapproved learning and tabular registry execute refusal.<br>**Manual/replay:** Drafts cannot write registry; approval gates memory/learning; tabular execution refuses.<br>**Live-only:** The review fence is shared; no successful reviewed tabular registry commit is claimed. |  |  |  |

## Document agent

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| AG-D1 | **Document agent:** wired into the existing document-proposal and decision routes. | partial | **E13** `sources[*].calls; sources[*].states`: 0 calls on every retained source; extractor run reports teacher_unavailable.<br>**E17** `servedCodeCommit; httpObservations; packet; qualification`: 54fb3522: POST201/GET200 for 10 caller-supplied proposals; not machine-verified agent execution.<br>**E34** `candidate_file; packet_for`: Rules emit compatible packet files, write=none; this is not agent route activation.<br>**Manual/replay:** Manual proposal persistence exists; storey agent controls are separate, not a wired route receipt.<br>**Live-only:** Real Sarvam document output reaches the proposal/decision routes after quote verification. | An agent-to-proposal adapter and accept/reject readback receipt through the existing routes. | another task: K9 stable project-owned interpreter; its result is not in Git.<br>owner: Live Sarvam route qualification needs approved gateway spending. | Wire ai/document-storey-agent.ts to ingestion/document-proposals.ts; check decision replay. |

## Evaluation JSON

| ID | box (verbatim) | state | evidence: key and proof | missing | blockedOn | smallestNextTask |
|---|---|---|---|---|---|---|---|
| AG-E1 | precision, recall and abstention per held-out family; | blocked | **E35** `truth; heldOut`: 5 families/97 columns: 55 documented unknown, 42 truth absent, 0 positives; abstention=1/family.<br>**E21** `heldOut.families; heldOut.gate`: Earlier 5-family receipt says truth_absent with precision/recall/abstention=null, not accuracy.<br>**E36** `newHeldout; targetShortfalls`: New set: 2 families/4 columns; 2 scorable positives; shortfalls=1 family and 23 positives.<br>**E22** `heldOut`: n=2 scorable: committed=0, correct=0, abstained=2; aggregate counts, not per-family accuracy.<br>**Manual/replay:** Safe abstention/count receipts exist; A3 and A4 differ in truth qualification, not positive proof.<br>**Live-only:** Live calls prove runtime costs, not blind accuracy; holdout families never reach any teacher. | An authorised adequately sized blind-family metric receipt with n and null-safe precision/recall. | data: Frozen blind data shortfall: target 3 families and 25 positive columns, actual 2/2.<br>owner: Authorise a new independent blind-data acquisition after two stopped attempts.<br>another task: A4d count-only retrain receipt not in Git; does not guarantee adequate truth. | Publish scripts/agent/measure-a4b.ts per-family count receipts; keep teacher truth closed. |
| AG-E2 | the teacher-call curve; | partial | **E21** `teacherCallCurve`: 2 replay files, 3 chunks each: [1,0,0]/[1,0,0]; networkCalls=0; studentCommits=0 each.<br>**E33** `step2.import.chunks; step2.import.teacher; step3`: Live attempts [1,0,0], not Sarvam calls; TEACHER_UNAVAILABLE; TNHB 1 attempt across 51 chunks.<br>**E20** `first.metrics; second.metrics; qualification`: Live actual teacherCalls all 0 over 3 first-file chunks and 1 second-file chunk; gateway off.<br>**Manual/replay:** Falling replay-attempt curves and memory reuse are proven; no falling paid-call curve exists.<br>**Live-only:** Real Sarvam calls/latency per chunk across two files, with approved decisions and abstention counts. | An evaluation JSON separating paid network calls, replay attempts, memory reuse and committed-field n. | owner: Approve live Sarvam tariff/caps for the paid-call curve. | Extend scripts/agent/measure-a4.ts curve JSON; join 2 live imports with accuracy counts. |
| AG-E3 | real injection cases where they exist. | partial | **E26** `literalRejections; checks[1]`: 2 recorded literal rejection cases; 13/13 tests. These are software controls, not real attacks.<br>**E31** `stable literal rejection and target/operation/source/unit/parent checks fail closed`: 5 injected operation keys are test-only; no real-file injection count/screening receipt opened.<br>**Manual/replay:** Literal/identifier/tool controls reject unsafe plans; genuine source attacks unqualified.<br>**Live-only:** Live adversarial behaviour is unmeasured; real-file/manual replay checks need no provider. | A scoped real-development-input injection receipt, or an explicit no-real-case-found gap with n. |  | Add a gf-agent injection disposition receipt on approved dev inputs; check real-case n. |

## WORKS — 1. Can close before 14 October without owner input

1. AG-E3, 1-2 hours: Record scoped injection-case availability on approved public dev inputs; do not invent an attack
   file.
2. ML-D2, 4-6 hours: Integrate quote filtering into proposal persistence; check real rules packets and bad quotes.
3. AG-C1, 4-6 hours: Qualify the full loop on a real table with recorded software-control replay and officer review.

- These close at proven_offline or manual/replay runtime scope, never a claim of live Sarvam success.
- B9 and A4d can finish already approved work without new owner input, but no missing box is guaranteed to pass.
- After K9, document wiring can be built/checked offline in 6-10 hours; full live-agent closure still needs policy.
- ML-P1 needs supplied vector pages, not an owner decision; no acquisition or inference substitutes for them.

## WORKS — 2. Cannot close without the owner

- AG-S1, AG-S2, ML-D1, ML-D3, ML-L2, AG-D1, AG-E2: What approved INR per million input/cached/output tokens, total
  INR, INR/day and calls/person/day?
  Confirm funding/privacy policy; private/restricted documents stay excluded; lead supplies bounds.
  Policy fields: `docs/backend/DEMO-GATEWAY.md:58-77`.
- AG-E1: May a new blind-data task acquire 1 more family and 23 more documented positive columns?
  Current count is 2 families/2 positives vs target 3/25; never expand or tune the frozen set.
- ML-B2: If B9 misses, keep the unmet recall gate visible or approve a scope change from R>=0.70?
  No decision or extra holdout run is assumed; B9 outcome is unknown.

## WORKS — 3. Claims unsupported as a statement of today

Historical receipts remain intact; superseded snapshots are not accusations that the earlier run was false.

| File and line | Claim | Correction |
|---|---|---|
| `docs/STATUS.md:22` | Indian labelled data is still blocked; 0 eligible pairs. | Historical paragraph is stale today: B1 records 6288 Karnataka pairs, publisher-reviewed. |
| `docs/STATUS.md:27` | No model has been trained. | Historical paragraph is stale today: B3 records 4 completed epochs and an epoch-4 holdout run. |
| `docs/STATUS.md:28` | 0 of 30 tests with any receipt or attempt. | Not a gate-pass claim, but no attempts/receipts is stale; K2c, K3b and J1b have scoped receipts. |
| `docs/STATUS.md:37` | No code, packet, card or QR exists yet; serves 9aad8da2. | Same row later contradicts it: R3 assigned/generated; R4/J1b serve 83965a21. |
| `docs/STATUS.md:38` | Holdout P 0.836 / R 0.649 and transfer P 0.830 / R 0.355, without n. | Use exact scoped numbers/denominators; B3 P n=7127/R n=9182; transfer P n=10874/R n=25409. |
| `docs/STATUS.md:39` | Magnolia CAD: 18 exact vector rooms. | 18 candidates, 17 labels, 10 dimension pairs; 1 mismatch/8 unknown; diagnostic scale, not exact. |
| `docs/STATUS.md:45` | No server read lists a unit's cards; card/Verify browser-only. | R3 lists 1 card via API; F3d is already recorded in the live-state row; old clause is stale. |
| `docs/STATUS.md:58` | K5 revocation running; live card comes from R2; last evidence only offline. | R3 applied the table and generated/verified the card; J1b has live card reads; R2 stopped earlier. |
| `docs/STATUS.md:59` | GF5 last real evidence: none. | J1b records 11 pass/2 skipped; partial, but not no evidence. |
| `docs/STATUS.md:70` | P3 code exists; no input wired. | R3 source-stated UNIT-3B input was reviewed and assigned; geometry remains absent. |
| `docs/STATUS.md:71` | The journey generates a card each run. | J1b check mode reads only; write mode refuses before requests; 24h expiry needs separate action. |
| `docs/evidence/gf-ai/building/b3/result.json:1` | registered=false; serving_activation_allowed=false. | Historical B3 state, contradicted if read as current: B5 v2 qualification/K2c demo serving. |
| `docs/evidence/gf-ai/building/rfdetr-ramp-ka-seg-medium-b3-v1/model-card.json:1` | Inactive/not activated/installation not performed. | Historical/default registration scope; K2c demo profile explicitly activated and served the model. |
| `docs/evidence/gf-agent/a3d/result.json:1` | teacherCalls=1, teacherFields=16 in first runtime chunk. | Its own disposition says replay unavailable; no provider call. R1 repeats this provenance defect. |
| `docs/evidence/gf-agent/a4c/result.json:200` | 13 positives never clear the pooled threshold. | Current fitExamples=591, unknown=576, registrationNo=4 (A4b=2); 13 describes earlier fitting. |
| `docs/evidence/gf-agent/a4c/result.json:258` | 13 positives in 585 examples. | Gap repeats earlier 585; current fitExamples=591/unknown=576/registrationNo=4; do not mix counts. |
| `docs/evidence/gf-agent/a3e/result.json:19` | Machine-readable result.json receipt. | Adjacent string fragments at lines 18-19 invalidate JSON; json.load exits 1 at line 19 column 7. |
| `docs/evidence/gf-ai/storeys/a5b/result.json:1` | decision.alternativeReplacesBaseline=true. | Conclusion says beside, not instead: loses G+42 and lowers unit precision/basement recall. |
| `docs/evidence/runtime/r3/result.json:542` | snapshots: +2. | R4 item3Listing.differences records 4 stored snapshots; R3 counted response manifests, not rows. |

## Disagreements — keep both, do not pool

- B3 raw tensor parity failed; B5 final-instance parity passed on the same 20 DEV chips. Keep both protocols.
- B3/card inactive statements vs K2c demo-active serving are historical/default versus runtime scope.
- A4 says old heldout truth absent; A3 scores 55 unknown/97 columns with 0 positives. Neither proves accuracy.
- A4c narrative 13/585 vs fitExamples=591/unknown=576/registrationNo=4; never pool or recalculate precision.
- A5b alternativeReplacesBaseline=true vs conclusion beside baseline; no automatic full-route replacement.
- A3c teacherCalls all zero vs R1/A3d 1-attempt cold chunks; these are different attempt-counting semantics.
- R3 says snapshots +2; R4 read 4 and traces the extra review/pre-assignment snapshots. Keep both receipts.
- preregistration.json storeys pending/holdout_runs_allowed=false vs A5 holdout run_once: scope unreconciled.

## Pending work is not proof

- B9: model retrain; A4d: separate verification and retrain; K9: document interpreter.
- K3d: source-stated heights; no M1 box requires guessed heights or real prisms.
- F3e, K10, H5: Studio/card work, not prerequisites for these M1 API checklist boxes.

## GAPS

- M1 cannot honestly be declared done: Sarvam live proof missing, recall target missed, blind positives too sparse.
- No files under E:/BhuAayam-data are needed to perform this audit; upstream workers supply missing receipts.
- No unit-count/label accuracy is implied by null official truth or D2 candidate transcriptions.
- Owner runtime-receipt repin remains a separate contract-check blocker; this task does not repair it.
- The quote-at-locator code normalises OCR region text; it does not independently prove OCR transcription truth.

## Evidence index — opened files only

| Ref | File |
|---|---|
| E01 | `docs/evidence/gf-ai/building/b1/result.json` |
| E02 | `docs/evidence/gf-ai/building/b2-installed-holdout-20261010/result.json` |
| E03 | `docs/evidence/gf-ai/building/b3-final-holdout-20261010/result.json` |
| E04 | `docs/evidence/gf-ai/preregistration.json` |
| E05 | `docs/evidence/gf-ai/building/rfdetr-ramp-ka-seg-medium-b3-v1/model-card.json` |
| E06 | `docs/evidence/gf-ai/building/b5/result.json` |
| E07 | `docs/evidence/gf-ai/building/b3-final-export-parity-20261010/result.json` |
| E08 | `docs/evidence/gf-backend/k2c/result.json` |
| E09 | `docs/evidence/gf-ai/plans/vector/20261010-p1-structure/post-merge/result.json` |
| E10 | `docs/evidence/gf-ai/plans/vector/20261010-p1/result.json` |
| E11 | `docs/evidence/gf-ai/plans/raster/20261011-tower3/result.json` |
| E12 | `docs/evidence/gf-ai/storeys/a5/result.json` |
| E13 | `docs/evidence/gf-ai/storeys/a5/agent-receipt.json` |
| E14 | `docs/evidence/gf-ai/storeys/a5b/result.json` |
| E15 | `docs/evidence/gf-ai/storeys/a5/candidates/haryana-2831-tower3.json` |
| E16 | `scripts/usp/learning/storey_quote_verifier.py` |
| E17 | `docs/evidence/usp/nest-migration/runtime-source/d08-document-proposals-20261005.json` |
| E18 | `docs/evidence/gf-t16/k3b/result.json` |
| E19 | `docs/evidence/runtime/r3/result.json` |
| E20 | `docs/evidence/gf-agent/a3c/result.json` |
| E21 | `docs/evidence/gf-agent/a4/result.json` |
| E22 | `docs/evidence/gf-agent/a4c/result.json` |
| E23 | `docs/evidence/gf-agent/a2/result.json` |
| E24 | `docs/evidence/gf-agent/g1/result.json` |
| E25 | `docs/evidence/gf-agent/a3/failures.json` |
| E26 | `docs/evidence/gf-agent/a1/result.json` |
| E27 | `packages/contracts/src/canonical/targets.ts` |
| E28 | `packages/server/src/modules/usp/ingestion/mapping-executor.test.ts` |
| E29 | `packages/server/src/modules/usp/ingestion/unit-table.ts` |
| E30 | `docs/evidence/gf-agent/a4b/result.json` |
| E31 | `packages/server/src/modules/usp/ingestion/mapping-plan-v2.test.ts` |
| E32 | `docs/evidence/gf-agent/a3b/result.json` |
| E33 | `docs/evidence/runtime/r1/result.json` |
| E34 | `docs/evidence/gf-ai/storeys/a5/candidates.py` |
| E35 | `docs/evidence/gf-agent/a3/result.json` |
| E36 | `docs/evidence/gf-agent/d1c/result.json` |
| E37 | `docs/evidence/runtime/r4/result.json` |
| E38 | `docs/evidence/gf5/j1b/result.json` |
| E39 | `docs/evidence/gf5/f3d/result.json` |

Supporting receipts for board corrections:

| Ref | Key | Proof |
|---|---|---|
| E37 | `finalRuntime; item3Listing.differences` | 83965a21; R3 stored 4 snapshots, not the 2 inferred from R3 responses. |
| E38 | `run; checks.writeModeRefusal` | 83965a21: 11 pass/2 skipped; check mode reads only; write mode refuses before requests. |
| E39 | `served; browserChecks; notVerified` | 83965a21 API plus worktree Studio: live unit card/PDF/verification; other states mocked. |

## Git chronology (no runtime operation)

- preregistrationCommit: `7d33e221080d814ef5d7732f490c1a63eaaeedc2`.
- preregistrationCommittedAt: `2026-10-10T00:46:45+05:30`.
- baselineCodeCommit: `819f7bed2117109b9c924d0c50043cdbc230c25a`.
- baselineCodeCommittedAt: `2026-10-10T01:20:13+05:30`.
- baselineRunAt: `2026-10-09T19:52:11.623940+00:00`.
- ancestorCheckExit: `0`.

## Checks

These validate this reading audit, not M1 runtime behaviour; exact details are in `audit.json#checks`.

| Check | Exit | Result |
|---|---:|---|
| `python -B -c "import json;json.load(open('docs/evidence/m1/audit.json',encoding='utf-8'))"` | 0 | JSON parses. |
| `python -B docs/evidence/m1/check_paths.py` | 0 | 43 paths exist; no source contents opened by the checker. |
| `git diff --check` | 0 | Whitespace check. |
| `python -B` inline checklist/fields and non-table line checks | 0 | 26 verbatim ordered boxes; Markdown lines <=120. |
| `git merge-base --is-ancestor 7d33e221 819f7bed` | 0 | Preregistration precedes baseline code/run. |
| `python -B -c` with `json.load` on A3e result | 1 | Source defect at line 19; recorded, not repaired or retried. |
