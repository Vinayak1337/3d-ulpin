TASK   PV1 — an officer's own large file            GATE GF1
WORKS  An officer can upload a large file with origin not stated and approve its streamed layout without a publisher citation.
SEE IT node docs/evidence/gf1/pv1/run-runtime.mjs /tmp/pv1-review-new.json
INPUTS DA6 NYC GeoJSON, 43,263,076 bytes; same immutable file tested with not-stated and retained cited provenance.
GAPS   Mapping, packages, automatic starts and browser behavior deliberately not qualified here; runtime used v1, v2 helper tested only.
DESIGN ingestion.ts adds strict not-stated provenance beside unchanged cited shapes; large-original.ts stores the distinct evidence state at both publication sites.
       streamed-profile.ts adds optional basis without a default and enforces empty citations for officer statements; old plan bytes/hashes stay unchanged.
       assertStreamedIssuerEvidence handles origin refusal or officer statement; protected author/approve, workers and Studio are unchanged.
COMMITS b153d3da docs(usp): PV1 step 0, where a large file needs a publisher's citation
        d5071ef4 feat(ingestion): a large upload may say its origin is not stated
        857a47df feat(ingestion): a streamed layout may be the officer's own statement, with no citation
CHECKS pnpm typecheck:backend [0]; pnpm studio:typecheck [0]; GN1 ingestion command [0, 257→266]; provenance/admission focused tests [0, 7]; basis tests [0, 6].
       OpenAPI generate/--check [0]; pnpm studio:api-types [0]; contract refresh against base [0]; Python API check [0]; probe.ts --after [0].
       HTTP run-runtime.mjs [0]; git diff --check [0]. Exact commands in checks.json.
NEXT   Lead integrates with LP3b's protected additions, then walks automatic mapping/package preparation and the Studio's file intake.

Each origin: six uploaded parts; 48,686 source features; 48,683 accepted / three quarantined; 487 raw chunks; sealed profile with 16 paths; officer-stated layout approved with zero citations. Zero mapping jobs/packages/records/provider calls. Original hash unchanged, owned nonce gone. result.json contains the three true booleans. Final evidence commit appears in the final chat report and git log rather than self-pinning here.
