# 3D ULPIN — evidence-linked 3D property workbench

**Current execution and runtime AI:** [Astra Max lead with explicit Sol/Astra workers](docs/usp-agent-handoffs/02-lead-agent-execution.md); [planned Sarvam gateway, shared credits and permanent key retirement](docs/usp-agent-handoffs/20-model-gateway-and-budget-pools.md). These dated additions are implementation instructions, not a claim that provider accounts or live inference are configured.

**Start implementation with [the adopted handoffs](docs/usp-agent-handoffs/00-README.md).**
The direction is a visually strong, persisted Studio: select a building, inspect its
supplied floors and units, open the matching evidence, resolve uncertainty, and
produce a genuinely property-scoped compilation. Adaptive bulk ingestion extends
that working journey rather than delaying it.

## Current direction versus existing software

The handoffs were imported unchanged from `docs/usp-agent-handoffs@e167b1f` for
local discovery on this cleanup branch. They define planned implementation and
acceptance, not completed new features. The application baseline inspected by
those plans is `f623cff`. Check current code and actual test receipts before
claiming a capability works. This cleanup does not import new datasets, run
migrations, enable public services, or implement F0/V0/I1.

| Need | Read |
| --- | --- |
| Build order, agent ownership and D0–D7 acquisition/test runbooks | [00 — Start here](docs/usp-agent-handoffs/00-README.md) |
| Shared identities, snapshots, jobs, access and transactions | [01 — Shared contracts](docs/usp-agent-handoffs/01-shared-contracts-and-ownership.md) |
| Feature implementation | Assigned file 10–19, including its data/tests in J and assignment in K |
| Active 3D UI, quick/full register and visual acceptance | [99 — UI and integration](docs/usp-agent-handoffs/99-ui-ux-and-integration.md) |
| Current application operation | [Studio guide](docs/STUDIO_DEMO_GUIDE.md), [startup](docs/OFFICER_STARTUP.md), [platform](docs/PLATFORM.md) |
| Cleanup, retained dependencies and historical recovery | [Cleanup record](docs/cleanup-review/README.md) |

Studio remains the officer interface with **Batches / Map / Register**. Improve
the actual route and shared map, not a disconnected showcase. Preserve legacy URL
resolution, canonical identities, evidence and existing processing capabilities.
The application remains local/single-operator until the separate F2 and deployment
gates pass. A technical record or system identifier is not official ULPIN issuance,
legal title, an enforcement decision or excavation clearance.

## Data: preserve the existing packs; acquire new ones explicitly

| Pack | Role and availability boundary |
| --- | --- |
| D0 | New bounded authored workflow fixture derived from existing reference material; not a real survey and not created by this cleanup |
| D1 | Small real 3DBAG roof-model sample; preserve original shapes, IDs and missing interiors; acquisition/rendering require evidence |
| D2 | Optional Helsinki textured context, geographically separate |
| D3 | Existing Delhi/Uttam Nagar Google/OSM inputs; estimates/scenarios remain distinct from observed outlines and recorded boundaries |
| D4 | DDA document rows for extraction/scoped reporting; no automatic geometry or ownership |
| D5 | Matched permitted Indian building plan, section and evidence; availability must be confirmed |
| D6 | Separate modality-specific ML evaluation data; not a prerequisite to the first useful UI |
| D7 | Approved same-area cadastral/road/utility and rights evidence; missing access gates only the corresponding real-world claim |

Exact sources, caps, fallbacks and expected tests are in handoff 00 and each
feature's J section. **A source catalogue is not an acquired dataset.** Do not
replace original data with attractive invented heights, units or road widths.
Do not create a second mutable property database for a new format.

Existing inputs remain available: [fixture guide](fixtures/README.md),
[upload packages](data-source/README.md), [repository snapshot](repo-data/README.md),
[Uttam Nagar provenance](docs/GOOGLE_UTTAM_NAGAR.md) and
[additive transfer instructions](docs/UTTAM_NAGAR_SETUP.md).
The canonical source tree, ZIP entry points and manifest-bound scene assets are
retained. Duplicate unpacked convenience copies are not separate datasets.

## Run the existing local application

Use an already configured environment and the [startup guide](docs/OFFICER_STARTUP.md).
With locked dependencies installed, the existing developer commands are:

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm dev
```

These commands act on the configured services; choose an isolated environment for
tests. The launcher `pnpm demo` and `Start Demo.command` remain available for their
documented setups. Do not build over another agent's running worktree.

Open **http://127.0.0.1:3000/studio/work**. Use **Add files → Review details →
Check & record**, or open saved datasets. Map quick inspection and the full register
must preserve the same selected property and evidence context.

`REPO_DATA=true` selects the separate repository snapshot services; false preserves
the linked environment. Follow [repo-data/README.md](repo-data/README.md) rather
than changing credentials or resetting volumes. Do not run `repo:init`, reseeding,
snapshot export or restore over populated data. `pnpm data:uttam:install` is a
separate additive operation, not an instruction to refresh the base snapshot.

## Verify according to the work performed

```sh
pnpm typecheck
pnpm test:studio
pnpm test:register-scope
pnpm test:uttam
```

Registry/API/export/browser tests require their documented isolated services and
fixtures; see handoff 00 and the assigned feature. Pure tests, application integration,
real-source accuracy, visual quality and deployment qualification are distinct.
Do not report a historical screenshot or a successful inventory as a new runtime pass.

The retained [architecture](docs/ARCHITECTURE.md),
[API contract](docs/IMPLEMENTATION_CONTRACT.md), [registry](docs/REGISTRY.md),
[local spatial extraction](docs/local-spatial-extraction.md), and
[hosting assessment](docs/HOSTING.md) describe baseline mechanisms. New Sarvam,
public contribution and MCP work follows handoffs 13/18/19 and is not assumed live.

## Historical material

Superseded orchestration packs, old walkthroughs and duplicated public galleries
are referenced through the [pinned historical index](docs/cleanup-review/README.md#historical-recovery).
The remaining engineering-plan data/tools and design donors are retained where
CI, generators or visual references still use them. They do not override current
handoff sequencing. Cleanup never rewrites Git history or deletes local database volumes.
