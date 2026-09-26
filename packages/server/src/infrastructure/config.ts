import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyRepositoryEnvironment } from "../../../../scripts/repo-env.mjs";
import { projectRoot } from "../../../../scripts/repo-env.mjs";

const repositoryRoot = projectRoot(path.dirname(fileURLToPath(import.meta.url)));
loadDotenv({ path: path.join(repositoryRoot, ".env"), quiet: true });
// Server-only selection; never expose database or object-store credentials to clients.
applyRepositoryEnvironment(repositoryRoot);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; run the platform setup first.`);
  return value;
}

export const settings = {
  get repositoryRoot() {
    return repositoryRoot;
  },
  get dataMode() {
    return process.env.REPO_DATA === "true" ? "repository" : "linked";
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get s3Endpoint() {
    return required("S3_ENDPOINT");
  },
  get s3AccessKey() {
    return required("S3_ACCESS_KEY");
  },
  get s3SecretKey() {
    return required("S3_SECRET_KEY");
  },
  get s3Bucket() {
    return process.env.S3_BUCKET || "ulpin";
  },
  get s3Region() {
    return process.env.S3_REGION || "us-east-1";
  },
  get geoUrl() {
    return required("GEO_URL");
  },
  get geoToken() {
    return required("GEO_SERVICE_TOKEN");
  },
  get fixtureRoot() {
    return process.env.ULPIN_FIXTURE_ROOT || path.join(repositoryRoot, "fixtures");
  },
};
