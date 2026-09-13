import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type {
  RegistryDetail,
  RegistryDraft,
  RegistryReview,
  RegistryRecord,
  RegistryQuery,
} from "../packages/contracts/src";
const base = "http://127.0.0.1:3000/api/v1";
async function api<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  status = 200,
): Promise<T> {
  const r = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await r.json();
  assert.equal(r.status, status, JSON.stringify(result));
  return result;
}
const strip = (r: RegistryRecord) => {
  const { id, siteId, identifier, revision, ...b } = structuredClone(r);
  if (b.geometry) {
    const { area, height, volume, ...g } = b.geometry;
    b.geometry = g as any;
  }
  return b;
};
const evidence: string[] = [];
const sites = await api<any[]>("/sites");
const site = sites.find((s) => s.name === "Nandan block");
assert(site);
let detail = await api<RegistryDetail>(`/sites/${site.id}`);
assert.equal(detail.records.filter((r) => r.kind === "space").length, 14);
assert.equal(detail.records.filter((r) => r.kind === "floor").length, 4);
assert.equal(detail.records.filter((r) => r.alias === "BASE").length, 1);
assert.equal(detail.records.filter((r) => r.alias === "UTIL").length, 1);
evidence.push(
  "14 spaces, four distinct building-floor records, single shared basement and corridor",
);
const q = await api<RegistryQuery>(`/sites/${site.id}/query`, {
  mode: "volume",
  frame: site.frame,
  footprint: [
    [10, 11],
    [14, 11],
    [14, 14],
    [10, 14],
  ],
  lower: -5,
  upper: 0,
});
assert.deepEqual(
  Object.fromEntries(
    q.results
      .filter((r) => r.volume > 0)
      .map((r) => [r.record.alias, r.volume]),
  ),
  { UTIL: 4, BASE: 12 },
);
const point = await api<RegistryQuery>(`/sites/${site.id}/query`, {
  mode: "point",
  frame: site.frame,
  point: [4, 6],
});
assert.deepEqual(
  point.results.map((r) => r.record.alias),
  ["BASE", "A-101", "A-201"],
);
const boundary = await api<RegistryQuery>(`/sites/${site.id}/query`, {
  mode: "point",
  frame: site.frame,
  point: [12, 6],
});
assert(boundary.results.some((r) => r.contact));
assert(
  boundary.results.some((r) => r.record.alias.startsWith("A-")) &&
    boundary.results.some((r) => r.record.alias.startsWith("B-")),
);
await api(
  `/sites/${site.id}/query`,
  {
    mode: "point",
    frame: { ...site.frame, benchmark: "OTHER" },
    point: [4, 6],
  },
  "POST",
  422,
);
await api(
  `/sites/${site.id}/query`,
  {
    mode: "volume",
    frame: site.frame,
    footprint: [
      [0, 0],
      [2, 2],
      [0, 2],
      [2, 0],
    ],
    lower: -5,
    upper: 0,
  },
  "POST",
  422,
);
evidence.push(
  "Independent 12/4 m³ impacts, ordered vertical stack, shared boundary and invalid input rejection",
);
const current = detail.records.find((r) => r.alias === "A-201")!,
  original = structuredClone(current);
let draft = await api<RegistryDraft>(
  `/sites/${site.id}/drafts`,
  { recordId: current.id },
  "POST",
  201,
);
let body = strip(draft.records[0]);
body.geometry!.lower = 2.8;
body.rights[0].party = "Household A-201 · proposed correction";
draft = await api<RegistryDraft>(
  `/registry-drafts/${draft.id}`,
  { expectedRevision: draft.revision, recordId: current.id, body },
  "PATCH",
);
let review = await api<RegistryReview>(`/registry-drafts/${draft.id}/review`, {
  expectedRevision: draft.revision,
  expectedSiteRevision: detail.site.revision,
});
assert(
  Math.abs(
    review.findings
      .filter((f) => f.code === "OVERLAP")
      .reduce((n, f) => n + (f.overlap?.volume || 0), 0) - 8,
  ) < 1e-8,
);
await api(
  `/registry-reviews/${review.id}/commit`,
  { acknowledgement: "test" },
  "POST",
  422,
);
let resolved = await api<{ record: RegistryRecord }>(
  `/registry/${current.identifier}`,
);
assert.deepEqual(resolved.record, original);
evidence.push(
  "8 m³ blocking correction; current geometry and rights remain untouched",
);
body = strip(draft.records[0]);
body.geometry!.lower = 3;
body.rights[0].party = original.rights[0].party;
draft = await api<RegistryDraft>(
  `/registry-drafts/${draft.id}`,
  { expectedRevision: draft.revision, recordId: current.id, body },
  "PATCH",
);
review = await api<RegistryReview>(`/registry-drafts/${draft.id}/review`, {
  expectedRevision: draft.revision,
  expectedSiteRevision: detail.site.revision,
});
assert(!review.findings.some((f) => f.severity === "error"));
assert(review.findings.some((f) => f.severity === "warning"));
await api(
  `/registry-reviews/${review.id}/commit`,
  { acknowledgement: "" },
  "POST",
  422,
);
await api(`/registry-reviews/${review.id}/commit`, {
  acknowledgement:
    "The corrected synthetic elevation matches the fixture; manual edit remains explicitly unverified.",
});
const after = await api<RegistryDetail>(`/sites/${site.id}`);
await api(`/registry-reviews/${review.id}/commit`, {
  acknowledgement: "Retry",
});
assert.equal(
  (await api<RegistryDetail>(`/sites/${site.id}`)).site.revision,
  after.site.revision,
);
resolved = await api(`/registry/${current.identifier}`);
assert.equal(resolved.record.id, current.id);
assert.equal(resolved.record.geometry!.lower, 3);
evidence.push(
  "Warning acknowledgement enforced; commit retry is idempotent; ID unchanged",
);
// Two reviewed drafts based on the same current site revision: only the first commits.
detail = await api(`/sites/${site.id}`);
const a = await api<RegistryDraft>(
  `/sites/${site.id}/drafts`,
  { recordId: current.id },
  "POST",
  201,
);
const b = await api<RegistryDraft>(
  `/sites/${site.id}/drafts`,
  { recordId: detail.records.find((r) => r.alias === "B-201")!.id },
  "POST",
  201,
);
const [ra, rb] = await Promise.all(
  [a, b].map((d) =>
    api<RegistryReview>(`/registry-drafts/${d.id}/review`, {
      expectedRevision: d.revision,
      expectedSiteRevision: detail.site.revision,
    }),
  ),
);
await api(`/registry-reviews/${ra.id}/commit`, {
  acknowledgement: "Synthetic consistency check.",
});
await api(
  `/registry-reviews/${rb.id}/commit`,
  { acknowledgement: "Stale test" },
  "POST",
  409,
);
const refreshed = await api<RegistryDetail>(`/sites/${site.id}`);
const fresh = await api<RegistryReview>(`/registry-drafts/${b.id}/review`, {
  expectedRevision: b.revision,
  expectedSiteRevision: refreshed.site.revision,
});
await api(`/registry-reviews/${fresh.id}/commit`, {
  acknowledgement: "Fresh synthetic neighbour check.",
});
evidence.push(
  "Changed neighbour snapshot rejects stale review; fresh review succeeds",
);
const beforeSeed = await api<RegistryDetail>(`/sites/${site.id}`);
const seeded = await api<RegistryDetail>("/registry-demo", {});
assert.deepEqual(seeded, beforeSeed);
evidence.push("Repeated seed preserves operator revisions and all current IDs");
const search = await api<any[]>(
  `/registry?q=${encodeURIComponent("Household A-201")}`,
);
assert(search.some((r) => r.id === current.id));
const report = {
  passed: evidence.length,
  siteId: site.id,
  recordId: current.id,
  identifier: current.identifier,
  evidence,
};
await writeFile(
  "test-results/registry-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
