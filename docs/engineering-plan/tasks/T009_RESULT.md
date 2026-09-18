# T009 — persisted read-only normalization bridge accepted

Accepted for the bounded local single-operator read profile. The previous v1 routes,
source bytes and all existing writers are unchanged. This is a read bridge, not a
database migration or completion of every bulk-input profile.

Actual production HTTP and direct read checks passed against three existing areas:

| Dataset/world | Physical features | Registry records | Original sources | Selected representations |
|---|---:|---:|---:|---:|
| Lake View / synthetic | 22 | 75 | 10 | 119 |
| Google Uttam Nagar / observed | 50 | 0 | 2 | 100 |
| Google Uttam Nagar / fictional registry | 51 | 39 | 6 | 141 |

Each read used one repeatable-read read-only transaction. Repeat reads and HTTP
responses agreed on the exact digest; stale expected digests returned 409. Hashes,
family ordinals, identities, source locators and owner-frame metadata survived.
Before/after fingerprints of six protected current/history/source tables matched.
No migration, seed, private original upload or write to those records was issued.

Verification: 285 core Node tests passed, including 35 bridge/HTTP cases, and the
production Next build passed. Schema drift and cross-runtime conformance are checked
with the existing contract tooling. Source metadata absence and unknown geometry
remain explicit. Only published-current rows are read by this endpoint; its DTO
also preserves revision zero when explicitly provided by a compatible source.

Self-review added registry XYZ rejection without dropping Z, original height
locators, owner-frame metadata, malformed Host handling and repeated-parameter
rejection. Full application visual approval and bulk/import/publish writes remain
separate. Native GPU and physical touch performance are not established by this
data-read qualification.

The user changed the next priority to shared 3D rendering and UI, with ML later.
T057 records that bounded visual milestone without falsely accepting T010–T056.
