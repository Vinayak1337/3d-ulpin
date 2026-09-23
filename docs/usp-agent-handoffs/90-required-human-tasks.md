# Required human inputs — narrow gates, not engineering assignments

**Account/delegation update, 23 September 2026:** [02 - Astra Max lead and explicit worker delegation](02-lead-agent-execution.md) keeps engineering with agents; [20 - Sarvam gateway, credit pools and permanent credential retirement](20-model-gateway-and-budget-pools.md) defines the narrow runtime credential/funding prerequisites. Never request raw keys in chat or Git.

Revised 22 September 2026. Read [00](00-README.md) for agent-owned D0–D7 packs and [01](01-shared-contracts-and-ownership.md) for implementation contracts. This file does not assign coding, general research, schema design, data conversion or routine testing to teammates. No item here blocks F0, D0 or the local V0 visual workflow.

## 1. What agents do without asking people

DATA obtains permitted open samples, checks source bytes/schema/licence, creates exact manifests/oracles and bounded acquisition scripts. Feature agents implement parsers, APIs, persistence, reviewed proposal flows, tests and supporting fixtures. FND/UI coordinate shared code through the patch protocol. Agents create the blank sanitized templates below themselves; a teammate need not create a repository, spreadsheet, schema or fixture.

Use documented defaults and fallbacks. After the bounded acquisition attempts in 00, record the failure and continue the supported D0/local path. Do not repeatedly ask the user for the same inaccessible archive or claim a catalogue is downloaded data. Never bypass authentication/CAPTCHA, purchase data or submit applications without explicit authorization. Real persons are needed only for an actual record/permission/account or intended-user observation unavailable to the agent.

## H1. Obtain a matched permitted building or survey sample

**Why:** authentic internal plans, authoritative parcel/road boundaries, source accuracy and record-to-property matches cannot be invented. Only ask after DATA has tried the relevant open acquisition route and produced a specific missing-item list.

### H1a — D5 one planned/known building

Agent first checks [RERA project 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831) and [2079](https://haryanarera.gov.in/view_project/project_preview_open/2079). Prior indices were readable but selected attachments failed; no sufficient drawing bundle is assumed. If inaccessible, ask a willing campus/building/property record holder for this bounded set:

| Needed item | What the holder should confirm, or mark not supplied |
| --- | --- |
| Site/building reference | Named tower/building and phase; drawing/site relationship; any placement controls |
| One representative floor plan | Exact floor(s) it applies to, unit labels, dimensions/scale and drawing revision |
| Section or level schedule | Supplied lower/upper levels, units and stated vertical reference; no guessed floor height |
| Relevant shared clause/record | Which selected space or shared access it concerns; permitted use and any necessary redaction |
| Optional second dated drawing | Same building/purpose with a stated revision/date for HISTORY; do not invent an earlier version |

**Exact human steps:** obtain permission for research/demonstration, request only these items, pass the originals to approved restricted storage and answer known context questions. Do not ask the holder to digitize plans, select CRS software or decide whether a geometric crossing is unlawful. Agents inspect/digitize, preserve evidence and report unknowns.

**Output:** agent-created `sample-manifest.csv` with `sample_id,source_family,file_reference,publisher_or_holder,permitted_use,permission_reference,building_phase,applicable_levels,drawing_revision,source_date,stated_units,stated_frame,stated_vertical_reference,known_match,contains_personal_data,unknowns`. Unknown is a valid answer; no credentials in references. Only sanitized metadata may enter proposed `docs/usp-validation/samples/`; private originals remain outside public Git.

**Dependent outcome / fallback:** D5 real-source qualification for PACK/INGEST/HISTORY/RIGHTS/UI. Use D0 for software completion while waiting. A supported local-frame building can be inspected before geographic placement; do not fake coordinates or call a proposed plan as-built.

### H1b — D7 one aligned authoritative block

For actual boundary/rights screening, request the available aligned subset for any selected pilot area through the appropriate survey/revenue office or road/utility custodian. The problem-statement/nodal contact, [NAKSHA](https://dolr.gov.in/en/about-naksha/) and [Delhi Land Records](https://dlrc.delhi.gov.in/) remain optional Indian routes, not mandatory locality choices. Request one small aligned area, not an entire city: parcel/recorded-road GIS, source identifiers, control/reference metadata, acquisition dates and permitted record links. Point cloud, ORI, DEM/DSM and underground profile/as-built data are separate optional items; unavailable layers should be explicitly marked unavailable.

**Output:** same manifest plus `layer_role,identifier_scheme,coordinate_reference,vertical_reference,accuracy_statement,acquisition_date,association_evidence,inventory_completeness`. Agents convert it to the pack schema and tests. A building outline cannot be substituted for a parcel; an OSM centreline is not a recorded road-land boundary.

**Dependent outcome / fallback:** authentic FIND/IMPACT boundary or utility claims. No complete public crosswalk is presumed for the selected area. Under the 24 September 2026 dataset policy, D3 real 3D, high-load and unfamiliar/sparse-source acquisition is geography-independent and remains agent work; it does not wait for this human request. Missing D7 blocks only the corresponding real-world claim, not D0 or map/load/adaptation tests.

## H2. Qualify real workflow terminology and shared-clause applicability

**Why:** a real department's documentary acceptance rules and a particular shared clause's applicability need accountable domain evidence. Agents implement the demonstration `technical-review-v1` policy from [11](11-evidence-readiness-and-review-queue.md) without waiting for an interview.

**Steps:** the agent prepares six D0 cases: missing height, ambiguous building match, shared stair, parcel-only overlap, unit correction and mixed-property extract. A reviewer states the needed fact, acceptable evidence, permitted next action and terminology. Distinguish personal workflow preference from a rule with a named source. Ask for batch-level feedback, not approval of each agent code change.

**Output:** agent-provided `review-cases.csv` containing `case_id,reviewer_role,task,missing_fact,acceptable_evidence,expected_action,applicable_shared_context,terminology,rule_reference,unknowns,review_date`. Personal contacts are unnecessary. Sanitized answers go to proposed `docs/usp-validation/review/`; restricted guidance stays in approved storage.

**Dependent outcome / fallback:** pilot policy and real applicability qualification for READY/PACK/RIGHTS/CITIZEN. Until supplied, use the explicit synthetic technical policy and authored applicability fixtures; never market those as official requirements. Domain feedback is not needed to implement APIs or decide transaction design.

## H3. Authorize actual deployment accounts, processing terms and public release

**Why:** agents cannot grant institutional IdP access, approve external disclosures or prove contractual processing locations from a vendor page.

**Steps:** the accountable deployment owner approves local_demo/india_private/public_interoperability, permitted service destinations, actual IdP configuration, model/backup/log arrangements, scanner and optional mail service, and the exact public-release policy. DEPLOY supplies concrete configuration requirements and tested defaults. Credentials are entered through the approved secret mechanism, not this chat, a Markdown file or GitHub issue. No automatic purchase, provisioning or service activation is implied.

**Output:** sanitized `approval-status.json` with `profile,approved_service_ids,identity_configuration_ref,region_evidence_refs,retention_policy_ref,public_projection_policy_ref,external_mcp_allowed,scanner_approved,mail_approved,approval_date,unresolved_items`. Store references to controlled documents, not secret values or private contracts. Proposed destination `docs/usp-validation/deployment/` contains non-secret status only.

**Dependent outcome / fallback:** F2/protected activation, substantiated India-contained claims and optional external MCP. Local no-AI operation, mocked adapter tests and D0 integration continue. Mail approval absence does not block in-app receipts; scanner/identity absence blocks public uploads. Sarvam credentials missing means no live-provider qualification, not permission to silently use another provider.

### H3a. Runtime AI account evidence and secrets

**Already supplied by the user (23 September 2026):** every existing key intended for this project belongs to a different Sarvam account, with a reported ₹100 introductory grant per account. Prepare the independent-account template in H20; do not ask the user to repeat this clarification or assume one shared wallet for the supplied set. This is not verification of current remaining credit or authorization to open more accounts.

The accountable owner supplies only the still-missing approved organisation/workspace/rate-limit group identifiers, evidence of the actual remaining balance and permitted allocation per account, credential secret references, and data-retention/training/residency decisions. Keys from one organisation share funds; do not list Rs100 independently for each. An independently funded fallback requires explicit permission for this project/data and legitimate credit entitlement; no automated signup or rate-limit evasion. Store secrets through the environment/secret mechanism, not public evidence. Agents implement H20, prepare the configuration template, fingerprint/group credentials without logging values, test the fake provider and produce one precise remaining live prerequisite. Absent credentials or balance evidence blocks live qualification only, not no-AI/manual operation or local tests.

## H4. Observe the completed workflow, without becoming its tester/developer

**Why:** automated interaction checks cannot establish whether intended users understand selected scope and review status.

**Steps:** after agents deliver V0, ask a reviewer/nontechnical participant to select the intended building/unit, inspect evidence and produce a scoped packet without coaching. Note wrong-property selection, unclear status or a dead end. Later, after CITIZEN/F2 exists, observe a contributor submission/status task; do not make V0 wait for public deployment. Agents reproduce and fix findings and update regression tests.

**Output:** agent-provided `usability-observations.csv`: `scenario_id,participant_role,task,completed,correct_property,status_understood,confusing_step,participant_words,observed_issue`. Permitted synthetic screenshots are optional; names/recordings/private deeds unnecessary. Proposed destination `docs/usp-validation/usability/`.

**Dependent outcome / fallback:** intended-user usability validation, separate from automated V0 correctness and visual comparisons. If nobody is available, agents finish keyboard/mobile/focus/selection/performance tests and mark user observation untested. Do not claim user approval or stop implementation because an interview is pending.

## 2. Assignment and completion rule

Assign H1/H2 only to someone who can actually reach a holder/reviewer; H3 belongs to the deployment/account owner; H4 to someone able to observe a demo. There is no requirement to invent equal workloads for teammates. Agents own all acquisition that is already possible, engineering choices and verification preparation.

Each human dependency records `needed_for`, exact missing input, owner, requested/not_available/received status and the supported fallback. A missing authentic document or permission remains missing; an agent completes the unaffected feature and reports the specific unqualified outcome. Technical blockers are resolved by FND/UI/feature owners with a concrete patch/reproducer, not delegated to nontechnical teammates. This file does not assert that any real sample, approval, study or deployment account has been obtained.
