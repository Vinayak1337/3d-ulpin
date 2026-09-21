# Required human inputs — not implementation assignments

These tasks obtain information or approvals unavailable from repository code. AI agents still own architecture, source research they can access, schemas, fixtures, APIs, frontend, migrations, integrations and automated tests. Teammates are not expected to resolve technical design gaps or write application code.

No task below blocks F0 contract work or synthetic feature development. Only the stated real-data/pilot/deployment gates depend on human input. Read [the execution matrix](00-README.md) and [shared correctness rules](01-shared-contracts-and-ownership.md).

## H1. Obtain a small permitted, representative evidence set

**Why needed:** agents cannot invent authentic local records, their sharing permission, survey accuracy or source-to-property ground truth. PACK, INGEST, FIND and RIGHTS need representative samples to qualify real behavior after synthetic implementation.

**Exact steps:** ask the relevant record holder for a small approved sample; prefer already redacted/example records. Include one multi-property document, one floor/unit plan with declared placement/vertical reference where available, and one tabular/GIS source with its schema metadata. Obtain only the material needed for those cases. Record unknown metadata as unknown rather than asking a teammate to guess a CRS, legal right or building match. The implementation agent prepares a de-identified fixture from the permitted sample; the human confirms that it retains the relevant layout/meaning.

**Required output:** `sample-manifest.csv` with `sample_id,source_family,format,permitted_use,permission_reference,restricted_storage_reference,contains_personal_data,known_property_match,known_units,known_frame,known_vertical_reference,unknowns,reviewer_date`. Source holders may answer “not supplied.” No secret access tokens in storage references.

**Where to save:** raw/private records stay in the team's approved restricted storage, never in this public GitHub repo. Save only sanitized metadata under proposed `docs/usp-validation/samples/sample-manifest.csv`; agents place approved synthetic/de-identified test fixtures under their assigned test directories. These paths are proposed, not files created by this documentation task.

**Dependencies / blocker / fallback:** real-data acceptance for PACK/INGEST/FIND/RIGHTS; not code development. Use clearly synthetic mixed-property pages, schemas, height/reference mismatches and known geometry truth until permitted material is available. Do not present a synthetic acceptance run as field accuracy.

## H2. Confirm review terminology and evidence requirements with an intended reviewer

**Why needed:** the team must not invent which evidence makes a particular officer workflow ready, which shared clauses apply to a unit, or what a reviewer means by acceptance. Accessible regulations/references can be researched by agents; real local workflow confirmation needs a responsible person.

**Exact steps:** an agent prepares 6–10 concrete synthetic cases covering missing height, ambiguous building match, shared stair evidence, parcel/road overlap, unit correction and a mixed-property export. Ask an intended officer/surveyor/record reviewer what action they would take, what fact is missing and which wording would avoid confusion. Ask whether their response is a workflow preference or backed by a named external rule; do not convert an interview opinion into a legal requirement.

**Required output:** `review-cases.csv` with `case_id,user_role,task,expected_next_action,required_fact,acceptable_evidence,shared_context_needed,prohibited_inference,terminology,reference_if_any,unresolved_question`. Record role and date; personal identity/contact is unnecessary unless separately required for a formal pilot approval.

**Where to save:** sanitized answers in proposed `docs/usp-validation/review/review-cases.csv`. Any restricted guidance remains in approved storage with a non-secret reference. READY's agent translates approved answers into a versioned technical policy and tests; the teammate does not implement policy code.

**Dependencies / blocker / fallback:** policy/pilot acceptance for READY, PACK, CITIZEN and RIGHTS. Development uses an explicitly labelled demonstration technical-review policy and configurable terminology. Missing confirmation blocks claims that the policy matches a real department, not the bounded prototype workflow.

## H3. Authorize identity, provider and infrastructure arrangements

**Why needed:** code cannot grant access to an institution's IdP, establish where a vendor processes backups/logs, authorize disclosure to remote MCP clients or approve real public uploads.

**Exact steps:** the deployment owner selects the intended deployment profile and accountable resource owner; obtains approved IdP issuer/client configuration; confirms infrastructure region and backup/log destinations; obtains the specific model service's processing/retention terms; approves scanner and optional mail transport. Decide separately whether any public property projection may be released and whether external MCP is permitted. Supply credentials through the deployment secret mechanism, not chat, Markdown, issues or source control.

**Required output:** `deployment-approval.json` with `profile,approved_service_ids,region_evidence_refs,identity_configuration_ref,retention_policy_ref,public_projection_policy_ref,external_mcp_allowed,scanner_approved,mail_approved,approval_date,unresolved_items`. Values reference controlled configuration/documents; they never contain passwords, API keys or full private contracts. Technical agents supply the exact configuration template after implementing the adapter.

**Where to save:** sanitized approval status in proposed `docs/usp-validation/deployment/approval-status.json`; credentials/contracts in the operator's approved secret/document store. DEPLOY records only non-secret qualification references.

**Dependencies / blocker / fallback:** blocks F2/protected public activation and substantiated India-contained deployment claims. Does not block local demo, pure authorization tests, synthetic provider mocks or no-AI/manual workflows. Lack of mail approval does not block in-app receipts; lack of safe upload scanning does block public file intake. No teammate is asked to provision or pay for services without separate authorization.

## H4. Observe two intended users completing the end-to-end workflow

**Why needed:** automated browser checks cannot establish whether an officer or citizen understands selected-property scope, evidence limitations and review status.

**Exact steps:** after the agent supplies a working isolated synthetic demo, ask an intended reviewer to resolve one missing-evidence case and generate a unit packet. Ask a nontechnical participant to find a synthetic unit, submit a correction and locate its status. Do not coach the first attempt. Note wrong-property selections, misunderstood statuses, dead ends and unclear labels. Agent engineers reproduce and fix issues; teammates do not debug code.

**Required output:** `usability-observations.csv` with `scenario_id,participant_role,task,completed,wrong_property_selected,status_understood,step_of_confusion,participant_words,observed_issue`. Screenshots are optional, de-identified and permitted; names, recordings and personal documents are unnecessary.

**Where to save:** proposed `docs/usp-validation/usability/usability-observations.csv`; only permitted synthetic screenshots beside it. UI owner converts findings into bounded fixes and regression tests.

**Dependencies / blocker / fallback:** intended-user usability acceptance for UI, CITIZEN, READY and PACK; not automated integration development. Until available, agents run keyboard/mobile/readability and exact-selection tests and label the user-observation gate untested.

## Handoff to teammates

Assign H1/H2 to a teammate with access to the relevant record holder or reviewer, H4 to a teammate able to arrange a short demonstration, and H3 to the actual deployment/account owner. Do not manufacture work just to split tasks equally. Ask only for the listed outputs, allow unknown/not available answers, and route engineering questions back to the responsible AI agent/FND owner.

The implementation agents should create blank sanitized templates when they need these inputs. This documentation set does not include real records, approvals, credentials or completed user studies, and none should be assumed to exist.
