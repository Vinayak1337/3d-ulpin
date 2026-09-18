# T005 — reusable source catalog accepted

Accepted for the additive source/evidence contract scope, 18 September 2026.
Implementation: `39a507db979bb8a2a939df1418854f534ce1e3e0`, pushed to
`feat/unified-spatial-foundation`. Review is explicitly self-review plus independent
expected fixtures and cross-runtime conformance, not a claimed second reviewer.

Original asset identity, metadata-only integrity declarations, source-family
ordinals, exact compound locators and multiple direct/inherited associations are
preserved. Zero documents remains valid. The public index exposes an allowlisted
source identity/revision only, not private names, locators or blob handles.
The legacy DTO projection is the first pure consumer; old storage writers remain
authoritative. This task adds neither a native parser nor an upload UI.

A newly written sequence test reproduced a real defect: unlinking an inherited
child then its parent failed with `STALE_REFERENCE`. Unlink now preserves previous
link versions in bounded `linkHistory`. An inactive/history association can resolve
its exact archived parent, but active inheritance still requires the current
parent. Missing historical records, duplicate/future history and using an archived
parent as current evidence are rejected. Other associations and original assets
remain unchanged; the command emits no storage-deletion action.

Current local verification on the PC: **97 core Node tests**, **29 existing spatial
tests**, **20 existing UI tests**, schema/corpus generation drift check, TypeScript
checks and the full Next.js production build passed. The build retains the existing
minification-disabled warning; it was not hidden or changed as unrelated work.

GitHub contract run **35369211264**, job **105678917366**, passed the actual schema
authority, **35 identity and 36 source cases in Python 3.12**, Node suites, generation
drift and TypeScript step at this exact commit. The engineering-plan/source-inventory
run **35369211293** also passed. The broader isolated integration run **35369211234**
was still running at the first status check; do not interpret that as completed
evidence. This pure contract change does not alter any DB, API or storage writer.

No private-PC database migration or original-file mutation occurred. Next: T006
explicit coordinate frames, local transform profiles and vertical-reference checks.
