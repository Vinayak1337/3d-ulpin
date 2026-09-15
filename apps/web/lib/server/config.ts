import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { applyRepositoryEnvironment } from "../../../../scripts/repo-env.mjs";

loadDotenv({ path: path.resolve(process.cwd(), ".env"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
// Server-only selection; never expose database or object-store credentials to clients.
applyRepositoryEnvironment();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; run the platform setup first.`);
  return value;
}

export const settings = {
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
    // Next runs from apps/web; scope build tracing to the explicit fixture folder.
    return (
      process.env.ULPIN_FIXTURE_ROOT ||
      path.resolve(process.cwd(), "../../fixtures")
    );
  },
};
