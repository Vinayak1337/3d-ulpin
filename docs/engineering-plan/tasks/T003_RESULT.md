# T003 — schema authority and architecture boundary accepted

Date: 18 September 2026. Result: **Accepted**. Review: explicit self-review.

The source-authority experiment passed 23 identical expected outcomes in installed
Zod 4.6.2 and Python jsonschema 4.26.0. Python also rejected four non-finite wire
cases, including a finite-looking exponent that overflows to infinity. Generated
schema/corpus drift, tuple bounds, strict extra-key handling, explicit null,
safe integer limits, source units and Unicode code points were checked. Unsupported
Zod transforms are not silently exported as unconstrained JSON.

The experiment was rerun in GitHub-hosted Python **3.12**, not only local 3.13:
contract-conformance run **35357891721** passed at
`c7618c400612b49eb66f9bcdc148cc94a21c132c`. The plan/source-inventory run
**35357891584** also passed. Local TypeScript and 29 existing spatial tests passed.
The separate full-storage run is not required as a new preservation claim for
these test-only structural experiments; its actual later result stays separate.

ADRs 001–004 nominate one portable structural source, explicit semantic validation,
existing authoritative writers, native-frame/transform separation, and the current
shared viewport/Cesium candidate. The common model will evolve as `ulpin-spatial/2`
while the bounded v1 renderer and existing input routes remain compatibility
consumers. No new database, source-format completion or visual approval is claimed.

The initial length assumption was intentionally challenged: installed Zod 4.6.2
already counts code points. The experiment records that observed behaviour rather
than treating historic JS UTF-16 assumptions as a product defect. The generated
schema is still qualified only for its tested structural subset; cross-record and
geometry semantics remain separate, named tests.

Next: implement T004 identity/relation contracts and deterministic identity-change
validation without changing persisted data or replacing the current renderer.
