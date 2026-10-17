# R8 rollback: the demo back to `99e0026e`

Use only if, after roll-out step 7, the API at `9d6acc6b` cannot be started at all. Run once, from
`E:/Projects/ulpin-wt/demo`, recording each command, exit code and last lines. Nothing is removed, reset or
created: no `--create`, no `down`, no schema step (none differs between the two commits).

1. Stop whatever native process of the demo is still recorded alive:
   `node --input-type=module -e "import('./scripts/platform/processes.mjs').then(m=>m.stopProcesses())"`
2. `git -C E:/Projects/ulpin-wt/demo checkout --detach 99e0026ecc90a1b95b2a735a2418ec6433d02fe1`
3. `pnpm install --frozen-lockfile` (the lockfile is the same at both commits; run anyway).
4. `node scripts/platform/demo-document-runtime.mjs build`
5. `pnpm platform:start --profile demo`
6. `pnpm platform:doctor --profile demo`

The processors are not moved back. They stay on the pinned image `ulpin-geo:git-22003ea3d878`, which REH3 showed
serves the routes of both commits. At `99e0026e` the pin file and its doctor check do not exist, so the doctor there
does not judge the image. The old image `ulpin-geo:demo-k3b` is kept on the engine, never removed or retagged. If
the processors ever had to go back to it, that would be a separate, owner-approved step: no command in this file
recreates a container.
