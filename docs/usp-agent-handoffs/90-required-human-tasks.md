# 90 · Human inputs — the short list

**Rewritten 25 September 2026.** Agents do the data, labelling, oracle and verification work. The earlier human tasks H1–H10 are now agent task cards (table below). Any permitted geography is fine: Indian data is preferred where it exists, and foreign data is labelled `test_only`. There is no Delhi or single-locality requirement. The data sources are already documented in [H23](23-india-data-and-delivery-plan.md) and [H28](28-data-acquisition-and-finale-tests.md) (data.gov.in first).

## The short list

| # | What a person does | When | Why an agent can't |
| --- | --- | --- | --- |
| 1 | Present at the finale: run the demo laptop, present, answer judges | Finale day | Physical presence |
| 2 | Submit the PPT and any registration on the SIH portal | Before the deadline | Only the team leader holds that login; agents prepare the files (LEAD-04, DEPLOY-04) |
| 3 | Approve what the project claims publicly: claim waivers (a test that stays open) and the GF5 freeze | At GF5, or when LEAD-01 raises a waiver | Owner's decision on public claims |

Two more only if an agent asks for them:

| # | What a person does | Trigger |
| --- | --- | --- |
| 4 | Put the existing provider key in the local `.env` | Only if a live model call should appear on stage; otherwise the demo uses labelled replayed responses (H19 Z2) |
| 5 | Create a free data.gov.in account and add its API key to `.env` | Only if DATA names a specific resource that cannot be downloaded without one |

Never paste keys into chat, Git, screenshots or logs.

## Moved to agents

| Old ID | Was | Now | Card in [H29](29-agent-task-cards.md) |
| --- | --- | --- | --- |
| H1, H1a | Get a building sample from a record holder | Public plan bundle: Bihar RERA sanctioned plan (retry Haryana RERA 2831/2079 attachments once), plus one open multi-unit dataset as `test_only` | DATA-05 |
| H1b | Request an aligned block from a survey or revenue office | Not needed for the finale. Record D7 as `failed(permission_required)` citing `demo-data/real-block`; GF-T18/T20 use D0 authored truth | DATA-01 |
| H2 | Domain reviewer states rules and terminology | Review policy filled from public statute text (RERA 2016 s.2(k), s.17; apartment and co-operative acts), labelled "sourced policy, not a departmental rule" | READY-02 |
| H3, H3a | Approve deployment accounts and provider funding | Finale runs `local_demo` and `local_demo_offline`. Provider: fake and replay adapters by default, one budget pool, rollover off. Short-list item 4 only if a live call is wanted | DEPLOY-01, DEPLOY-02 |
| H4 | Observe a person using the workflow | Automated task-completion journeys, keyboard, focus and axe checks at 1440 and 390 px. Human observation is optional and never claimed | UI-07 |
| H5 | Choose a site and get consent | Choose public licensed bundles instead; tenure cases (co-op, per-deed) come from synthetic fixtures | LEAD-05 |
| H6 | Independent person labels test data and hand-calculates oracles | Third-party human-labelled benchmarks with frozen, hashed holdouts; arithmetic oracles written by a different model family before the implementing commit | DATA-07, DATA-08 |
| H7 | Fly a drone with ground control | Open drone datasets with published ground control points; hold some out as checkpoints | DATA-06 |
| H8 | Sign-ups, access requests, GPU | Open-download sources only; drop request-access datasets; CPU ONNX routes already exist; fine-tuning optional | DATA-01 |
| H9 | Timed human study and finale logistics | Scripted timing receipts (labelled "scripted, not a human study"); frozen-machine runs, local tile and font cache, recorded backup video, PPT export | UI-07, DEPLOY-04 |
| H10 | Training permission, promotion policy, signing key, grievance contact, identity provider, SMS registration | Not used in the finale. Receipts stay "hashed"; learner auto-promotion default is "off". The rest are full-product prerequisites below | LEAD-01, full-product cards |
| Gate sign-off | A named person approves every gate | A cross-family agent review completes GF0–GF4; the owner approves only waivers and the GF5 freeze (short-list item 3) | LEAD-01 |

## Rules agents follow instead of asking

- Use documented sources first (H23, H28 section 3–4 and Z4). Record licence, bytes, hash and stage for each asset.
- Never bypass a login or CAPTCHA, create accounts, submit applications, buy data or use a paid provider. If a resource needs any of these, pick the documented open alternative and record `failed(<reason>)`.
- Never fabricate survey facts, heights, ownership or controls. A missing authentic input blocks only that specific real-world claim; the software work continues on D0 and open data.
- Label every dataset by geography and purpose (`operational_india`, `test_only`, `authored_demo`).

## Full-product prerequisites (not finale)

These return only when FP-DEPLOY or FP-PUBLIC starts: approval of deployment profile and service destinations, identity provider, scanner and mail service, public-release policy, DPO or grievance contact, TRAI DLT registration for SMS, written permission to train on provider outputs, and custody of any receipt-signing key. The FP card that needs one names it; no finale work waits on them.
