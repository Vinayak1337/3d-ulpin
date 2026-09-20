/** Actual local HTTP/Celery/model verification. No mock transport or direct DB writes.
 * Run once to extract; inspect with browser-workflow.mjs; run --record to review/build.
 * A retained checkpoint makes retries reuse this new, explicitly synthetic test property.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.STUDIO_BASE_URL || "http://127.0.0.1:3000";
const out = process.env.ML_VERIFY_DIR || "docs/evidence/t061/workflow";
const samples = process.env.ML_SAMPLE_DIR || "/tmp/ulpin-ml-spike";
const record = process.argv.includes("--record");
const sha = (v: Uint8Array | string) => createHash("sha256").update(v).digest("hex");
await mkdir(out, { recursive: true });
const statePath = join(out, "state.json");
const state: any = await readFile(statePath, "utf8").then(JSON.parse).catch(() => ({
  run: randomUUID(), createdAt: new Date().toISOString(), base, attachments: {}, checks: [],
  scope: "New synthetic verification property and authored metric controls/levels. Published CubiCasa/OAM source rasters retain their real attribution; they are not survey evidence for this fictional property.",
}));
assert.equal(state.base, base, "Use the same server as the retained checkpoint.");
if (state.lastFailure && !state.failures?.some((f: any) => f.at === state.lastFailure.at)) state.failures = [...(state.failures || []), state.lastFailure];
const save = () => writeFile(statePath, JSON.stringify(state, null, 2));
async function evidence(name: string, value: unknown) { await writeFile(join(out, name + ".json"), JSON.stringify(value, null, 2)); }
async function pass(name: string, detail: object = {}) {
  state.checks = state.checks.filter((c: any) => c.name !== name);
  state.checks.push({ name, passed: true, at: new Date().toISOString(), ...detail });
  console.log("PASS " + name); await save();
}
async function api(path: string, value?: any, expected = 200) {
  const response = await fetch(base + "/api/v1" + path, {
    method: value === undefined ? "GET" : "POST", signal: AbortSignal.timeout(120000),
    headers: value === undefined || value instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: value === undefined ? undefined : value instanceof FormData ? value : JSON.stringify(value),
  });
  const text = await response.text(); let result: any;
  try { result = JSON.parse(text); } catch { throw Error(`${path}: HTTP ${response.status}: ${text.slice(0, 400)}`); }
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result).slice(0, 1000)}`);
  return result;
}
const pkgGet = () => api(`/import-packages/${state.preparation.packageId}`);
async function original(id: string, expected: string) {
  const response = await fetch(base + `/api/v1/sources/${id}/file`, { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(sha(bytes), expected, "Retained source bytes changed."); return bytes;
}
async function attach(key: string, filename: string, bytes: Buffer, format: string) {
  if (state.attachments[key]) { assert.equal(state.attachments[key].sha256, sha(bytes)); return state.attachments[key]; }
  const pkg = await pkgGet(), form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)]), filename); form.set("format", format);
  form.set("expectedRevision", String(pkg.revision)); form.set("entityIds", JSON.stringify([state.building.id]));
  const updated = await api(`/import-packages/${pkg.id}/documents`, form, 201);
  const added = updated.parts.filter((part: any) => !pkg.parts.some((old: any) => old.id === part.id));
  assert(added.length && added.every((p: any) => p.entityIds.includes(state.building.id)));
  state.attachments[key] = { sourceRevisionId: added[0].sourceRevisionId, partId: added[0].id, filename, sha256: sha(bytes), bytes: bytes.length };
  await save(); return state.attachments[key];
}
async function pollBatch(id: string) {
  const deadline = Date.now() + Number(process.env.ML_VERIFY_TIMEOUT_MS || 900000); let last = "";
  while (Date.now() < deadline) {
    const batch = await api(`/spatial-ml/batches/${id}`);
    const status = batch.items.map((i: any) => `${i.task}/page${i.page}:${i.state}`).join(" ");
    if (status !== last) { console.log(status); last = status; await evidence("batch-progress", batch); }
    if (batch.items.every((i: any) => !["queued", "running"].includes(i.state))) return batch;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error("Actual private inference did not finish within the bounded wait.");
}
function calibration(item: any, exterior = false) {
  const contextRing = state.building.geometry.coordinates[0];
  const left = exterior ? Math.max(...contextRing.map((p: number[]) => p[0])) + 10 : Math.min(...contextRing.map((p: number[]) => p[0])) + 5;
  const top = Math.max(...contextRing.map((p: number[]) => p[1])) - 5;
  const { width, height, sha256 } = item.result.raster, scale = 40 / Math.max(width, height);
  return { rasterSha256: sha256, imagePoints: [[0, 0], [width, 0]], worldPoints: [[left, top], [left + width * scale, top]], frame: state.preparation.placement.targetFrame,
    reason: `T061 ${state.run}: explicitly authored synthetic test controls, ${scale} m/pixel. Published source dimensions are not asserted. Not survey evidence.` };
}
function expectedRing(component: any, c: any) {
  const scale = (c.worldPoints[1][0] - c.worldPoints[0][0]) / c.imagePoints[1][0];
  return component.geometry.coordinates[0].map(([x, y]: number[]) => [x * scale + c.worldPoints[0][0], -y * scale + c.worldPoints[0][1]]);
}
function areaOf(ring: number[][]) { return Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2; }
function vertices(ring: number[][]) { return [...new Set(ring.map(p => p.map(n => n.toFixed(5)).join(",")))].sort(); }
function geometryVertices(coordinates: any): number[][] {
  return typeof coordinates[0] === "number" ? [coordinates] : coordinates.flatMap(geometryVertices);
}
async function verifyOriginals() {
  const detail = await api(`/cases/${state.preparation.caseId}`);
  for (const input of Object.values(state.attachments) as any[]) await original(input.sourceRevisionId, input.sha256);
  for (const before of state.originalStatuses || []) {
    const after = detail.sources.find((source: any) => source.id === before.id);
    assert(after); assert.equal(after.status, before.status, "ML must not replace original receipt status."); assert.equal(after.sha256, before.sha256);
    if (!(Object.values(state.attachments) as any[]).some(input => input.sourceRevisionId === before.id)) await original(before.id, before.sha256);
  }
  await pass("Original source bytes and independent receipt statuses preserved", { originals: Object.keys(state.attachments).length });
}

try {
  if (!record) {
    const status = await api("/spatial-ml/status"); await evidence("model-status", status);
    for (const task of ["floor-plan", "building"]) assert(status.models.some((m: any) => m.task === task && m.ready), `Pinned ${task} model must be ready before creating verification data.`);
    if (!state.building) {
      const raw = { spatialReference: { wkid: 32643 }, features: [{ attributes: { id: "T061-TEST-PROPERTY", name: `T061 synthetic ML verification ${state.run.slice(0, 8)}`, height: 9 }, geometry: { rings: [[[500000, 3100000], [500060, 3100000], [500060, 3100060], [500000, 3100060], [500000, 3100000]]] } }] };
      const form = new FormData(); form.set("file", new Blob([JSON.stringify(raw)]), "T061-authored-synthetic-context.json");
      for (const [key, value] of Object.entries({ format: "arcgis", namespace: `t061-actual-ml:${state.run}`, name: `T061 synthetic ML verification ${state.run.slice(0, 8)}`, worldStatus: "synthetic", mapping: JSON.stringify({ idField: "id", nameField: "name", kind: "building", heightField: "height", heightUnit: "m", geometryRole: "observed_ground_occupation" }) })) form.set(key, value);
      let context = state.contextPackageId ? await api(`/import-packages/${state.contextPackageId}`) : await api("/import-packages", form, 201);
      state.contextPackageId = context.id; state.areaId = context.areaId; await save();
      if (context.state !== "COMMITTED") {
        if (context.state !== "REVIEWED") context = await api(`/import-packages/${context.id}/review`, { expectedRevision: context.revision });
        context = await api(`/import-packages/${context.id}/commit`, { expectedRevision: context.revision, acknowledgement: "Authored synthetic context only, no survey, title or official identity claim." });
      }
      state.building = context.features[0]; await save();
    }
    if (!state.preparation) { state.preparation = await api(`/buildings/${state.building.id}/preparation-cases`, { expectedRevision: state.building.revision, requestKey: randomUUID() }, 201); await save(); }
    state.workspaceUrl = `${base}/studio/properties/${state.building.id}/workspace?area=${state.areaId}`;
    const floorPath = join(samples, "floor-samples/0"), buildingPath = join(samples, "building-samples/1200");
    await attach("floor", "published-CubiCasa-test-1191-F1_scaled.png", await readFile(join(floorPath, "F1_scaled.png")), "png");
    await attach("floorAttribution", "published-CubiCasa-source-attribution.txt", await readFile(join(floorPath, "source.json")), "text");
    await attach("building", "published-OAM-test-1200-source-original.png", await readFile(join(buildingPath, "source-original.png")), "png");
    await attach("buildingAttribution", "published-OAM-test-1200-source-attribution.txt", await readFile(join(buildingPath, "source.json")), "text");
    await attach("emptyBuilding", "published-OAM-test-1-source-original.png", await readFile(join(samples, "building-samples/1/source-original.png")), "png");
    await attach("emptyBuildingAttribution", "published-OAM-test-1-source-attribution.txt", await readFile(join(samples, "building-samples/1/source.json")), "text");
    const benchmark = `T061-SYNTHETIC-BM-${state.run.slice(0, 8)}`;
    await attach("levels", "T061-authored-synthetic-room-levels.csv", Buffer.from(`alias,lower,upper,unit,benchmark,label,level\nML-ROOM-01,0,3,m,${benchmark},Synthetic metric verification room,Synthetic ground\n`), "csv");
    await attach("controls", "T061-authored-synthetic-controls.txt", Buffer.from(`Verification ${state.run}. All metre controls, exterior context, floor levels and vertical benchmark ${benchmark} are authored synthetic test values. Published floorplan and overhead raster originals retain their own attribution and are not surveys of this fictional property. Model contours must be retained exactly; heights never come from imagery.`), "text");
    if (!state.originalStatuses) { const detail = await api(`/cases/${state.preparation.caseId}`); state.originalStatuses = detail.sources.map((s: any) => ({ id: s.id, sha256: s.sha256, status: s.status })); await save(); }
    await pass("New synthetic test property retains published originals and distinct synthetic metric evidence", { areaId: state.areaId, buildingId: state.building.id });
    if (!state.batchRequest) {
      const pkg = await pkgGet(), floor = state.attachments.floor, building = state.attachments.building, empty = state.attachments.emptyBuilding;
      state.batchRequest = { packageId: pkg.id, expectedRevision: pkg.revision, requestKey: randomUUID(), items: [
        { sourceRevisionId: floor.sourceRevisionId, partId: floor.partId, page: 1, task: "floor-plan" },
        { sourceRevisionId: floor.sourceRevisionId, partId: floor.partId, page: 2, task: "floor-plan" },
        { sourceRevisionId: building.sourceRevisionId, partId: building.partId, page: 1, task: "building" },
        { sourceRevisionId: empty.sourceRevisionId, partId: empty.partId, page: 1, task: "building" },
      ] }; await save();
    }
    const created = await api("/spatial-ml/batches", state.batchRequest, 201); state.batchId = created.id; await save();
    assert.equal((await api("/spatial-ml/batches", state.batchRequest, 201)).id, created.id);
    await api("/spatial-ml/batches", { ...state.batchRequest, items: state.batchRequest.items.slice(0, 1) }, 409);
    if (process.argv.includes("--retry-failed")) {
      const recovery = process.env.ML_RECOVERY_RUN || "runtime-recovery-1";
      assert(/^[a-zA-Z0-9_-]{1,80}$/.test(recovery));
      state.recoveryRequests ||= {}; state.recoveryRequests[recovery] ||= {};
      state.recoveryBaselines ||= {};
      if (!state.recoveryBaselines[recovery]) { state.recoveryBaselines[recovery] = created; await evidence(`batch-before-${recovery}`, created); await save(); }
      for (const item of created.items.filter((i: any) => i.page === 1 && ["failed", "blocked", "cancelled"].includes(i.state))) {
        state.recoveryRequests[recovery][item.id] ||= randomUUID(); await save();
        const requestKey = state.recoveryRequests[recovery][item.id], retry = await api(`/spatial-ml/items/${item.id}/retry`, { requestKey });
        assert.equal((await api(`/spatial-ml/items/${item.id}/retry`, { requestKey })).currentJobId, retry.currentJobId);
      }
    }
    const batch = await pollBatch(created.id); await evidence("batch", batch);
    const floor = batch.items.find((i: any) => i.task === "floor-plan" && i.page === 1), failed = batch.items.find((i: any) => i.page === 2), building = batch.items.find((i: any) => i.sourceRevisionId === state.attachments.building.sourceRevisionId);
    const empty = batch.items.find((i: any) => i.sourceRevisionId === state.attachments.emptyBuilding.sourceRevisionId);
    assert.equal(empty.state, "empty", JSON.stringify(empty.attempts)); assert.equal(empty.result.components.length, 0);
    assert.equal(failed.state, "failed"); assert.equal(failed.attempts.at(-1).errorCode, "UNSUPPORTED_SOURCE");
    for (const item of [floor, building, empty]) {
      assert.equal(item.state, item.id === empty.id ? "empty" : "succeeded", JSON.stringify(item.attempts));
      if (item.id !== empty.id) assert(item.result.components.length);
      assert.equal(item.result.receipt.sourceSha256, item.sourceSha256); assert.equal(item.result.receipt.inputFingerprint, item.inputFingerprint);
      assert.equal(item.result.model.sha256, item.modelSha256);
      assert.equal(item.attempts.at(-1).state, item.state); assert.equal(item.attempts.filter((a: any) => ["succeeded", "empty"].includes(a.state)).length, 1);
      for (const before of Object.values(state.recoveryBaselines || {}) as any[]) {
        const prior = before.items.find((i: any) => i.id === item.id);
        if (prior) assert.deepEqual(item.attempts.slice(0, prior.attempts.length), prior.attempts, "Recovery must retain prior attempts unchanged.");
      }
      assert.equal(item.result.receipt.profileVersion, status.models.find((m: any) => m.id === item.modelId).profileVersion);
      for (const kind of ["raster", "mask"]) {
        const artifact = item.result[kind], response = await fetch(base + artifact.url); assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(sha(bytes), artifact.sha256); assert.equal(response.headers.get("x-content-sha256"), artifact.sha256);
        assert.equal(bytes.readUInt32BE(16), artifact.width); assert.equal(bytes.readUInt32BE(20), artifact.height);
        await writeFile(join(out, `${item.id === empty.id ? "building-empty" : item.task}-${kind}.png`), bytes);
      }
      assert.deepEqual((await api(`/spatial-ml/items/${item.id}`)).result, item.result);
    }
    state.floorItemId = floor.id; state.buildingItemId = building.id; state.emptyItemId = empty.id; state.failedItemId = failed.id; await save();
    await pass("Real private worker floor/building inference and per-page partial failure", { batchId: batch.id, floorRegions: floor.result.components.length, buildingRegions: building.result.components.length });
    await pass("Immutable raster/mask bytes, pixel grid, pinned models and reload receipts match");
    await pass("Published empty evaluation tile retains genuine empty output without invented regions", { itemId: empty.id });
    const component = floor.result.components.find((c: any) => !/^(outdoor|wall|walls|railing|background|outside)$/i.test(c.className) && c.geometry.type === "Polygon" && c.geometry.coordinates.length === 1);
    assert(component, "No simple room topology is supported by the detailed prism builder; do not invent replacement geometry.");
    if (state.preparation.placement.status !== "reviewed") {
      const current = await pkgGet();
      await api(`/spatial-ml/items/${floor.id}/apply`, { expectedRevision: current.revision, requestKey: randomUUID(), entityId: state.building.id, selections: [{ componentId: component.id, subject: "ML-ROOM-01" }], property: "space.geometry", calibration: calibration(floor) }, 422);
      state.preparation = await api(`/import-packages/${state.preparation.packageId}/placement`, { expectedRevision: state.preparation.revision, sourceFrame: state.preparation.placement.targetFrame, verticalReference: benchmark, verticalOffset: 0, evidence: [{ sourceRevisionId: state.attachments.controls.sourceRevisionId, partId: state.attachments.controls.partId }], reason: "Reviewed explicitly authored synthetic test frame/benchmark; no real-world survey claim." }); await save();
    }
    if (!state.applyRequest) { const pkg = await pkgGet(); state.applyRequest = { expectedRevision: pkg.revision, requestKey: randomUUID(), entityId: state.building.id, selections: [{ componentId: component.id, subject: "ML-ROOM-01" }], property: "space.geometry", calibration: calibration(floor) }; await save(); }
    if (!state.factIds) {
      await api(`/spatial-ml/items/${floor.id}/apply`, { ...state.applyRequest, requestKey: randomUUID(), expectedRevision: state.applyRequest.expectedRevision + 1000 }, 409);
      await api(`/spatial-ml/items/${floor.id}/apply`, { ...state.applyRequest, requestKey: randomUUID(), calibration: { ...state.applyRequest.calibration, rasterSha256: "0".repeat(64) } }, 409);
      const applied = await api(`/spatial-ml/items/${floor.id}/apply`, state.applyRequest);
      const application = applied.item.applications.at(-1); state.factIds = application.factIds; state.component = component;
      state.expectedRing = expectedRing(component, state.applyRequest.calibration); await save();
      assert.equal(state.factIds.length, 2);
      const geometry = applied.package.factCandidates.find((f: any) => state.factIds.includes(f.id) && f.property === "space.geometry");
      assert.equal(geometry.method, "ai_extraction"); assert.equal(geometry.worldStatus, "synthetic");
      assert(geometry.evidence.some((e: any) => e.sourceRevisionId === floor.sourceRevisionId && e.partId === floor.partId));
      assert.equal(geometry.value.type, "Polygon");
      assert.deepEqual(vertices(geometry.value.coordinates[0]), vertices(state.expectedRing));
      assert(Math.abs(areaOf(geometry.value.coordinates[0]) - areaOf(state.expectedRing)) < 1e-6);
      assert(state.factIds.every((id: string) => !applied.package.selectedClaimIds?.includes(id)), "Application must not auto-review generated facts.");
      const replay = await api(`/spatial-ml/items/${floor.id}/apply`, state.applyRequest);
      assert.equal(replay.package.factCandidates.length, applied.package.factCandidates.length);
      const dedup = await api(`/spatial-ml/items/${floor.id}/apply`, { ...state.applyRequest, expectedRevision: replay.package.revision, requestKey: randomUUID() });
      assert.equal(dedup.package.factCandidates.length, replay.package.factCandidates.length); assert.equal(dedup.item.applications.length, 1);
      await api(`/spatial-ml/items/${floor.id}/apply`, { ...state.applyRequest, calibration: { ...state.applyRequest.calibration, reason: "Changed request using the same key must fail." } }, 409);
      await evidence("unreviewed-package", dedup.package);
    }
    await pass("Calibrated exact room contours remain unreviewed; replay/dedup and stale/fingerprint guards hold", { factIds: state.factIds });
    if (!state.footprintRequest) { const pkg = await pkgGet(), context = await api(`/areas/${state.areaId}/context`); state.footprintRequest = { expectedRevision: pkg.revision, expectedAreaRevision: context.area.revision, requestKey: randomUUID(), selections: [{ componentId: building.result.components[0].id, subject: "T061 synthetic placement of published roof" }], calibration: calibration(building, true) }; await save(); }
    const draft = await api(`/spatial-ml/items/${building.id}/footprint-drafts`, state.footprintRequest);
    state.footprintPackageId = draft.package.id; await save();
    assert.equal((await api(`/spatial-ml/items/${building.id}/footprint-drafts`, state.footprintRequest)).package.id, draft.package.id);
    assert.notEqual(draft.package.state, "COMMITTED"); assert.equal(draft.package.features.length, 1);
    assert.equal(draft.receipt.originalSha256, building.sourceSha256); assert.equal(draft.receipt.rasterSha256, building.result.raster.sha256);
    assert(draft.package.features[0].evidence.some((e: any) => e.sourceRevisionId === building.sourceRevisionId));
    assert.equal(draft.package.features[0].height.value, null);
    const roofPixels = geometryVertices(building.result.components.find((c: any) => c.id === state.footprintRequest.selections[0].componentId).geometry.coordinates);
    const control = state.footprintRequest.calibration, scale = (control.worldPoints[1][0] - control.worldPoints[0][0]) / control.imagePoints[1][0];
    state.expectedRoofVertices = vertices(roofPixels.map(([x, y]) => [control.worldPoints[0][0] + x * scale, control.worldPoints[0][1] - y * scale]));
    assert.deepEqual(vertices(geometryVertices(draft.package.features[0].geometry.coordinates)), state.expectedRoofVertices);
    await save();
    await evidence("footprint-draft", draft); await pass("Building mask enters ordinary footprint draft review with original evidence and no inferred height", { packageId: draft.package.id });
    await verifyOriginals(); state.stage = "extracted-unreviewed"; delete state.lastFailure; await save();
    console.log(`READY FOR BROWSER ${state.workspaceUrl}`);
  } else {
    assert(state.stage === "extracted-unreviewed" || state.stage === "recorded", "Run extraction and browser verification first.");
    if (!state.retryVerified) {
      state.retryKey ||= randomUUID(); await save();
      const retry = await api(`/spatial-ml/items/${state.failedItemId}/retry`, { requestKey: state.retryKey });
      assert.equal((await api(`/spatial-ml/items/${state.failedItemId}/retry`, { requestKey: state.retryKey })).currentJobId, retry.currentJobId);
      const batch = await pollBatch(state.batchId), failed = batch.items.find((i: any) => i.id === state.failedItemId);
      assert.equal(failed.state, "failed"); assert.equal(failed.attempts.length, 2); assert.notEqual(failed.attempts[0].jobId, failed.attempts[1].jobId);
      state.retryVerified = true; await save(); await evidence("batch-after-worker-retry", batch);
      await pass("Actual worker retry preserves prior failure and same-key retry creates one attempt");
    }
    if (!state.recordedUnitId) {
      let pkg = await pkgGet();
      const wanted = pkg.factCandidates.filter((f: any) => state.factIds.includes(f.id) || (f.subject === "ML-ROOM-01" && ["space.lower", "space.upper", "space.label", "space.levelLabel"].includes(f.property)));
      for (const property of ["space.geometry", "space.lower", "space.upper", "space.levelLabel"]) assert(wanted.some((f: any) => f.property === property), `Missing supported ${property}`);
      for (const fact of wanted) if (!pkg.selectedClaimIds?.includes(fact.id)) pkg = await api(`/import-packages/${pkg.id}/resolve-fact`, { expectedRevision: pkg.revision, claimId: fact.id, reason: "T061 explicit test review: retained published mask and separately authored synthetic metre controls/levels; no survey or rights claim." });
      await evidence("reviewed-package", pkg);
      const built = await api(`/import-packages/${pkg.id}/prepare-details`, { expectedRevision: pkg.revision }, 201);
      assert.equal((await api(`/import-packages/${pkg.id}/prepare-details`, { expectedRevision: pkg.revision }, 201)).job.id, built.job.id);
      state.buildJobId = built.job.id; await save(); let detail: any;
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        detail = await api(`/cases/${state.preparation.caseId}`);
        if (detail.model?.revision === detail.case.revision) break;
        const job = detail.jobs.find((j: any) => j.id === built.job.id); assert.notEqual(job?.status, "failed", job?.error);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      assert.equal(detail.model?.revision, detail.case.revision, "Actual build worker must finish.");
      assert.equal(detail.model.units.length, 1); const unit = detail.model.units[0];
      assert.deepEqual(vertices(unit.footprint), vertices(state.expectedRing));
      assert(Math.abs(unit.area - areaOf(state.expectedRing)) < 1e-5); assert.equal(unit.height, 3); assert(Math.abs(unit.volume - unit.area * 3) < 1e-5);
      const review = await api(`/buildings/${state.building.id}/detail-review`, { expectedRevision: detail.case.revision }, 201);
      await api(`/registry-reviews/${review.id}/commit`, { acknowledgement: "T061 synthetic metric workflow verification only. Published contours reviewed against retained raster; synthetic levels/control evidence. No survey, title or rights claim." });
      const dossier = await api(`/buildings/${state.building.id}/dossier`), spaces = dossier.records.filter((r: any) => r.kind === "space");
      assert.equal(spaces.length, 1); assert.equal(spaces[0].synthetic, true);
      assert(dossier.detailedScene.some((s: any) => s.record.id === spaces[0].id && s.geographicGeometry));
      assert(Math.abs(areaOf(spaces[0].footprint) - areaOf(state.expectedRing)) < 1e-5);
      assert.deepEqual(vertices(spaces[0].footprint), vertices(state.expectedRing));
      state.recordedUnitId = spaces[0].id; state.metrics = { area: unit.area, height: unit.height, volume: unit.volume }; await save();
      await evidence("recorded-dossier", dossier); await evidence("built-model", detail.model);
    }
    await pass("Exact model room contour follows normal review → real build → recorded 3D unit", { unitId: state.recordedUnitId, syntheticMetrics: state.metrics });
    let draft = await api(`/import-packages/${state.footprintPackageId}`);
    if (draft.state !== "COMMITTED") {
      for (const question of draft.questions.filter((q: any) => !q.answer && q.kind === "missing_height")) draft = await api(`/import-packages/${draft.id}/answers`, { expectedRevision: draft.revision, questionId: question.id, answer: { choice: "keep_2d", reason: "Overhead pixels provide no supported height. Retain as 2D roof proposal under explicitly synthetic placement." } });
      draft = await api(`/import-packages/${draft.id}/review`, { expectedRevision: draft.revision });
      draft = await api(`/import-packages/${draft.id}/commit`, { expectedRevision: draft.revision, acknowledgement: "Synthetic placement verification of published imagery contour only; no inferred height, parcel, survey, title or rights claim." });
    }
    assert.equal(draft.state, "COMMITTED"); await evidence("recorded-footprint", draft);
    const context = await api(`/areas/${state.areaId}/context`), roof = context.features.find((f: any) => f.id === draft.features[0].id);
    assert(roof); assert.equal(roof.height.value, null); assert.equal(roof.worldStatus, "synthetic");
    assert.deepEqual(vertices(geometryVertices(roof.geometry.coordinates)), state.expectedRoofVertices);
    await pass("Ordinary area review records the exact roof proposal while height remains unknown", { featureId: roof.id });
    await verifyOriginals(); state.stage = "recorded"; delete state.lastFailure; await save(); console.log("PASS actual-model workflow complete");
  }
} catch (error) {
  state.lastFailure = { at: new Date().toISOString(), message: error instanceof Error ? error.stack : String(error) };
  state.failures = [...(state.failures || []), state.lastFailure]; await save(); throw error;
}
