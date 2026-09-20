# T083 — Persist both datasets, rather than link bundled previews

Explicit user authorization: save Lake View and Shiv Vihar properly. Save immutable source packages and every member via existing object storage, retain source revision rows in existing cases/sources, and persist the canonical candidate plus its source identity bindings and digest in PostgreSQL. Use a dedicated saved-dataset receipt with immutable revision 1 and content-hash idempotence; no synthetic geographic anchor, no approval or official issuance. Existing saved data must not be overwritten.

Replace bundled cards with database-backed dataset entries. Open by persisted UUID and verified stored original. Show saved/draft state and expose save for future supported package imports. Integrate saved dataset receipts with the batch list rather than generating broken generic source-case links. Named bundled links resolve an already saved receipt where available.

Validate malformed input before writes; bound request bytes; enforce local same-origin access; serialize duplicate imports; clean only unsaved attempt objects. Tests: concurrent duplicate save, immutable source readback/hashes and canonical IDs, invalid input no rows, service restart and browser list → map → floor/register. This is durable dataset storage, not the whole T080 extraction/review/atomic registry publication pipeline.
