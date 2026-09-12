# Acceptance scenarios — PLANNED, NOT EXECUTED

Use these as a shared baseline. Add exact fixture/revision IDs, commands, environment, expected method, actual result and evidence when implementing. A/B run independent checks; Vinayak also authors/tests the core geometry, permission, transaction and sync mechanisms.

| ID | Primary responsibility | Scenario | Expected behavior |
|---|---|---|---|
| T01 | A; Vinayak reviews | Core source pack has provenance, purpose and explicit synthetic/real status | All four boundary components can be traced to a source or an explicit missing-evidence issue. |
| T02 | B | Upload valid file and read it again | Same registered original/source revision is returned under authorized scope. |
| T03 | B; V owns primitive | Repeat the same finalization operation | One logical source registration/revision; repeated response is consistent. |
| T04 | B; V owns primitive | Reuse operation ID with incompatible payload | Defined conflict, not silent reuse or a second hidden operation. |
| T05 | B | Finalize partial/mismatched/unsupported upload | Not registered as a complete usable original; actionable error. |
| T06 | A/B | Receive file missing metadata needed for one purpose | Receipt and needs-metadata/blocked-for-purpose are distinct; no guessed datum. |
| T07 | B; V owns access | Guess cross-project case/source/read-link/export ID | No unauthorized metadata/bytes are exposed under the chosen error policy. |
| T08 | A | Supported units make boundary-only contact | Zero positive interior overlap for the declared same-frame prism profile. |
| T09 | A; V owns geometry | U03 erroneous 2.8 m lower limit overlaps U01 ending at 3.0 m | Shared height 0.2 m; volume uses independently calculated footprint intersection; highlight only the shared region. |
| T10 | A | Correct U03 lower limit to 3.0 m | Positive-volume overlap removed; required evidence/readiness still checked separately. |
| T11 | A | Invalid outline / unsupported shape / incompatible frame | Distinct supported errors, no silently flattened shape or misleading volume. |
| T12 | A | Building containment / common space / incomplete partition | Relationship-aware findings; no indiscriminate clash or universal no-gap rule. |
| T13 | B/A | Phone returns RQ-LEVEL-01 evidence | Same attributable response/source ID on phone and web; source suitability/acceptance remains separate. |
| T14 | B; V owns review | Submit and decide first registration | No accepted revision before decision; separate reviewer publishes stable prototype identity; lookup persists. |
| T15 | B; V owns review | Wrong-role or self-review attempt | Denied according to configured policy, including direct API attempts. |
| T16 | B; V core tests too | Stale submission, changed source/policy or concurrent relevant neighbor | Old approval checks cannot be borrowed; transaction rejects/retries/invalidates as designed. |
| T17 | B; V owns identity | Retry same accepted decision/publication | Same result/identity, no duplicate accepted record. |
| T18 | B device; A data; V core | Capture offline then force-stop/restart | Permitted local draft/attachments survive according to implemented policy; not labelled received/accepted. |
| T19 | B device; A data | Interrupt upload and retry/reconnect repeatedly | One attributable server response, original context preserved. |
| T20 | B device; V core | Reconnect after stale server data / access revocation | Explicit conflict/access-expired behavior; no silent overwrite or accepted write. |
| T21 | A/B; V owns dependency | Upload E-LEVEL-02 r2; preview explicit rebind | Upload alone does not rebind; U03 movement and U04 evidence-only impact explained. |
| T22 | A/B | Compare a later update against current accepted record | Current accepted geometry remains intact until new protected decision; initial-registration drafts are not mislabelled accepted. |
| T23 | A; V owns engine | Richer input with unsuitable acquisition/reference or unsupported entity | Useful technical limitation, not inferred unseen floors or fabricated geometry. |
| T24 | A/B; V owns model | AI unavailable / stale result / held-out evaluation | Manual route works; old results tied to old inputs; raw and corrected results remain separate. |
| T25 | A/B; V owns query | Corridor below basement crosses P-A/P-B; defined column query | Correct known intersections/parcel candidates and vertical ordering; no invented basement collision or clearance claim. |
| T26 | A/B; V owns exchange | Supported export/re-import with restricted evidence | Required supported IDs, revisions, relationships/references survive; no extra evidence permissions. |
| T27 | B; V owns recovery | Restore clean test environment | Supported case/lookup retained; no claim about untested backup or environment. |
| T28 | A/B/V | Run a second unfamiliar case | No C-001/U03-specific hardcoded production behavior; limitations visible. |

Do not mark any row passed until the relevant real system/test has run. Contract mocks, real backend tests and actual-device tests are separate evidence. Source documents do not establish exact XY coordinates, runtime, datasets, permissions or performance numbers; freeze or measure those instead of inventing them.
