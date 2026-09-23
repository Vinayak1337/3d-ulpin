# Hosting the workbench

> **Direction note — 23 September 2026:** This is a retained hosting assessment, not proof of a qualified deployment. Follow the separate environment gates in handoff 19. Current implementation and data/testing assignments are in [USP handoff 00](usp-agent-handoffs/00-README.md) and the assigned feature file.

The complete application currently runs as a local stack. **It cannot be deployed unchanged to Vercel alone**, including its free Hobby plan.

Vercel can host the Next.js web application. The application also requires PostgreSQL/PostGIS, private S3-compatible object storage, Redis, the Python geometry service, a Celery worker and the application dispatcher. The dispatcher continuously polls every 750 ms. The current addresses refer to services on the local computer and are not reachable from a Vercel deployment.

## What the free Vercel plan covers

Vercel Hobby is free for personal, non-commercial projects within its usage limits. It supports the frontend and request-driven functions. It does not supply this project's complete persistent data and worker stack merely by importing the GitHub repository.

Vercel now supports container images as functions, but those containers are stateless and request-driven. An always-running Celery worker and dispatcher need a different execution model or separate worker hosting. Hobby cron jobs run at most once per day, so they cannot replace the dispatcher's subsecond polling loop.

Official references, checked 12 September 2026:

- [Hobby plan and included usage](https://vercel.com/docs/plans/hobby)
- [Container and background-worker hosting models](https://vercel.com/kb/guide/docker-on-vercel-vs-render)
- [Function duration and resource limits](https://vercel.com/docs/functions/limitations)
- [Hobby cron frequency limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## Paths to a hosted application

For the existing full workflow, provision externally reachable database, private object storage, Redis and Python/worker services, then configure the frontend's environment variables in Vercel. Provider free tiers, quotas and worker availability must be checked separately; this is not a confirmed zero-cost deployment. The local single-operator authorization model also needs authentication and isolation before exposing shared uploads and editable records publicly.

A public browser-only demonstration could run on Vercel Hobby without these backend services, using sample models and browser-local data. That would be a separate mode with different persistence and processing behavior, and it has not been implemented or deployed.

The current verified option remains `pnpm demo` on the configured computer. See [PLATFORM.md](PLATFORM.md) for the full stack and [README.md](../README.md) for setup.

## Secrets

Real `.env` files and their variants are excluded from Git. `.env.example` contains placeholders and is included as setup documentation. Never publish local database passwords, object-storage keys, service tokens, generated runtime data or a populated Vercel environment file. Supply deployment secrets through the hosting provider's environment settings.
