# R10 rollback: the demo back to `8d6e19fa`

Use only if a step of the roll to `4ffd801a` fails twice for the same reason, or the API at `4ffd801a` cannot be
started at all. Run once, from `E:/Projects/ulpin-wt/demo`, recording each command, exit code and last lines.
Nothing is removed, reset or created: no `--create`, no `down`, no `-v`, no image build, pull, tag or removal.

1. Stop whatever native process of the demo is still recorded alive:
   `node --input-type=module -e "import('./scripts/platform/processes.mjs').then(m=>m.stopProcesses())"`
2. `git -C E:/Projects/ulpin-wt/demo checkout --detach 8d6e19fa91e1d08fa61d02946500b2f5227dd393`
3. `pnpm install --frozen-lockfile` (the lockfile is the same at both commits; run it anyway).
4. `node scripts/platform/demo-document-runtime.mjs build`
5. No processor step: `services/geo` is the same tree (`eab382a5`) at both commits and the pin names
   `ulpin-geo:git-a40b60238728` at both, so the processors stay as they are.
6. `pnpm platform:start --profile demo`
7. `pnpm platform:doctor --profile demo`

The schema step stays. It is additive (`ALTER TABLE usp_model_calls ADD COLUMN IF NOT EXISTS diagnostics jsonb`,
SV2's statement 12 of `model-gateway.schema`); the API at `8d6e19fa` does not read that column, and its structural
admission check asks only for what its own manifest names, which is a subset. No schema step is undone and no SQL
is written for a rollback.

The gateway is not touched by a rollback: `enable`/`disable` are not run, so the demo keeps `enabled: true` with
policy hash `efb90b3a...` and the eleven key names.

`E:/BhuAayam-data/ops/docker-guard/no-demo-start` stays in place during a rollback and is removed only after the
doctor of step 7 passes.
