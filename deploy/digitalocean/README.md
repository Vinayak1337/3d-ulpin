# DigitalOcean demo deployment

Existing host: https://168-144-77-211.sslip.io . The user requested an open synthetic hackathon demo; no officer authentication is claimed.

T089 installs the exact GitHub main archive, replaces the active data store with fresh isolated Docker volumes, applies only schema migrations, and uploads both packages via the hosted Add files UI. Old release and volumes remain offline for rollback; local stores remain untouched. Never run a seed utility, `repo:init`, snapshot restore or a dataset POST script for this deployment.

Architecture: Caddy HTTPS → loopback Next.js:3000; private PostgreSQL/PostGIS, MinIO, Redis, geometry API and Celery containers; systemd web and dispatcher. Existing private model artifacts and environment are retained server-side. A server-only compose override points to fresh named volumes. Use that override for future compose operations. Services remain on loopback. The proxy rejects foreign Origin and cross-site requests before translating upstream Host/Origin for the application's existing local deployment guard. This is not authentication.

Do not commit private SSH keys, access files, actual .env files or model weights. Source-package and evidence bytes have explicit git attributes to survive platform line-ending normalization.

See T089_RESULT.md for deployed revision, verified imported IDs and remaining limitations. Upload sources are in `data-source/`; import the complete ZIPs rather than individual evidence files. See `docs/HACKATHON_BRIEFING.md` for presentation facts and judge questions.
