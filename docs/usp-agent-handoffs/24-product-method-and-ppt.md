# 24 — Product story, measurable claims and PPT plan

**Aligned 24 September 2026.** This is presentation guidance, not evidence of completed implementation. [H00](00-README.md) and [release-plan.json](release-plan.json) define release scope; H26–H28 define the technical/data/test claims. Present equal emphasis on adaptive ingestion and the officer outcome.

## What we are building

**3D ULPIN: turn fragmented survey and property evidence into traceable 3D spaces and reviewable property decisions.**

The officer follows **Identify → Prove → Govern**: identify a surface/vertical/underground space with a proposed project ID; inspect exact geometry, source revisions and uncertainty; then review quantities, relationships, discrepancies or infrastructure impacts and generate a scoped property card. AI assists source interpretation and domain extraction; accountable review and deterministic checks govern records.

| Value | How it is built | What demonstrates it |
| --- | --- | --- |
| Less repeated preparation of incompatible inputs | Qualified readers, constrained agent mappings, bounded source-preserving jobs and saved progressive SSE updates | Actual unfamiliar supported-layout intake, stable originals, useful map before completion, explicit unresolved records |
| A property decision that can be explained | Immutable project IDs; evidence links; physical versus legal-space semantics; exact revisions | Select a unit/duplex/basement, explain a finding and open its source; preserve the same identity after correction |
| Useful governance checks | Qualified geometry, declared UDS, defined carpet components, aligned revision comparison and coverage-aware dig screening | Independent GF-T16–20 expected cases, uncertainty and legitimate non-conflicts |
| Proof that can be shared safely | Existing packet service with a card subtype and access-checked revision QR | Correct card, wrong-unit denial, release/revocation checks and no sibling source leakage |

“Standardized” means a **versioned proposed project profile with documented mapping/exchange**. Do not call our ID an officially issued ULPIN, claim certified LADM compliance, or promise a legal-title determination.

## How we build it

**Preserve original → qualify source/reference → partition → interpret/process → validate candidates → officer review → versioned record → scoped card.** Saved assets and the durable outbox drive progressive SSE. Specialist image/point-cloud/plan algorithms generate candidates; an LLM does not invent surveyed coordinates or ownership. Unsupported and unknown remain visible.

Use Next.js, the current shared Cesium runtime, PostgreSQL/PostGIS, private object storage, Redis/Celery and Python. SFCGAL/roofer/val3dity are capability-qualified tools, not a guarantee that arbitrary surfaces are valid solids. CityJSON plus a rights/provenance sidecar is the minimum exchange profile. Helsinki informs semantic city/context separation; optional Three/R3F evaluation belongs to the full-product roadmap.

Sarvam supports the proposed India-resident runtime architecture with governed calls. Verify the selected model/API licence, endpoints, retention and the full app's storage/log/backup/egress boundary. Open-source weights for one product do not establish the hosted service's licence or residency. Until qualified say **“designed for India-resident private processing”**, not “all data always stays in India.” Public released information can reach external browsers. Teacher-derived training requires the applicable recorded permission.

## Separate PPT page — slide-by-slide plan

Use a clear visual and at most one core claim per slide. Label screenshots and data as authored demo, real exterior, planned drawing or qualified survey. Keep engineering logs in an appendix; show the source/evidence action in the actual product.

| Slide | Put on the slide | Demonstrate / avoid |
| --- | --- | --- |
| 1 — Problem and outcome | A stacked building, basement and parcel diagram; “Identify → Prove → Govern” | State the officer decision and fragmented-input problem; do not simply repeat the SIH statement |
| 2 — Two equal USPs | Adaptive evidence ingestion beside traceable 3D review | Show input diversity and a source-linked decision with equal visual weight |
| 3 — What the finale includes | GF1–GF4 workflow strip: proposed ID, spaces/domain AI, governance checks, card | Separate implemented evidence from planned gates; include elevated/underground and shared spaces |
| 4 — AI doing useful work | One before/candidate/review example for each H27 domain pipeline; exact source/model version | Report task-specific accuracy and corrections only if measured; schema learning is not the four domain tasks |
| 5 — 3D and trustworthy quantities | Current Studio view with floor/duplex/basement selection, uncertainty and component quantities | Explain contact versus overlap, incomplete data and supported solid profile; pretty clipping is not analysis |
| 6 — Governance demonstration | A legitimate shared-space case plus one independently verified deviation or dig warning | No automatic “illegal construction” or “safe to dig”; display controls, tolerances and coverage gaps |
| 7 — Property proof card | Sanitized card and revision QR with evidence scope | Resolve in same-device authorized loopback mode; label local demonstration. Phone scanning is conditional on a separately qualified protected read surface. QR is no authorization or official title |
| 8 — Data, standards and measured results | Small dataset lineage diagram, proposed ID/CityJSON/sidecar/LADM mapping and 4–6 honest metrics | Distinguish data.gov.in context, matched evidence (geography labelled), D0 authored truth and foreign benchmark tests |
| 9 — Roadmap and adoption | Finale delivered/pending matrix; next full-product gates | Preserve learner, separate public request dashboard, MCP, broader formats/enrichment, optional R3F and scale; no claim these are already built |

Appendix: requirement-to-test matrix, model/licence/data permissions, coordinate/vertical references, card privacy tests, supported formats/geometry, limitations and failure/recovery receipts. Keep every headline traceable to an artifact.

## Coherent six-minute rehearsal target

Freeze one matched building from any permitted source (labelled by geography; Indian where available) with two source-supported levels and one shared/limited-common relationship (from D0 unless a public source supplies it), plus the evidence needed for its claimed quantities. Show a real-source comparison only where both sources actually match. Keep seeded adverse cases clearly labelled. For an underground example without matched real records, switch explicitly to the authored fixture; do not place unrelated real utilities beneath the Indian property.

| Target time | Action in the actual product | Evidence boundary |
| --- | --- | --- |
| 0:00–0:45 | Show retained inputs, provenance, source profile and a useful progressive scene | Distinguish receipt/preparation time from live incremental display |
| 0:45–1:45 | Inspect AI candidates and the review action; open exact source locators | Heavy reconstruction may be retained output with its measured runtime visible; no invented live training |
| 1:45–3:00 | Select the same unit/duplex/common space and show proposed ID, level limits, UDS/carpet components | Quantities/rights only where source-supported; expose unknowns |
| 3:00–4:00 | Open a revision comparison and a legitimate non-conflict case | Exact versions, independent controls and seeded-versus-real labels |
| 4:00–5:00 | Show existing IMPACT0 with mapped intersection and unknown coverage/depth | Screening is not safe-to-dig clearance or an official Call Before u Dig submission |
| 5:00–6:00 | Generate/open the card, decode its local QR and resolve the same revision; show test metrics and limitations | Card, viewer and exchange share identity/revision. A backup recording is labelled; phone scanning is separately gated |

These are rehearsal allocations, not measured timings. If the authentic matched bundle is missing, demonstrate authored software truth and separate real-source samples with the gap stated. Do not claim the real-Indian interior/rights lane passed. Save the actual full run and timings under GF-REHEARSAL.

## Statistics and parameters to show

| Metric | Calculation / evidence | How to label it |
| --- | --- | --- |
| Input coverage | Qualified formats/versions and matched source families, not number of extensions accepted | `qualified X / planned Y`; acquired differs from catalogue-listed |
| Processing outcome | Accepted/rejected/unresolved counts reconciled to unique source objects | State dataset size, bytes, complexity and source release; no cloned-object scale |
| Time to useful scene | Receipt start → first persisted selectable geometry; preparation and total time separately | Median/p95 over declared runs/device; do not omit costly reconstruction |
| AI quality | Per-task precision/recall/IoU, boundary/level error, abstention and correction effort | Denominator, independent labels and untouched holdout; do not transfer external benchmark scores |
| Geometry/identity correctness | Independent numeric oracle error; checksum/lifecycle/roundtrip tests; unsupported count | Tests passed/total at exact commit, not vague “100% accurate” |
| Interaction | Selection/frame p50/p95 and peak resident resources on declared device | Targets remain targets until measured; no software-WebGL claim of hardware performance |
| Workflow effort | Scripted runs (UI-07): officer inputs and machine time, assisted versus `manual_mapping`; no human-time savings claim | Report protocol/sample count; no invented officer adoption or percentage savings |
| Privacy/resilience | Wrong-unit/revocation/injection tests, crash/replay recovery and missing-data outcomes | Report exact tested scenarios and remaining gaps, not “fully secure” |

Suggested initial interaction targets retained from H22: first useful local scene within 8 seconds **after admitted prepared inputs**, cached selection feedback within 100 ms, desktop frame-time p95 at most 33 ms on declared hardware. Also show full end-to-end latency. These are targets, not this repository's measured results.

Use a visible status key: **implemented and tested / implemented but unqualified / planned / blocked by named evidence**. The only inherited local baseline is the recorded D0/PACK0 and D1 result at its revision; new GF gates remain pending. Never fill an empty metrics cell with an aspirational number to make the project appear complete.

## Full-product value retained

The separate public data-request/evidence dashboard lets citizens find released properties, submit private evidence/discrepancies, respond to clarification and track their own cases. It requires H13 privacy/quarantine/authorization and reviewed recording, not an exposed officer view. H21 adds real concurrent schema learning and qualified pending-work handover. H25 expands adapters and labelled visual enrichment; H18 adds bounded grounded assistance/MCP. These remain planned follow-on capabilities, not finale dependencies.

UX4G-guided interfaces and GIGW 3.0/WCAG 2.1 AA are design/review targets for delivered surfaces, not certification or government endorsement. References and precise gates are in H25. Do not imply official ownership through government identity/emblems.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. Task card: [H29](29-agent-task-cards.md) LEAD-04.

### Z1. Slide changes

The problem is titled "3D ULPIN Generation", so identity gets its own slide, and the caveats move to one place instead of every slide.

| Slide | Change |
| --- | --- |
| 2 — Two USPs | Keep equal weight, but lead with the four SIH AI tasks (building extraction, floor segmentation, vertical delineation, topology validation), with intake as the enabler |
| New 3 — 3D identity | The `P3` code beside its readable location (`MH2507A1B3C4D5 / S01 / F07 / R003`, [H26](26-identifiers-and-standard-exchange.md) Z1), the official-anchor state, level limits with their named vertical reference, and the lifecycle draft → assigned → retired. Line: "Proposed project code; the state's ULPIN is unchanged." |
| 6 — Governance | Deviation is a labelled seeded case unless a matched real pair exists; dig output is a "screening report", never a notice or clearance |
| 8 — split in two | 8a Standards: CityJSON 2.0 plus sidecar, LADM mapped-field percentage, 3D Tiles as display only. 8b Measured results: the metric cards in Z2 |
| New 10 — Trust model | The one slide that carries the caveats: estimated vs measured, unknown vs zero, project code vs official ULPIN, screening vs clearance, chain consistency vs authenticity |

Positioning line for slides 1 and 9: "NAKSHA maps the buildings; we identify, prove and govern the spaces inside them." Appendix adds the judge Q&A from the plan review, relabelling any scale answer (3D Tiles or 3DCityDB at city scale) as roadmap. If SIH 2026 mandates a PPT template, map these slides onto it.

### Z2. Named metric cards

| Card | Source test |
| --- | --- |
| Building footprint IoU on held-out tiles | GF-AI |
| Plan room-boundary error and storey-count accuracy | GF-AI |
| Units needing no officer edit (%) | GF-AGENT and GF-AI review logs |
| Seeded-error recall and false alerts on clean twins | GF-T18, GF-T19 |
| Carpet-area error against the hand calculation | GF-T17 |
| Scripted time to card and officer inputs, assisted vs manual | UI-07 and GF-REHEARSAL receipts |

Empty cards stay empty with "not yet measured".

### Z3. One Sarvam line

Use one line on every slide and page: **"Designed for India-resident processing; Sarvam is the selected provider behind a provider-neutral gateway."** H23 and H25 link here instead of keeping their own versions.
