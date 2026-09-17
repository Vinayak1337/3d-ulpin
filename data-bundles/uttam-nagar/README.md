# Uttam Nagar additive saved-data bundle

Use **[the transfer instructions](../../docs/UTTAM_NAGAR_SETUP.md)**. Normal command:

```text
pnpm data:uttam:install
```

The application must be stopped for update/build. Docker must be running and the
repository-mode database migrated; the web server need not be running to install.

`manifest.json` identifies six bounded areas, per-table hashes and 53 retained
source-object keys. `rows.json.gz` contains 4,440 saved rows and dependency metadata.
`objects/` is content-addressed and contains the exact retained originals.

This bundle is separate from `repo-data/`; do not replace the base snapshot or
restore this by dropping existing tables. The installer is additive, transactional
for database rows, checks all source hashes, preserves existing edits and refuses
identity collisions. Credentials, roles, execution queues and unrelated areas
are excluded. See the manifest and fixture documentation for source attribution
and the distinction between public reference geometry and fictional scenarios.
