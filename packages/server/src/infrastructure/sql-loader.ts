import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { settings } from "./config";

type SqlStep = { id: string; file: string; sha256: string };
type SqlManifest = { formatVersion: number; steps: SqlStep[] };

let stepsById: Map<string, SqlStep> | undefined;

function manifestSteps(): Map<string, SqlStep> {
  if (stepsById) return stepsById;
  const manifestPath = path.join(settings.repositoryRoot, "database", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SqlManifest;
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.steps)) {
    throw new Error("Unsupported database SQL manifest");
  }
  const entries = new Map<string, SqlStep>();
  for (const step of manifest.steps) {
    if (typeof step.id !== "string" || typeof step.file !== "string" ||
        typeof step.sha256 !== "string" || entries.has(step.id) ||
        !/^sql\/[a-z0-9/-]+\.sql$/.test(step.file) ||
        !/^[a-f0-9]{64}$/.test(step.sha256)) {
      throw new Error("Invalid database SQL manifest entry");
    }
    entries.set(step.id, step);
  }
  stepsById = entries;
  return entries;
}

/** Load only a named, repository-owned SQL file; never interpolate a path. */
export function sql(id: string): string {
  const step = manifestSteps().get(id);
  if (!step) throw new Error(`Unknown database SQL step: ${id}`);
  const file = path.join(settings.repositoryRoot, "database", step.file);
  const bytes = readFileSync(file);
  if (createHash("sha256").update(bytes).digest("hex") !== step.sha256) {
    throw new Error(`Database SQL hash mismatch: ${id}`);
  }
  return bytes.toString("utf8");
}
