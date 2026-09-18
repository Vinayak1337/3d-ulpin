# T008 — source composition and snapshot candidates accepted

Accepted on 18 September 2026 for the bounded, additive composition contract.
Implementation `7f4b1010433d2aebbd1e3b79805c4912bfd0b2bf` is pushed to the feature
branch. Verification is self-review plus independent numeric/digest oracles and
cross-runtime conformance, not a claimed independent human review.

Explicit observations and resolutions preserve alternatives and exact source,
representation, frame, world and revision links. The first consumer combines a
10x8 footprint, a separately sourced six-metre schedule and an independent unit
plan. It returns the 480-cubic-metre exterior without losing the unselected
nine-metre alternative. Failed/missing/expired height leaves the footprint and
unit usable. Zero documents is valid. Net and gross reported values remain
different definitions; conflicts retain their known candidate records.

Scoped immutable manifests separate input and geometry dependency digests. Source
renaming changes input state but does not recompile identical geometry; changing
scope prevents cache aliasing. The versioned tagged binary64/UTF-8 encoding has
seven independently specified oracles, rejects unpaired surrogates and oversized
inputs, and is explicitly not advertised as RFC8785. The builder captures input
before asynchronous hashing, avoiding caller-mutation races.

Publication objects are metadata-only candidates. They cannot self-activate, bind
unknown/stale features or switch authorization scope. Source access checks include
derived-asset ancestry and reject classification downgrades. This core does not
authenticate users, fetch originals, upload tiles, run migrations or publish a DB
pointer. Those integration operations are later tasks.

Actual checks: **248 core Node tests**, **40 snapshot cases**, **7 independent
signature cases**, **9 publication cases**; all earlier 35 identity, 36 source,
36 frame and 53 geometry cases passed in local Python 3.13.7. The same corpus
passed hosted Python 3.12/Node conformance run **35375752027**. Plan/source inventory
**35375752051** passed. **29 existing spatial tests**, **20 UI tests**, generated
artifact drift, TypeScript and full production build passed locally. Existing
minification-disabled warning remains documented. Isolated integration
**35375752020** was still running at the first status check; it is not counted
as completed in this record.

Next: T009 real stored-data read adapter. The PC's Docker Desktop was restarted;
its existing `ulpin-repo` services became healthy. No reseed, schema reset, original
file deletion or application database write was issued during T008.
