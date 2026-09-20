import test from "node:test";
import assert from "node:assert/strict";
import type { CaseDetail, ImportPackage, PreparationCase } from "@ulpin/contracts";
import { preparationBuildState, type PreparationReceipt } from "../apps/web/lib/preparation-continuation";
import { groupPreparationFacts, evidenceLabel, evidencePage } from "../apps/web/features/officer/workspace/fact-review";

function fixture() {
  const pkg = { id: "package", revision: 12, sourceRevisionIds: ["derivative"], parts: [] } as unknown as ImportPackage;
  const prep = { caseId: "case", packageId: "package", revision: 3, buildingRevision: 2,
    placement: { status: "reviewed" } } as PreparationCase;
  const detail = { case: { id: "case", revision: 7 }, sources: [{ id: "derivative", sha256: "bytes", status: "ready" }],
    jobs: [{ id: "built", caseId: "case", operation: "build", status: "succeeded", inputFingerprint: "current" }],
    model: { caseId: "case", revision: 7, inputFingerprint: "current", units: [{ id: "space" }] } } as CaseDetail;
  const receipt: PreparationReceipt = { payloadHash: "bytes", result: { caseId: "case", caseRevision: 7, sourceId: "derivative", packageRevision: 12 } };
  return { pkg, prep, detail, receipt };
}
const state = (f: ReturnType<typeof fixture>) => preparationBuildState(f.pkg, f.prep, f.detail, f.receipt, "current", 2);

test("reload resumes the model for the post-derivative package revision", () => {
  const f = fixture();
  assert.equal(state(f).status, "ready");
  assert.equal(state(f).spaceCount, 1);
  assert.deepEqual(state(structuredClone(f)), state(f));
});
for (const [name, edit] of Object.entries({
  "changed source fact package": (f: ReturnType<typeof fixture>) => f.pkg.revision++,
  "edited placement package": (f: ReturnType<typeof fixture>) => { f.pkg.revision++; f.prep.revision++; },
  "unreviewed placement": (f: ReturnType<typeof fixture>) => { f.prep.placement.status = "unresolved"; },
  "changed canonical exterior": (f: ReturnType<typeof fixture>) => { f.prep.buildingRevision = 1; },
  "another prepared case": (f: ReturnType<typeof fixture>) => { f.receipt.result.caseId = "other"; },
  "modified case geometry": (f: ReturnType<typeof fixture>) => { f.detail.case.revision++; },
  "missing original derivative": (f: ReturnType<typeof fixture>) => { f.pkg.sourceRevisionIds = []; },
  "different derivative bytes": (f: ReturnType<typeof fixture>) => { f.detail.sources[0].sha256 = "wrong"; },
  "old model revision": (f: ReturnType<typeof fixture>) => { f.detail.model!.revision--; },
  "old model fingerprint": (f: ReturnType<typeof fixture>) => { f.detail.model!.inputFingerprint = "old"; },
  "foreign case model": (f: ReturnType<typeof fixture>) => { f.detail.model!.caseId = "other"; },
})) test(`${name} cannot resume an earlier review`, () => {
  const f = fixture(); edit(f); assert.equal(state(f).status, "needs_build");
});
for (const status of ["queued", "running", "failed", "stale", "cancelled"] as const)
  test(`${status} current build never exposes a prior successful model`, () => {
    const f = fixture();
    f.detail.jobs.unshift({ ...f.detail.jobs[0], id: "latest", status });
    assert.equal(state(f).status, ["queued", "running"].includes(status) ? "processing" : "retry_build");
  });
test("an unrelated successful job is not proof of current preparation", () => {
  const f = fixture(); f.detail.jobs[0].inputFingerprint = "old";
  assert.equal(state(f).status, "retry_build");
});
test("unrelated newer jobs do not hide the exact successful build", () => {
  const f = fixture(); f.detail.jobs.unshift({ ...f.detail.jobs[0], id: "other", inputFingerprint: "old", status: "failed" });
  assert.equal(state(f).status, "ready");
});
test("no persisted preparation receipt cannot be replaced by a succeeded model", () => {
  const f = fixture();
  assert.equal(preparationBuildState(f.pkg, f.prep, f.detail, undefined, "current", 2).status, "needs_build");
});

test("unresolved conflicts come first; replacing a reviewed value preserves alternatives", () => {
  const fact = (id: string, property: string, subject = "G") => ({ id, property, subject, entityId: "building", value: id, evidence: [], method: "native_parse" as const, evidenceState: "unverified" as const, worldStatus: "observed" as const });
  const facts = [fact("name", "space.label"), fact("low", "space.lower"), fact("other-low", "space.lower"), fact("upper", "space.upper"), fact("other-upper", "space.upper")];
  const grouped = groupPreparationFacts(facts as ImportPackage["factCandidates"], ["upper"]);
  assert.deepEqual(grouped.pending.map((f) => f.id), ["low", "other-low", "name"]);
  assert.deepEqual(grouped.reviewed.map((f) => f.id), ["upper"]);
  assert.deepEqual(grouped.alternatives.map((f) => f.id), ["other-upper"]);
  assert.deepEqual([...grouped.conflictingIds], ["low", "other-low"]);
  assert.equal(facts[0].id, "name");
});
test("source labels show source/page context without flooding raw JSON locators", () => {
  const { pkg } = fixture(); pkg.parts = [{ id: "part", sourceRevisionId: "doc", locator: "line 18 $.attribution.details", text: "{raw json}", entityIds: [] }];
  assert.equal(evidenceLabel({ sourceRevisionId: "doc", partId: "part" }, pkg, [{ id: "doc", name: "Survey.json" }]), "Survey.json · line 18");
  assert.equal(evidenceLabel({ sourceRevisionId: "doc", page: 3, partId: "part" }, pkg, [{ id: "doc", name: "Plan.pdf" }]), "Plan.pdf · Page 3");
});

test("corroborating candidates remain individually reviewable without a false conflict", () => {
  const base = { id: "one", entityId: "building", property: "space.lower", subject: "G", value: 0, unit: "m", referenceFrameId: "BM", evidence: [] };
  const facts = [base, { ...base, id: "two", evidence: [{ sourceRevisionId: "second" }] }] as ImportPackage["factCandidates"];
  const grouped = groupPreparationFacts(facts);
  assert.equal(grouped.pending.length, 2);
  assert.equal(grouped.conflictingIds.size, 0);
  for (const change of [{ value: 1 }, { unit: "ft" }, { referenceFrameId: "another benchmark" }]) {
    const conflict = groupPreparationFacts([facts[0], { ...facts[1], ...change }]);
    assert.deepEqual([...conflict.conflictingIds], ["one", "two"]);
  }
});
test("structured candidate equality ignores object-key order, not geometry coordinates", () => {
  const base = { id: "one", entityId: "building", property: "space.geometry", subject: "G", value: { type: "Point", coordinates: [1, 2] }, evidence: [] };
  const equal = { ...base, id: "two", value: { coordinates: [1, 2], type: "Point" } };
  assert.equal(groupPreparationFacts([base, equal] as ImportPackage["factCandidates"]).conflictingIds.size, 0);
  equal.value.coordinates = [2, 1];
  assert.equal(groupPreparationFacts([base, equal] as ImportPackage["factCandidates"]).conflictingIds.size, 2);
});

test("show source restores the exact cited page from retained part context", () => {
  const { pkg } = fixture();
  pkg.parts = [{ id: "part", sourceRevisionId: "doc", locator: "page 4", text: "Source text", entityIds: [] }];
  assert.equal(evidencePage({ sourceRevisionId: "doc", partId: "part" }, pkg), 4);
  assert.equal(evidencePage({ sourceRevisionId: "doc", partId: "part", page: 2 }, pkg), 2);
  assert.equal(evidencePage({ sourceRevisionId: "doc" }, pkg), undefined);
});
