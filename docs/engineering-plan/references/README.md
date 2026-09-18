# Reference and fixture acceptance contract

`catalog.json` retains the reviewed images' original SHA-256 values and archive
locators. It is a portable projection, not a duplicate set of screenshots or a
verbatim old-chat export. The recovered renderer manifest's own checksum is
recorded. Thirty records are full screens/boards; two are supporting crops.

The three primary anchors are REF-15 (map), REF-16 (register) and REF-17
(workspace). They were inspected at full resolution. All supporting records were
reviewed in five contact sheets; small storyboard panels define state coverage,
not an independent pixel-perfect specification for each tiny panel. Later
implementation tasks must open the relevant full-size reference before styling.

`acceptance-contract.json` covers all original UI-01 through UI-16 gates, retains
RQ01–RQ16 without duplicating their task authority, and specifies F01–F09. Each
screen family has a reference or an explicit derived-state gap. Missing mobile,
error and permission-state mockups are not disguised as existing images.

## Visual interpretation

The map anchor's main quality is the scene: convincing silhouette and depth,
coherent roads and ground, material scale, architectural variety, green/context
composition, readable selected geometry and restrained overlays. Matching a
header while retaining generic repetitive blocks is not equivalent quality.
Register and workspace anchors emphasize a connected spatial model and visible
source/record relationships, not dense explanatory text everywhere.

At comparable viewports, match typography hierarchy, panel proportions, control
sizes, spacing, border/radius treatment and contrast through shared tokens. Keep
the actual map live and dominant. A supporting crop may inform art direction but
must never replace the canvas or a selected property's live model.

Record an exact reproducible camera pose, DPR, browser/driver, fixture, snapshot,
compiler and style revision when taking implementation baselines. Compare scene
crops separately from the surrounding UI, include the alternate camera cases,
and test continuous interaction rather than only screenshots. Sparse evidence
receives a deliberate limited style; unsupported details remain unavailable.

## Numerical and semantic interpretation

The two-block fixture's 80 m2/480 m3 values are independent synthetic expectations,
not real Uttam Nagar measurements. Do not infer rooms, rights or official IDs
from a footprint. Preserve reported quantities separately from calculated ones.
The reference's overlapping finding values must not be added as disjoint areas.
An illustrative distance beside a pipe cannot establish safe clearance or depth.

## Acceptance versus approval

T002 accepts this specification's coverage and consistency. It does **not** approve
the inherited renderer's current visuals. The user remains the reviewer at the
designated T027/T037/T042 implementation checkpoints. The earlier performance
numbers remain provisional targets until measured on the declared workload and
hardware; software-WebGL checks are not certification of a physical GPU/phone.
