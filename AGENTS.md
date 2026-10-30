# 3D ULPIN: agent entry point

3D ULPIN (BhuAayam, Smart India Hackathon problem SIH26011) turns survey, imagery, plan and document files into cited,
reviewed building, level, unit and space records with 3D identities: **Identify, Prove, Govern**.

**Read these before starting:**

1. [docs/PLAN.md](docs/PLAN.md): the only plan. Every task moves one of its numbered steps.
2. [docs/TASKS.md](docs/TASKS.md): the tasks for each step (the lead dispatches from it; a worker reads only its own).
3. [docs/STATUS.md](docs/STATUS.md): where things stand, on one page.
4. [docs/WORKING-RULES.md](docs/WORKING-RULES.md): how work is planned, done, reviewed and reported.

Nothing under `docs/archive/` is an instruction. It is the record of earlier plans, ledgers and handoffs. Where any
live document names an archived file as governing, owning or current, AGENTS.md, PLAN.md and WORKING-RULES.md win; the
archived link is background only.

## Roles

- **Owner:** decides and signs the plan, and is the only one who changes it.
- **Lead (Claude, Opus 5.5):** cuts tasks from the plan's steps, reads the code a task targets before writing it,
  reviews every diff, integrates into `staging`, keeps STATUS.md current and reports to the owner daily. The lead does
  not do build work itself.
- **Workers:** started and run by [WORKING-RULES.md](docs/WORKING-RULES.md). One task per worker, in its own worktree
  `E:/Projects/ulpin-wt/<task>` on branch `task/<id>-<slug>`. Workers touch only the paths their task names and never
  push, except a cloud worker, which pushes only its own task branch.

## Stack

- **Backend:** modular NestJS in `apps/api`, domain services in `packages/server`, contracts in `packages/contracts`,
  published schema `docs/api/openapi.json`. TypeScript, PostgreSQL/PostGIS with visible SQL and `pg` (no Prisma),
  private object storage, Redis/Celery, and Python processing in `services/`. Extend the one registry, job authority,
  model gateway and conversion contract; don't add competing services.
- **Frontend:** `apps/studio`, `packages/scene`, `packages/ui`, `packages/api-client`. React, Vite and TypeScript with
  Three.js and `3d-tiles-renderer` (no Next.js, no Cesium). The old Next.js app `apps/web` was removed on 24 October
  (owner); it stays in Git history only. Desktop-first, light-only; keep keyboard, contrast and zoom.
  `design-mockup/` and [the design system](docs/design-system/README.md) are protected references; never copy their
  sample values.
- **Design reference for intake:** [docs/design/INGESTION-ARCHITECTURE.md](docs/design/INGESTION-ARCHITECTURE.md).
  Read only the rows a task names.

## Data rules

- **Originals are immutable.** Keep issuer, original URL and bytes, acquisition date, SHA-256, licence or permission,
  geography and CRS. Every derivative points back to its original and a locator. Large and restricted inputs live under
  `E:/BhuAayam-data/`, outside Git. Check [real-sources.md](docs/api/real-sources.md) and
  [datasets.json](docs/api/datasets.json) before acquiring anything, and update them when acquisition changes.
- Official operational data comes from data.gov.in or the issuing authority. Public research data (RAMP, CubiCasa and
  similar) is allowed for development and evaluation, labelled `test_only` with its origin. A mirror or vendor
  prediction is not official. Indian operational claims need Indian sources; foreign tests stay in their own geography.
- **Download only from safe sources** (owner, 31 October; datasets can carry trojans): HTTPS from the issuing
  authority, data.gov.in or the publisher's named research host, never a mirror, file-sharing site or a link found
  inside another file. Download into a new empty folder outside Git, record URL and SHA-256 (matching any published
  checksum), scan with Microsoft Defender before opening, never run anything from it, and refuse executables, scripts,
  macro-enabled Office files and pickle-based files. Any finding or doubt: stop and tell the owner.
- **Never invent** records, identifiers, geometry, heights, controls, documents, images, ownership, rights or expected
  facts. Keep `unknown | absent | null | withheld | conflicting | estimated | candidate | source_supported | reviewed`
  distinct; unknown never becomes 0.
- Official parcel ULPINs differ from application building, level, unit and space IDs. Buildings can span parcels;
  units can span floors; a floor is not a unit. Geometry and scene display don't establish ownership or issuance.
  Estimates and illustrative massing carry their own provenance and never affect measurement, rights, packets or
  learning truth.
- Keep source coordinates and CRS unchanged; never guess a zone or datum from coordinate ranges (a doubtful CRS stays
  `crs_unverified` until an officer states it). Heights carry their vertical reference and convert only through a
  named, recorded operation. A floor label (G, UGF, Stilt, B1) never becomes a level number without a reviewed level
  schedule; regional units (gaj, bigha, marla) need a sourced conversion, otherwise `needs_input`.
- Map coordinates with a height (GeoJSON Z) are read: the outline uses x and y, and each feature keeps its heights as
  the file states them, reference and unit not stated, never used for measurement, drawing height or rights. M values,
  mixed 2D and 3D, and ArcGIS hasZ stay refused (owner, 16 October).
- A model never allocates an identifier, changes source coordinates, sets a legal right or declares an illegality.
- **Every model or agent output is a candidate.** Nothing reaches the registry without officer review. Screens show
  values read from records, never hard-coded samples.
- Never reset populated volumes, implicitly reseed, export a replacement snapshot, or read, overwrite or commit `.env`
  or credentials. Don't delete mixed bundles, unknown records, originals, uploads or review history; retire anything
  only by a reviewed list of exact paths.

## Models, teachers and Sarvam (owner decisions, 10 October)

- **Sarvam** (`sarvam-105b`, through the model gateway) is the runtime teacher inside the product. The gateway works
  through the owner's list of keys, one in use at a time. It moves to the next key only when the provider says a key's
  credit is used up or the key is rejected, never on a rate limit or an unknown outcome. When every key is used up or
  the network fails, calls stop, and the product uses saved answers or asks the officer.
- **Money caps, across all keys together:** Rs 15 per million input tokens, Rs 5 cached input, Rs 60 output; at most
  Rs 100 in total and Rs 25 a day; 150 calls per person per day. Adding, removing or reordering keys is the owner's
  step. Key values never appear in Git, evidence, logs, task files or chat; scripts print key names and counts only.
- **Development teacher and learner work** go to whichever provider has limit, and the model follows the provider:
  Claude → Opus 5.5, pi codex-pool → `gpt-6.1-sol`. Our mapping and extraction learners may train on verified teacher
  outputs (they compete with no provider). Teacher outputs are `pseudo_label`, never evaluation truth. No teacher sees
  held-out families (the test files kept aside for scoring). Officer corrections outrank teachers.
- **What may leave this PC:** private or restricted documents never go to an external provider. Public RERA sheets
  whose licence is not confirmed may go to Sarvam through the gateway, with the licence recorded as unconfirmed and
  a firm's or person's contact lines never sent. Judges' files may go as the 11 October masked column profile (column
  names, types and shape; no cell values, no contact lines); sample values wait on [PLAN.md](docs/PLAN.md) "Needs you" 3.

## Failure recovery

When the same failure recurs, or a finished experiment misses its target, don't repeat the command. Find the actual
failure (logs, the last good checkpoint; separate runtime faults from data, objective and integration defects). Then
run **one** bounded comparison with a stated hypothesis, baseline, success criterion and stop condition. Keep
source-family splits and frozen holdouts closed to tuning. If progress needs missing data, access or an owner action,
report that and keep the checkpoint.

## Git

- `staging` is the integration branch. The lead pushes it at milestones with the owner's `gh` login. Never push to
  `main`, never force-push, never deploy or open public services without the owner's go-ahead.
- Commits never contain secrets, `.env` files, large originals or model weights.
- **Commits carry no attribution (owner's rule, 11 October).** Every commit has the owner's git identity as author and
  committer. No `Co-Authored-By` or "generated with" line, and no commit message, author, committer, branch name, code
  comment or evidence line names an AI model, tool, provider or worker as the one who did the work. This overrides
  any tool's default. A model output's provenance field (`method: model:<id>@<version>`) is required data, not
  attribution. Details: [WORKING-RULES.md §10](docs/WORKING-RULES.md#10-commits-carry-no-attribution).
