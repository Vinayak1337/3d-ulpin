# OCI single-VM deployment

The current release serves the React/Vite Studio as static files through Caddy,
with NestJS on loopback port 3188, the hosted dataset transport on 3190, and a
separate dispatcher. PostgreSQL/PostGIS, Redis, private MinIO, the geometry API
and Celery retain their existing Docker volumes. The old Next.js service is
stopped only after the replacement services and datasets are ready.

Requirements: ARM64 Ubuntu, Docker Compose, Node.js 24, pnpm 9.12.0, Python 3.12
with `venv`, Caddy, and the repository at `/opt/ulpin/app`. The domain must point
to the VM; OCI ingress must allow ports 80 and 443. All application and storage
ports remain bound to loopback.

## Data and environment

Transfer the complete `apps/studio/datasets/` directory to
`/opt/ulpin/shared/datasets/` over SSH and verify file hashes. Keep that directory
private and outside Git. The eight NYC originals must be under
`nyc-10013/files/`; their hashes are pinned in
`scripts/demo-import/nyc-profile.json`. Lake View's six workflow inputs are
tracked in the repository and also retained in the transferred directory.

The server `.env` owns its database, object-storage and geometry credentials.
Preserve those values when synchronizing selected provider credentials; never
replace them with workstation credentials. `.env` and generated environment
files must have mode 600. `configure-env.mjs` writes only hosted runtime settings
under `/opt/ulpin/shared`. Paid model dispatch is disabled for this public demo.

This deployment explicitly enables `VITE_HOSTED_DEMO=1`, `VITE_LOCAL_DATA=on`
and `VITE_DEMO_IMPORT=1`. A normal production build still excludes the local
workflow layer. Fresh visitors receive the existing Lake View workflow, including
its floor/register data; existing browser work and explicit resets are preserved.
NYC is imported through the same multipart API and SSE/acknowledgement flow used
by Studio: 2,363 features from eight retained source files, including LiDAR,
elevation and imagery. Repeated deployment reuses the completed import.

NYC map geometry is official source data. Lake View and the existing generated
property workflow are presentation fixtures, not official ownership or issued
ULPIN records. Browser-local reviews, requests and edits are not a shared,
authenticated production registry. The separate hosted dataset files persist
on the VM across restarts. Preserve that distinction when presenting the site.

## Release

After reviewing and pushing `main`, run on the VM:

```sh
cd /opt/ulpin/app
git fetch origin main
git merge --ff-only origin/main
bash deploy/oci/deploy.sh bhuaayam.tech 80.225.204.171.sslip.io
```

The script takes a private database/configuration backup, preserves `.env` and
volumes, installs locked dependencies, builds API and Studio, applies migrations,
starts the new services and prepares both datasets before switching Caddy.
It validates the Caddy configuration and leaves the old site serving if an
earlier preparation step fails. Only one deployment can run at a time.

Verify `/api/v1/health`, `/api/demo/bootstrap`, and a fresh browser at
`https://bhuaayam.tech/studio/work`. Open both maps and confirm NYC imagery and
surface assets load. Check `ulpin-api`, `ulpin-demo`, `ulpin-dispatcher`, Caddy
and Docker health. `/api/demo/*` and the reserved `d30d` dataset identifiers route
to the hosted transport; other API routes go to NestJS. Streaming proxy buffering
is disabled. Foreign browser origins are rejected before loopback adaptation.

Backups live in `/opt/ulpin/shared/backups/<UTC timestamp>/`. Keep the previous
Git revision and Caddy configuration when rolling back. Do not reset Docker
volumes or restore an older database over new records as a routine rollback.
This runbook uses a direct SSH release; it does not depend on a GitHub Actions
workflow being present.
