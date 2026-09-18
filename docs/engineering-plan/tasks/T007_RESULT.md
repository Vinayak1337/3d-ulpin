# T007 — representations and quantities accepted

Accepted for the bounded analytical profiles on 18 September 2026. Implementation
`402649fc57a3cd7f279815815c62707873974093`, pushed to the existing feature branch.
Review: explicit self-review, independent numeric fixtures, cross-runtime parity
and regression; no claim of an independent human reviewer or UI completion.

The additive catalog preserves representation IDs (including legacy revision zero),
roles, entity/frame/source-part references and original asset associations. Profiles
cover planar point/line/polygon/multipart, constant-elevation prism, opaque native
asset references and explicit unavailable geometry. Unknown height is not zero;
positive-up metre intervals require the exact frame benchmark/datum. Geographic,
projected and unplaced shapes remain preservable, but this first analytic executor
qualifies only engineering frames. It does not claim arbitrary-solid/native parsing.

Known answers: 80 square metres and 480 cubic metres; courtyard subtraction 76;
concave outline 32; multipart sum 86; 3-4-5 plus three-metre line length eight;
millimetre/international-foot normalization; translation and ring-order invariance.
Reported gross/net/parcel quantities remain separately sourced and never replace a
computed footprint. Unsupported roles, invalid topology, stale or vague source
references, unclosed or Z/M rings, wrong vertical ties and excessive work are rejected.
Both position count and aggregate topology comparisons are bounded.

Review reproduced two additional defects before fixing them: overflowing volume
was incorrectly marked ready, and equal values could be marked conflicting. Readiness
and measurement now share the exact quantity executor. Numeric disagreement requires
distinct comparable values; it cannot mix net/gross definitions or use stale/self
references. Display metadata and optional evidence names do not change calculations.

Actual local checks: **193 core Node tests**, including **56 geometry tests**;
**53 geometry cases** in Python 3.13.7 alongside 35 identity, 36 source and 36 frame
cases; generated-schema drift, typecheck and full production build passed. Existing
29 spatial and 20 UI regression tests passed. No original/source/DB mutation occurred.
The existing minification-disabled build warning remains documented, not suppressed.

Hosted contract conformance **35373390820** and plan/source inventory **35373390964**
passed at this exact implementation commit. Hosted isolated integration
**35373390881** was still running when this record was prepared and is not counted
as completed here. The preceding coordinate checkpoint's isolated integration
**35370968658** has since passed. Next: T008 observations, composition and snapshots.
