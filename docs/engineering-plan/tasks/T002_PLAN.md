# T002 — reference, requirement and fixture acceptance contract

Status: detailed plan authored after T001's successful isolated baseline.
Scope: acceptance specifications and executable traceability checks; no UI or
geometry implementation in this task. Existing supplied mockups remain the target.

## Inputs and current evidence

Use the actual renderer pack's SHA-addressed `reference_manifest.json` and
`reference_review.csv`, the three recovered image archives, existing
`docs/v2-design` materials, and current task/edge-case/acceptance records.
There are 32 reference records including two supporting crops, not 32 independent
full-screen requirements. Some filenames disagree with their pixels. Classify by
inspected content without renaming the original files or treating a generated
scene image as runtime evidence. The current calibration captures are unapproved
implementation candidates, not replacement design anchors.

## Deliverables and boundaries

1. Preserve the source reference manifest with exact hashes and original locators.
   Inspect primary map/register/workspace anchors at full size and every remaining
   board/screen at a useful overview; zoom any ambiguous state before classifying.
2. Define required screen families, their primary/secondary reference IDs, and
   explicit derivative or missing-reference states. Every advertised screen has
   an anchor or a recorded gap; no fabricated approval or fictional numerical
   content becomes a requirement.
3. Specify F01–F09 fixture families, the two-block proving geometry, capability
   tiers and independent geometric oracles. Separate retained public geometry,
   synthetic detail and observed measurements. A held-out source is selected only
   when its task begins; do not claim the existing tuned fixtures are held out.
4. Define camera/viewport/interaction protocol and per-dimension visual criteria.
   Correctness is a prerequisite, not a score to average away. Retain the user's
   visual decision gates while allowing routine technical work to proceed.
5. Add a small validator/test of specification coverage, unique IDs, valid task
   mappings, hash shape, reference-count semantics and conflicting numeric labels.
   Test deliberately invalid copies without weakening the authoritative specs.

## Edge cases and review

Unknown-height/exterior-only scenes need deliberate neutral fallback; dense lanes
must not be widened; zero documents remain valid; unit geometry and quantity
definitions are independent of mockup labels. Tabs/modals, empty/error/loading,
keyboard focus, high zoom, narrow screens, dark/bright material contrast and
section/underground states are explicit cases. Readable reference text is not a
legal or survey authority. No reference file on this branch may be replaced by a
new generated image merely to make the current implementation easier to accept.

## Acceptance and rollback

All required state families map to inspected references or declared gaps; fixture
specs and visual profiles are coherent and traceable; positive and mutation tests
pass. This accepts the specification's completeness, not user approval of any
new render. Rollback is a code/docs-only revert, with no persistence effect.
