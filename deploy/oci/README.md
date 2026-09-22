# OCI single-VM deployment

This deployment uses one Always Free Ampere A1 VM for Next.js, the dispatcher,
PostgreSQL/PostGIS, Redis, private MinIO storage, the geometry API, and Celery.
It requires an ARM64 Ubuntu host with Docker Compose, Node.js 24, pnpm 9.12.0,
and Caddy. The root `compose.yaml` stays suitable for the local workstation;
`deploy/oci/compose.yaml` builds PostGIS natively for ARM64.

The application, database, Redis, geometry API and object store bind only to
loopback. Caddy is the sole public service on ports 80 and 443. Its hostname
must resolve to the VM public IP. The proxy rejects foreign browser origins
before adapting headers for the existing local-only API guard. This is a
public synthetic demonstration, not officer authentication.
The deployment also installs a persistent VM firewall rule for ports 80/443;
the OCI subnet security list must allow those two ports separately.

On the VM, clone the repository to `/opt/ulpin/app`, then run:

```sh
bash deploy/oci/deploy.sh 80.225.204.171.sslip.io
```

The script creates `.env` only if absent, preserves Docker volumes, starts all
private services, applies schema migrations, builds the web app, and installs
systemd/Caddy configuration. It never initializes or overwrites the repository
data snapshot. Keep private model weights in `.runtime/ml-models` if ML
inference is needed. Import only designated synthetic packages through Studio.

For subsequent releases, pull `main` and rerun the command. The GitHub Actions
deployment workflow performs that step after main is pushed. The workflow uses
`OCI_HOST`, `OCI_SSH_USER`, `OCI_SSH_PRIVATE_KEY`, and
`OCI_SSH_KNOWN_HOSTS` repository secrets.
