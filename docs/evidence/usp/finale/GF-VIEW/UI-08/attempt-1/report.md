# UI-08 priority — saved-work entry and visible provenance cleanup

- Base `a56f6b0f9841ffb47c02248bfc7b48c8b8d24d0a` (`feat/ulpin-finale-full-product`); code `f3eaeccab9b4e6c8f28942728b2cda92f6191ad4`; worktree `/Users/vinayak/.codex/worktrees/ulpin-sol-ui08/3D Ulpin`, branch `agent/UI-08-priority`.
- Agent: Codex / requested GPT-6 Sol high. Applied model and effort were not independently observable.

## Visible change

`/studio/work` now has a desktop light Batches layout with record-backed work rows, their next action and actual update time, search/filter/pagination, an empty state and links to saved maps/registers. The Lake View sample promotion and import-demo link are gone. Saved dataset, area, source-intake, map and register routes no longer hard-code “fictional demonstration” or infer *Test fixture* from synthetic world status. The area scope strip displays the recorded `dataKind` as Observed, Synthetic, Mixed or Unknown. Protected stored names are displayed as recorded, without rewriting them.

The reachable `/studio/showcase` route now opens only a saved dataset by ID. A legacy bundled-dataset URL resolves to an exact saved hash if one exists, otherwise goes to the saved dataset directory. A bare showcase URL goes to the directory and its old `import=1` entry goes to Add files. The import dialog no longer offers authored Lake View ZIP download or other bundled samples. The `/studio/source-study` legacy URL goes to saved datasets; its static scenario screen remains in source history but is not a finale navigation destination. Saved dataset originals and contracts are unchanged.

## Checks and limits

- `pnpm install --frozen-lockfile --offline --silent`: exit 0.
- `pnpm typecheck`: exit 0 on code pin.
- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs a56f6b0f9841ffb47c02248bfc7b48c8b8d24d0a`: exit 0, 101 added web lines, no candidates. The script was run from this worktree with a temporary copy of the repository skill script and removed afterward.
- `git diff --check`: exit 0.
- Read-only browser check on persistent preview `http://127.0.0.1:3187` at its prior pin `9c6c578b73bb71ca06342840943ff199ac4e84c2`: the reported native preparation URL rendered its normal “No drawable plan” state and Create workspace action, with no observed console error. No mutation was attempted. Luna's earlier 404 remains intermittent and its failing request is unidentified.

**UI design check.** Blocking: no new invented values, sample promotion, forbidden provenance copy, or theme control in the changed UI. Design system: the Batches screen uses `--ui-*` tokens, the shared Phosphor Icon wrapper, one primary Add files action, record-backed rows and keyboard focus outlines; no new design-system drift found. Checked, no issue: desktop light layout, empty/error/loading paths, existing URLs and original storage untouched. This is a source review and mechanical scan; the changed Batches screen has not yet been rendered on the persistent preview.

**Remaining qualifications.** Saved historical names containing “Fictional” or “Lake View” remain protected record values; DATA needs a recorded, reversible display label where the issuing/source metadata supports one. The saved spatial-dataset compatibility adapter still hard-codes `classification: synthetic`, so this UI omits a classification badge there until a source-backed classification contract exists. Current Batches service returns `dataKind` for its work items but hard-codes the saved-dataset variant; no such badge is shown on those rows. Fresh S1/S4/S5/S12 screenshots and manual validation on this code pin remain pending a coordinated refresh of preview 3187 after integration. No preview files, services, ports, protected data or linked environment were changed.
