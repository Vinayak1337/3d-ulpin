# Uttam Nagar transfer acceptance — 17 September 2026

The saved-data update path in [UTTAM_NAGAR_SETUP.md](UTTAM_NAGAR_SETUP.md) was
executed on the native Windows checkout with Docker Desktop's Linux containers.
This is a local verification record, not a claim of testing another physical PC.

## Separate-target-database test

`pnpm test:uttam:transfer` passed all seven checks:

1. Restored the original base snapshot into a newly created, isolated test
   database and created a separate object-storage bucket.
2. Added an unrelated test record and modified the test copy of Lake View to
   represent teammate data that must be preserved.
3. Installed all six Uttam Nagar areas. Every transferred row, PostGIS geometry,
   source-file byte and object metadata matched the bundle.
4. Verified every pre-existing database row and unrelated storage object remained
   unchanged.
5. Repeated the installation with no duplicate records or altered data.
6. Verified later edits to imported data were preserved on repeat installation.
7. Verified an untracked identity conflict was rejected without overwriting data,
   and an existing exact dataset could be adopted without duplication.

The invocation removed only its own newly created test database and bucket.
Its detailed machine-readable report is retained locally under
`.runtime/transfer-tests/` and is not required by another computer.

## Existing desktop data

The normal install command adopted the user's existing six saved areas with
**zero inserted rows and zero uploaded objects**. Exact verification matched
**4,440 rows across 32 tables and 53 original-file keys**. The base `repo-data`
snapshot was not replaced.

## Application and regression checks

- Dataset/attribution/evidence/scenario-policy tests: **14 passed**.
- Repository-mode tests: **2 passed**.
- UI/state/measurement tests: **20 passed**.
- Scene tests: **7 passed**.
- TypeScript checking and production build: **passed**.

The built production app returned all six populated area contexts, rendered the
Google-derived 3D scene, displayed the nine units/common spaces and recorded-party
column for Google Building A, and returned an actual property PDF. The Delhi
overview linked all three study pairs and fit a 390-pixel viewport without
horizontal overflow. The browser check recorded no uncaught page exceptions or
local HTTP error responses.

## Publication checks

All changed/new files were scanned for the locally configured service secrets and
common GitHub token formats. Runtime/environment directories and oversized files
were excluded. `.gitattributes` preserves dataset/fixture bytes across Windows
checkouts. The largest new file is the roughly 11.3 MB compressed scoped row
payload, not the multi-gigabyte regional source download.

The normal installer requires the repository-mode environment; it does not
silently redirect to an arbitrary linked database. Original source-replay scripts
remain advanced tools, not the teammate update instructions.
