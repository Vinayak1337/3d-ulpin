# R9 rollback: the demo back to `9d6acc6b`

Use only if, after roll-out step 7, the API at `8d6e19fa` cannot be started at all. Run once, from
`E:/Projects/ulpin-wt/demo`, recording each command, exit code and last lines. Nothing is removed, reset or
created: no `--create`, no `down`, no `-v`, no image build, pull, tag or removal.

1. Stop whatever native process of the demo is still recorded alive:
   `node --input-type=module -e "import('./scripts/platform/processes.mjs').then(m=>m.stopProcesses())"`
2. `git -C E:/Projects/ulpin-wt/demo checkout --detach 9d6acc6bdd8bc779b2f150ea4ddfd99c6d2a6af1`
3. `pnpm install --frozen-lockfile` (the lockfile differs between the two commits).
4. `node scripts/platform/demo-document-runtime.mjs build`
5. Processors back to the old pin, from the old checkout (its pin file names `ulpin-geo:git-22003ea3d878`, which
   stays on the engine and is never removed or retagged): `node scripts/platform/processor-image.mjs roll`.
   It recreates `geo` and `worker` only; volumes are kept.
6. `pnpm platform:start --profile demo`
7. `pnpm platform:doctor --profile demo`

The schema steps stay. They are additive (`IF NOT EXISTS` tables and columns, a widened check, ledger marks), the
API at `9d6acc6b` does not read the new tables or columns, and its structural admission check asks only for what
its own manifest names, which is a subset. No schema step is undone and no SQL is written for a rollback.

The gateway is not touched by a rollback: `enable`/`disable` are not run, so the demo keeps `enabled: true` with
policy hash `efb90b3a...` and the eleven key names.

`E:/BhuAayam-data/ops/docker-guard/no-demo-start` stays in place during a rollback (the old checkout writes no
stopped-on-purpose marker) and is removed only after the doctor of step 7 passes.
