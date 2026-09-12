import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  CaseDetail,
  CaseRecord,
  ProcessingJob,
  SourceRevision,
  UnitSpec,
} from "../packages/contracts/src/index";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.ULPIN_TEST_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const runId = new Date().toISOString();
const results: { name: string; passed: boolean; detail: string }[] = [];
const cases: CaseRecord[] = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T = any>(
  route: string,
  init: RequestInit = {},
  expected = 200,
): Promise<T> {
  const response = await fetch(`${base}/api/v1${route}`, {
    ...init,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    value = text.slice(0, 180);
  }
  assert.equal(
    response.status,
    expected,
    `${init.method || "GET"} ${route}: ${response.status} ${JSON.stringify(value).slice(0, 260)}`,
  );
  if (expected >= 400) {
    assert.equal(
      typeof value?.error?.code,
      "string",
      "Errors must have a typed error code.",
    );
    assert.equal(
      typeof value?.error?.requestId,
      "string",
      "Errors must have a request ID.",
    );
  }
  return value as T;
}
function post(
  route: string,
  value: unknown,
  expected = 200,
  headers: Record<string, string> = {},
) {
  return request(
    route,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    },
    expected,
  );
}
function patch(route: string, value: unknown, expected = 200) {
  return request<UnitSpec>(
    route,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
    expected,
  );
}
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.push({ name, passed: true, detail: "Passed" });
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error))
      .replace(/\n/g, " ")
      .slice(0, 550);
    results.push({ name, passed: false, detail });
    console.error(`FAIL ${name}: ${detail}`);
    return false;
  }
}
async function createCase(label: string) {
  const value = (await post(
    "/cases",
    {
      name: `Regression ${label} ${runId}`,
      description:
        "Live API regression fixture; safe to remove after inspecting API_TEST_EVIDENCE.md.",
    },
    201,
  )) as CaseRecord;
  cases.push(value);
  return value;
}
const detail = (id: string) => request<CaseDetail>(`/cases/${id}`);
async function fixture(name: string): Promise<Uint8Array> {
  const response = await fetch(`${base}/api/v1/demo-files/c001/${name}`);
  assert.equal(response.status, 200, `Fixture download ${name} failed.`);
  return new Uint8Array(await response.arrayBuffer());
}
async function upload(
  caseId: string,
  name: string,
  profile: string,
  bytes: Uint8Array | string,
  key?: string,
  familyId?: string,
  expected = 201,
) {
  const form = new FormData();
  form.set(
    "file",
    new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name),
  );
  form.set("profile", profile);
  if (familyId) form.set("familyId", familyId);
  return request<SourceRevision>(
    `/cases/${caseId}/sources`,
    {
      method: "POST",
      body: form,
      headers: key ? { "Idempotency-Key": key } : {},
    },
    expected,
  );
}
async function waitForSource(caseId: string, sourceId: string) {
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    const source = (await detail(caseId)).sources.find(
      (source) => source.id === sourceId,
    );
    if (source && !["received", "processing"].includes(source.status))
      return source;
    await delay(350);
  }
  throw new Error(
    `Source ${sourceId} did not finish inspection within 55 seconds.`,
  );
}
async function waitForJob(caseId: string, jobId: string) {
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    const state = await detail(caseId),
      job = state.jobs.find((job) => job.id === jobId);
    if (job && !["queued", "running"].includes(job.status))
      return { state, job };
    await delay(350);
  }
  throw new Error(`Job ${jobId} did not finish within 55 seconds.`);
}
async function build(caseId: string) {
  const state = await detail(caseId);
  const job = (await post(
    `/cases/${caseId}/build`,
    { expectedRevision: state.case.revision },
    202,
  )) as ProcessingJob;
  return waitForJob(caseId, job.id);
}
async function negativeSuite() {
  await check("Unknown API routes return typed 404", async () => {
    await request("/unknown-regression-route", {}, 404);
  });
  await check("Malformed request JSON returns typed 400", async () => {
    await request(
      "/cases",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"name":',
      },
      400,
    );
  });
  await check("External Origin is rejected before mutation", async () => {
    await post("/cases", { name: "Regression must not be created" }, 403, {
      Origin: "https://untrusted.example",
    });
  });
  await check("Opaque Origin is rejected with typed 403", async () => {
    await post("/cases", { name: "Regression must not be created" }, 403, {
      Origin: "null",
    });
  });
  await check("Malformed Origin is rejected with typed 403", async () => {
    await post("/cases", { name: "Regression must not be created" }, 403, {
      Origin: "invalid-origin",
    });
  });
  await check("Unknown case UUID returns typed 404", async () => {
    await request(`/cases/${randomUUID()}`, {}, 404);
  });
  const primary = await createCase("adversarial"),
    foreign = await createCase("foreign-source");
  const [spatialBytes, r1Bytes, r2Bytes, controlBytes] = await Promise.all(
    ["spatial.json", "levels-r1.csv", "levels-r2.csv", "controls.csv"].map(
      fixture,
    ),
  );
  let spatial: SourceRevision;
  if (
    !(await check(
      "Concurrent identical uploads reuse one source revision",
      async () => {
        const key = `regression-${randomUUID()}`;
        const uploads = await Promise.all([
          upload(
            primary.id,
            "spatial.json",
            "parcel-local-json-v1",
            spatialBytes,
            key,
          ),
          upload(
            primary.id,
            "spatial.json",
            "parcel-local-json-v1",
            spatialBytes,
            key,
          ),
        ]);
        assert.equal(uploads[0].id, uploads[1].id);
        assert.equal(uploads[0].revision, uploads[1].revision);
        const sources = (await detail(primary.id)).sources;
        assert.equal(
          sources.filter((source) => source.name === "spatial.json").length,
          1,
        );
        spatial = uploads[0];
        const changed = new TextDecoder().decode(spatialBytes) + "\n";
        const reply: any = await upload(
          primary.id,
          "spatial.json",
          "parcel-local-json-v1",
          changed,
          key,
          undefined,
          409,
        );
        assert.equal(reply.error.code, "IDEMPOTENCY_CONFLICT");
      },
    ))
  )
    return;
  const [levels, controls] = await Promise.all([
    upload(primary.id, "levels-r1.csv", "levels-csv-v1", r1Bytes),
    upload(primary.id, "controls.csv", "control-csv-v1", controlBytes),
  ]);
  if (
    !(await check(
      "Source upload and inspection do not automatically prepare units",
      async () => {
        const inspected = await Promise.all(
          [spatial!, levels, controls].map((source) =>
            waitForSource(primary.id, source.id),
          ),
        );
        assert(
          inspected.every((source) =>
            ["ready", "needs_input"].includes(source.status),
          ),
        );
        const state = await detail(primary.id);
        assert.equal(state.units.length, 0);
        assert.equal(state.model, null);
      },
    ))
  )
    return;
  let prepared: CaseDetail;
  if (
    !(await check(
      "Incomplete levels retain explicit unverified candidates",
      async () => {
        prepared = await post(`/cases/${primary.id}/prepare`, {
          spatialSourceId: spatial!.id,
          levelSourceId: levels.id,
          controlSourceId: controls.id,
        });
        for (const alias of ["U03", "U04"]) {
          const unit = prepared.units.find((unit) => unit.alias === alias)!;
          assert.equal(unit.lowerVerified, false);
          assert.equal(unit.bindings.lower, undefined);
          assert.equal(unit.upperVerified, true);
        }
        assert.equal(
          prepared.units.find((unit) => unit.alias === "U03")!.lower,
          2.8,
        );
      },
    ))
  )
    return;
  await check(
    "Malformed JSON and invalid numeric CSV fail real inspection",
    async () => {
      for (const [name, profile, bytes] of [
        ["bad.json", "parcel-local-json-v1", '{"profile":'],
        [
          "bad.csv",
          "levels-csv-v1",
          "alias,lower,upper,unit,benchmark,method\nU03,not-a-number,6,m,BM-DEMO-A,measured\n",
        ],
        [
          "duplicate.csv",
          "levels-csv-v1",
          "alias,lower,lower,upper,unit,benchmark,method\nU03,3,3,6,m,BM-DEMO-A,measured\n",
        ],
      ]) {
        const source = await upload(primary.id, name, profile, bytes);
        const inspected = await waitForSource(primary.id, source.id);
        assert.equal(inspected.status, "failed", name);
        const state = await detail(primary.id),
          job = state.jobs.find((job) => job.sourceId === source.id);
        assert.equal(job?.status, "failed");
        assert(job?.error, "Failed processing must explain the problem.");
      }
    },
  );
  await check("Mismatched level benchmark cannot be applied", async () => {
    const source = await upload(
      primary.id,
      "wrong-benchmark.csv",
      "levels-csv-v1",
      new TextDecoder().decode(r2Bytes).replaceAll("BM-DEMO-A", "BM-FOREIGN"),
    );
    assert.equal((await waitForSource(primary.id, source.id)).status, "ready");
    const before = await detail(primary.id);
    const reply = await post(
      `/cases/${primary.id}/apply-levels`,
      { sourceId: source.id, expectedRevision: before.case.revision },
      422,
    );
    assert.equal(reply.error.code, "INCOMPATIBLE_REFERENCE");
    const after = await detail(primary.id);
    assert.deepEqual(after.units, before.units);
    assert.equal(after.case.revision, before.case.revision);
  });
  await check(
    "Mismatched control benchmark cannot prepare a case",
    async () => {
      const source = await upload(
        primary.id,
        "wrong-control.csv",
        "control-csv-v1",
        new TextDecoder()
          .decode(controlBytes)
          .replaceAll("BM-DEMO-A", "BM-FOREIGN"),
      );
      assert.equal(
        (await waitForSource(primary.id, source.id)).status,
        "ready",
      );
      const before = await detail(primary.id);
      const reply = await post(
        `/cases/${primary.id}/prepare`,
        {
          spatialSourceId: spatial!.id,
          levelSourceId: levels.id,
          controlSourceId: source.id,
        },
        422,
      );
      assert.equal(reply.error.code, "INCOMPATIBLE_REFERENCE");
      assert.deepEqual((await detail(primary.id)).units, before.units);
    },
  );
  await check(
    "Foreign case source IDs are rejected in preparation and evidence application",
    async () => {
      await post(
        `/cases/${foreign.id}/prepare`,
        { spatialSourceId: spatial!.id },
        404,
      );
      const before = await detail(foreign.id);
      await post(
        `/cases/${foreign.id}/apply-levels`,
        { sourceId: levels.id, expectedRevision: before.case.revision },
        404,
      );
      assert.equal((await detail(foreign.id)).units.length, 0);
      await upload(
        foreign.id,
        "foreign-family.csv",
        "levels-csv-v1",
        r1Bytes,
        undefined,
        levels.familyId,
        422,
      );
    },
  );
  await check(
    "Source revision upload is immutable and does not auto-apply evidence",
    async () => {
      const before = await detail(primary.id);
      const source = await upload(
        primary.id,
        "levels-r2.csv",
        "levels-csv-v1",
        r2Bytes,
        undefined,
        levels.familyId,
      );
      assert.equal(source.revision, 2);
      assert.equal(source.familyId, levels.familyId);
      assert.notEqual(source.id, levels.id);
      assert.equal(
        (await waitForSource(primary.id, source.id)).status,
        "ready",
      );
      const after = await detail(primary.id);
      assert.deepEqual(after.units, before.units);
      assert.equal(after.case.revision, before.case.revision);
      const original = await fetch(`${base}/api/v1/sources/${levels.id}/file`);
      assert.equal(original.status, 200);
      assert.deepEqual(new Uint8Array(await original.arrayBuffer()), r1Bytes);
    },
  );
  await check(
    "Manual elevation edits clear only the changed evidence binding",
    async () => {
      const state = await detail(primary.id),
        unit = state.units.find((unit) => unit.alias === "U01")!;
      const saved = await patch(`/cases/${primary.id}/units/${unit.id}`, {
        expectedRevision: unit.revision,
        lower: -0.2,
      });
      assert.equal(saved.lowerVerified, false);
      assert.equal(saved.bindings.lower, undefined);
      assert.equal(saved.upperVerified, true);
      assert.deepEqual(saved.bindings.upper, unit.bindings.upper);
    },
  );
  await check(
    "Stale unit, build, and evidence expectedRevision values return 409",
    async () => {
      const before = await detail(primary.id),
        unit = before.units.find((unit) => unit.alias === "U01")!;
      await patch(
        `/cases/${primary.id}/units/${unit.id}`,
        { expectedRevision: unit.revision - 1, lower: -0.3 },
        409,
      );
      await post(
        `/cases/${primary.id}/build`,
        { expectedRevision: before.case.revision - 1 },
        409,
      );
      await post(
        `/cases/${primary.id}/apply-levels`,
        { sourceId: levels.id, expectedRevision: before.case.revision - 1 },
        409,
      );
      assert.deepEqual((await detail(primary.id)).units, before.units);
    },
  );
  await check(
    "Manual add stays unverified; invalid geometry and reversed levels reject",
    async () => {
      const manual = {
        alias: "REG-MANUAL",
        name: "Regression manual unit",
        kind: "unit",
        footprint: [
          [20, 20],
          [22, 20],
          [22, 22],
          [20, 22],
        ],
        lower: 0,
        upper: 3,
      };
      const unit = (await post(
        `/cases/${primary.id}/units`,
        manual,
        201,
      )) as UnitSpec;
      assert.equal(unit.lowerVerified, false);
      assert.equal(unit.upperVerified, false);
      assert.deepEqual(unit.bindings, {});
      await post(
        `/cases/${primary.id}/units`,
        {
          ...manual,
          alias: "REG-BOWTIE",
          footprint: [
            [20, 20],
            [22, 22],
            [22, 20],
            [20, 22],
          ],
        },
        422,
      );
      await post(
        `/cases/${primary.id}/units`,
        { ...manual, alias: "REG-REVERSED", lower: 4, upper: 3 },
        422,
      );
      await patch(
        `/cases/${foreign.id}/units/${unit.id}`,
        { expectedRevision: unit.revision, lower: 1 },
        404,
      );
    },
  );
}
function worker(action: "pause" | "unpause") {
  execFileSync(
    "bash",
    [
      "-c",
      'source "$1/scripts/platform-lib.sh"; ulpin_compose --profile app "$2" worker',
      "bash",
      root,
      action,
    ],
    { cwd: root, stdio: "pipe", timeout: 15000 },
  );
}
async function staleRace() {
  const record = await createCase("late-result");
  await check(
    "Late worker result cannot replace the current model after a controlled edit",
    async () => {
      let unit = (await post(
        `/cases/${record.id}/units`,
        {
          alias: "REG-RACE",
          name: "Regression race unit",
          kind: "unit",
          footprint: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
          lower: 0,
          upper: 3,
        },
        201,
      )) as UnitSpec;
      const baseline = await build(record.id);
      assert.equal(
        baseline.job.status,
        "succeeded",
        baseline.job.error || "Baseline failed.",
      );
      assert(baseline.state.model);
      const baselineId = baseline.state.model.id;
      unit = await patch(`/cases/${record.id}/units/${unit.id}`, {
        expectedRevision: unit.revision,
        upper: 4,
      });
      let pending: ProcessingJob;
      worker("pause");
      try {
        const queuedAt = await detail(record.id);
        pending = await post(
          `/cases/${record.id}/build`,
          { expectedRevision: queuedAt.case.revision },
          202,
        );
        await patch(`/cases/${record.id}/units/${unit.id}`, {
          expectedRevision: unit.revision,
          upper: 5,
        });
        assert.equal((await detail(record.id)).model?.id, baselineId);
      } finally {
        worker("unpause");
      }
      const late = await waitForJob(record.id, pending!.id);
      assert.equal(
        late.job.status,
        "stale",
        late.job.error || "Late job was not marked stale.",
      );
      assert.equal(
        late.state.model?.id,
        baselineId,
        "Stale output replaced the published current model.",
      );
      assert.equal(
        late.state.units[0].upper,
        5,
        "Late output overwrote the newer candidate edit.",
      );
      const fresh = await build(record.id);
      assert.equal(fresh.job.status, "succeeded");
      assert.equal(fresh.state.model?.revision, fresh.state.case.revision);
      assert.equal(fresh.state.model?.units[0].volume, 80);
    },
  );
}
async function closedRing() {
  const record = await createCase("closed-ring");
  await check(
    "Closed-ring save and edit preserve the canonical footprint through real queued builds",
    async () => {
      const ring = [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [0, 0],
      ];
      let unit = (await post(
        `/cases/${record.id}/units`,
        {
          alias: "REG-CLOSED",
          name: "Regression closed-ring unit",
          kind: "unit",
          footprint: ring,
          lower: 0,
          upper: 3,
        },
        201,
      )) as UnitSpec;
      async function verify(
        expectedFootprint: number[][],
        expectedVolume: number,
      ) {
        assert.deepEqual(
          unit.footprint,
          expectedFootprint,
          "Save response must use the canonical open ring.",
        );
        const candidate = (await detail(record.id)).units.find(
          (value) => value.id === unit.id,
        )!;
        assert.deepEqual(
          candidate,
          unit,
          "Persisted candidate differs from the save response.",
        );
        const built = await build(record.id);
        assert.equal(
          built.job.status,
          "succeeded",
          built.job.error || "Queued build failed.",
        );
        assert.equal(built.state.model?.revision, built.state.case.revision);
        const computed = built.state.model?.units.find(
          (value) => value.id === unit.id,
        );
        assert(computed, "Model omitted the closed-ring candidate.");
        const {
          area: _area,
          height: _height,
          volume,
          ...computedSpec
        } = computed;
        assert.deepEqual(
          computedSpec,
          candidate,
          "Geometry normalized or changed a saved candidate specification.",
        );
        assert.equal(volume, expectedVolume);
      }
      await verify(ring.slice(0, -1), 36);
      const editedRing = [
        [0, 0],
        [5, 0],
        [5, 3],
        [0, 3],
        [0, 0],
      ];
      unit = await patch(`/cases/${record.id}/units/${unit.id}`, {
        expectedRevision: unit.revision,
        footprint: editedRing,
      });
      await verify(editedRing.slice(0, -1), 45);
    },
  );
}
async function writeReport() {
  const closed = process.argv.includes("--closed-ring-only");
  const stale = !closed && process.argv.includes("--stale-race-only");
  const mode = closed
    ? "closed-ring save/build regression"
    : stale
      ? "controlled late-result race"
      : "non-disruptive adversarial suite";
  const filename = closed
    ? "API_CLOSED_RING_EVIDENCE.md"
    : stale
      ? "API_STALE_RESULT_EVIDENCE.md"
      : "API_TEST_EVIDENCE.md";
  const command = `pnpm exec tsx scripts/api-regression.ts${closed ? " --closed-ring-only" : stale ? " --stale-race-only" : ""}`;
  const passed = results.filter((result) => result.passed).length;
  const lines = [
    `# ${closed ? "Closed-ring save/build" : stale ? "Late-result race" : "API regression"} evidence`,
    "",
    `**${passed}/${results.length} checks passed.** Executed: ${runId}.`,
    "",
    `Target: ${base}. Mode: ${mode}.`,
    "",
    `Repeat: \`${command}\`.`,
    "",
    stale
      ? "Coordinate an idle window first. This check briefly pauses the shared Celery worker and restores it in a finally block."
      : "This check uses the running application and dispatcher without pausing services.",
    ...(!closed && !stale
      ? [
          "",
          "Focused checks are recorded separately and are not overwritten by this suite:",
          "",
          "- [Late-result race](API_STALE_RESULT_EVIDENCE.md): `--stale-race-only`, during a coordinated idle window.",
          "- [Closed-ring save/build](API_CLOSED_RING_EVIDENCE.md): `--closed-ring-only`.",
        ]
      : []),
    "\nCases created (all names start with Regression):",
    ...cases.map((value) => `- ${value.name}: \`${value.id}\``),
    "\n| Result | Scenario | Detail |",
    "| --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.passed ? "PASS" : "FAIL"} | ${result.name} | ${result.detail.replace(/\|/g, "/")} |`,
    ),
    "\nNo unrelated cases or stored uploads were deleted. The application currently has no case-delete API; these labelled regression cases remain available for inspection.",
    "",
  ];
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", filename), lines.join("\n"));
  return `docs/${filename}`;
}
try {
  const health = await request("/health");
  assert.equal(
    health.ok,
    true,
    "Start the full platform and resolve application compilation before running API regressions.",
  );
  if (process.argv.includes("--closed-ring-only")) await closedRing();
  else if (process.argv.includes("--stale-race-only")) await staleRace();
  else await negativeSuite();
} catch (error) {
  results.push({
    name: "Suite setup/completion",
    passed: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  console.error(error instanceof Error ? error.message : error);
} finally {
  const report = await writeReport();
  const failed = results.filter((result) => !result.passed).length;
  console.log(
    `${results.length - failed}/${results.length} checks passed. Evidence: ${report}`,
  );
  if (failed) process.exitCode = 1;
}
