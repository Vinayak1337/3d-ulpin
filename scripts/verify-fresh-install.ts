/** Isolated local T10 rehearsal. Never targets the operator's Compose project. */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suffix = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const project = `ulpin-fresh-${suffix}`;
assert(/^ulpin-fresh-[0-9]{14}-[a-f0-9]{8}$/.test(project));
const temporary = await mkdtemp(path.join(os.tmpdir(), `${project}-`));
await chmod(temporary, 0o700);
const logPath = path.join(temporary, "services.log");
const log = openSync(logPath, "a", 0o600);
const composeFile = path.join(temporary, "compose.yaml");
const buildSignal = path.join(temporary, "production-build.ready");
const reportDir = path.join(root, "test-results", project);
await mkdir(reportDir, { recursive: true });
const report: Record<string, unknown> = {
  project, startedAt: new Date().toISOString(), status: "running",
  ports: { postgres: 25432, minio: 29000, console: 29001, redis: 26379, geo: 28000, web: 3001 },
  checks: [], limitations: ["Saved NYC snapshot acquisition; no new provider download asserted.", "Reuses the installed dependency tree and local geo image; this is a fresh data installation, not a clean OS/dependency installation."],
};
const checks = report.checks as string[];
const pass = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const env: NodeJS.ProcessEnv = { ...process.env, ...parse(await readFile(path.join(root, ".env"))) };
for (const key of ["POSTGRES_PASSWORD", "S3_ACCESS_KEY", "S3_SECRET_KEY", "GEO_SERVICE_TOKEN"])
  assert(env[key], `Missing ${key}; use the existing local platform setup first.`);
env.POSTGRES_DB = "ulpin_fresh";
env.POSTGRES_USER ||= "ulpin";
env.DATABASE_URL = `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD!)}@127.0.0.1:25432/ulpin_fresh`;
env.S3_ENDPOINT = "http://127.0.0.1:29000";
env.S3_BUCKET = project;
env.REDIS_URL = "redis://127.0.0.1:26379/0";
env.GEO_URL = "http://127.0.0.1:28000";
env.ULPIN_FIXTURE_ROOT = path.join(root, "fixtures");
env.ULPIN_TEST_BASE_URL = "http://127.0.0.1:3001";
env.NEXT_TELEMETRY_DISABLED = "1";
if (env.ULPIN_DOCKER_CONTEXT) env.DOCKER_CONTEXT = env.ULPIN_DOCKER_CONTEXT;
else if (spawnSync("docker", ["context", "inspect", "colima-ulpin"], { stdio: "ignore" }).status === 0)
  env.DOCKER_CONTEXT = "colima-ulpin";
const dockerCompose = spawnSync("docker", ["compose", "version"], { env, stdio: "ignore" }).status === 0;
const composeCommand = dockerCompose ? "docker" : "docker-compose";
const composePrefix = dockerCompose ? ["compose"] : [];
const composeArgs = [...composePrefix, "--project-directory", root, "--env-file", path.join(root, ".env"), "-f", composeFile, "--project-name", project, "--profile", "app"];
let allocated = false;
let web: ChildProcess | undefined;
let dispatcher: ChildProcess | undefined;
let interrupted = false;
process.on("SIGINT", () => { interrupted = true; });
process.on("SIGTERM", () => { interrupted = true; });

async function command(commandName: string, args: string[], capture = false): Promise<string> {
  if (interrupted) throw new Error("Verification interrupted.");
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { cwd: root, env, stdio: ["ignore", capture ? "pipe" : log, log] });
    let output = "";
    child.stdout?.on("data", chunk => { output += chunk.toString(); });
    child.once("error", () => reject(new Error(`${commandName} could not start; private log: ${logPath}`)));
    child.once("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error(`${commandName} exited ${code}; private log: ${logPath}`)));
  });
}
const compose = (args: string[], capture = false) => command(composeCommand, [...composeArgs, ...args], capture);

async function assertPortAvailable(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Fresh-install port ${port} is already in use; no resources changed.`)));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
}

async function until(label: string, action: () => Promise<boolean>, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  let nextNotice = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Verification interrupted.");
    if (await action().catch(() => false)) return;
    if (Date.now() >= nextNotice) { console.log(`Waiting: ${label}`); nextNotice += 30_000; }
    await delay(500);
  }
  throw new Error(`Timed out: ${label}; private log: ${logPath}`);
}

async function stopChild(child?: ChildProcess) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([exited, delay(10_000)]);
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
    await Promise.race([exited, delay(2000)]);
  }
}

async function startWeb() {
  await access(path.join(root, "apps/web/.next/BUILD_ID"));
  report.productionBuildId = (await readFile(path.join(root, "apps/web/.next/BUILD_ID"), "utf8")).trim();
  web = spawn(process.execPath, [path.join(root, "apps/web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3001"], {
    cwd: path.join(root, "apps/web"), env, detached: true, stdio: ["ignore", log, log],
  });
  dispatcher = spawn(process.execPath, ["--import", "tsx", "scripts/dispatcher.ts"], { cwd: root, env, detached: true, stdio: ["ignore", log, log] });
  await until("isolated production web, dispatcher and all services ready", async () => {
    const response = await fetch(`${env.ULPIN_TEST_BASE_URL}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok && (await response.json()).ok;
  });
}

async function api(route: string, body?: unknown, expected = 200) {
  const response = await fetch(`${env.ULPIN_TEST_BASE_URL}/api/v1${route}`, {
    method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
  });
  assert.equal(response.status, expected, `${route} returned HTTP ${response.status}`);
  return response.json();
}

async function sourceHash(sourceId: string) {
  const response = await fetch(`${env.ULPIN_TEST_BASE_URL}/api/v1/sources/${sourceId}/file`);
  assert.equal(response.status, 200);
  return createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
}

async function verifyUi(areaId: string, featureId: string, phase: string) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true, args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(env.ULPIN_TEST_BASE_URL!, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Map area", { exact: true }).selectOption(areaId, { timeout: 30_000 });
    await page.getByLabel("Global identifier search").fill("353927");
    const dossierRequest = page.waitForResponse(response => response.url().endsWith(`/buildings/${featureId}/dossier`) && response.status() === 200, { timeout: 30_000 });
    await page.getByRole("button", { name: "Find →", exact: true }).click();
    const dossier = await (await dossierRequest).json();
    assert.equal(dossier.canonicalBuildingId, featureId);
    await page.screenshot({ path: path.join(reportDir, `${phase}.png`), fullPage: true });
    assert.deepEqual(errors, [], "Fresh production UI raised a runtime error.");
    pass(`${phase}: production UI opened the saved area and source-ID search loaded the same property's dossier.`);
  } finally { await browser.close(); }
}

try {
  for (const port of Object.values(report.ports as Record<string, number>)) await assertPortAvailable(port);
  const priorContainers = await command("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], true);
  const priorVolumes = await command("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], true);
  assert.equal(priorContainers + priorVolumes, "", "Fresh project unexpectedly already exists.");
  let composeText = await readFile(path.join(root, "compose.yaml"), "utf8");
  assert(composeText.startsWith("name: ulpin\n"));
  composeText = composeText.replace("name: ulpin\n", `name: ${project}\n`);
  for (const [oldPort, newPort] of [[15432, 25432], [19000, 29000], [19001, 29001], [16379, 26379], [18000, 28000]]) {
    const search = `127.0.0.1:${oldPort}:`;
    assert.equal(composeText.split(search).length, 2, `Expected exactly one port binding ${oldPort}.`);
    composeText = composeText.replace(search, `127.0.0.1:${newPort}:`);
  }
  for (const volume of ["postgres-data", "minio-data", "redis-data"]) {
    assert(composeText.includes(`\n  ${volume}:\n`));
    composeText = composeText.replace(`\n  ${volume}:\n`, `\n  ${volume}:\n    name: ${project}-${volume}\n`);
  }
  await writeFile(composeFile, composeText, { mode: 0o600 });
  allocated = true;
  console.log(`Allocated isolated project ${project}; private log: ${logPath}`);
  await compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "150", "postgres", "minio", "minio-init", "redis", "geo", "worker"]);
  const empty = await compose(["exec", "-T", "postgres", "psql", "-U", env.POSTGRES_USER!, "-d", env.POSTGRES_DB!, "-Atc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='cases'"], true);
  assert.equal(empty, "0", "Application tables existed before fresh migration.");
  await command("pnpm", ["exec", "tsx", "scripts/migrate.ts"]);
  await compose(["run", "--rm", "storage-check"]);
  pass("A new database, private bucket, Redis, geo and worker started in the isolated project; migrations ran from an empty application schema.");
  if (process.argv.includes("--wait-for-build")) {
    console.log(`BUILD_GATE ${buildSignal}`);
    await until("lead's production-build-ready signal", () => access(buildSignal).then(() => true), 30 * 60_000);
  }
  await startWeb();
  pass("Second production web and dispatcher passed database/storage/processor/Redis/worker health on the isolated endpoints.");
  const catalog = (await api("/source-catalog")).find((entry: any) => entry.id === "nyc-building-footprints");
  assert(catalog?.snapshot?.sha256);
  const acquisition = await api("/acquisitions", { sourceId: catalog.id, mode: "saved", requestKey: randomUUID() }, 201);
  assert.equal(acquisition.status, "complete");
  assert.equal(acquisition.sha256, catalog.snapshot.sha256);
  let pkg = await api("/import-packages", { acquisitionId: acquisition.id, name: `Fresh saved block ${suffix}` }, 201);
  assert.equal(pkg.features.length, 62);
  assert(pkg.features.every((feature: any) => feature.worldStatus === "observed" && feature.kind === "building"));
  assert.equal((await api(`/areas/${pkg.areaId}/context`)).features.length, 0);
  const originalHashes = Object.fromEntries(await Promise.all(pkg.sourceRevisionIds.map(async (id: string) => [id, await sourceHash(id)])));
  assert(Object.values(originalHashes).every(hash => hash === catalog.snapshot.sha256));
  pkg = await api(`/import-packages/${pkg.id}/review`, { expectedRevision: pkg.revision });
  assert(pkg.review?.inputFingerprint);
  pkg = await api(`/import-packages/${pkg.id}/commit`, { expectedRevision: pkg.revision, acknowledgement: "Fresh local installation verification: source exterior observations only, unresolved vertical references retained; no rights or survey conclusion." });
  assert.equal(pkg.state, "COMMITTED");
  const context = await api(`/areas/${pkg.areaId}/context`);
  assert.equal(context.features.length, 62);
  const identities = context.features.map((feature: any) => ({ id: feature.id, identifier: feature.identifier, sourceKey: feature.sourceKey })).sort((a: any, b: any) => a.sourceKey.localeCompare(b.sourceKey));
  const focus = context.features.find((feature: any) => feature.sourceKey === "353927");
  assert(focus);
  const dossier = await api(`/buildings/${focus.id}/dossier`);
  assert.equal(dossier.records.length, 0, "Real exterior source must not invent detailed floors or spaces.");
  const check = await api("/area-checks", { areaId: context.area.id, expectedRevision: context.area.revision }, 201);
  assert.equal(check.status, "completed");
  assert(check.findings.every((finding: any) => finding.volumeM3 === undefined));
  report.savedSnapshot = { acquisitionId: acquisition.id, areaId: pkg.areaId, packageId: pkg.id, sourceSha256: acquisition.sha256, featureCount: identities.length, originalHashes, identitiesSha256: createHash("sha256").update(JSON.stringify(identities)).digest("hex") };
  pass("Saved acquisition normalized and reviewed/committed 62 real exterior observations; original SHA-256 and source/building identities retained without invented detailed spaces or vertical collision volume.");
  await verifyUi(pkg.areaId, focus.id, "before-restart");
  await command("pnpm", ["exec", "tsx", "scripts/verify-officer.ts"]);
  pass("The existing officer API regression passed on the isolated stack, including native CSV preparation, dispatcher/Celery builds and detailed publication under the same reserved property identities.");
  await stopChild(web); web = undefined;
  await stopChild(dispatcher); dispatcher = undefined;
  await compose(["down", "--remove-orphans"]);
  await compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "150", "postgres", "minio", "minio-init", "redis", "geo", "worker"]);
  await command("pnpm", ["exec", "tsx", "scripts/migrate.ts"]);
  await startWeb();
  const reopened = await api(`/areas/${pkg.areaId}/context`);
  assert.deepEqual(reopened.features.map((feature: any) => ({ id: feature.id, identifier: feature.identifier, sourceKey: feature.sourceKey })).sort((a: any, b: any) => a.sourceKey.localeCompare(b.sourceKey)), identities);
  assert.deepEqual(await api(`/import-packages/${pkg.id}`), pkg);
  assert.equal(reopened.latestCheck.id, check.id);
  assert.equal(reopened.latestCheck.stale, false);
  for (const [id, hash] of Object.entries(originalHashes)) assert.equal(await sourceHash(id), hash);
  assert.equal((await api(`/acquisitions/${acquisition.id}`)).sha256, acquisition.sha256);
  await verifyUi(pkg.areaId, focus.id, "after-restart");
  pass("Full isolated service/web/dispatcher restart and repeat migration preserved all 62 identities, committed package, current check and exact original hashes.");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error instanceof Error ? error.message : "Unknown failure";
  console.error(`FAIL ${report.failure}`);
  process.exitCode = 1;
} finally {
  await stopChild(web);
  await stopChild(dispatcher);
  if (allocated) {
    // A new explicit project and explicit new volume names were checked before allocation.
    // No global prune, operator Compose file, or unscoped volume deletion is used.
    interrupted = false;
    try {
      await compose(["down", "--volumes", "--remove-orphans"]);
      assert.equal(await command("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], true), "");
      assert.equal(await command("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], true), "");
      report.cleanup = "Only the newly allocated project containers, network and named volumes were removed.";
      console.log(`CLEANED ${project}`);
    } catch {
      report.cleanup = `Cleanup needs attention for isolated project ${project}; private log: ${logPath}`;
      report.status = "failed";
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(reportDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  closeSync(log);
  console.log(`REPORT ${path.join(reportDir, "report.json")}`);
}
