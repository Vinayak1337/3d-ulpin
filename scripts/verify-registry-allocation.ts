import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createSite,
  createRegistryDraft,
} from "../apps/web/lib/server/registry";
import { pool, transaction } from "../apps/web/lib/server/db";
import type { RegistryBody } from "../packages/contracts/src";

// This isolated allocation test never publishes records or modifies the demo site.
const site = await createSite(`Allocation test ${randomUUID()}`, {
  id: "LOCAL-ALLOCATION-TEST",
  benchmark: "SYNTHETIC-TEST",
  horizontalUnit: "m",
  verticalUnit: "m",
});
try {
  const body: RegistryBody = {
    alias: "TEST",
    name: "Synthetic test parcel",
    kind: "parcel",
    footprint: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    links: [],
    rights: [],
    evidence: [],
    synthetic: true,
  };
  const requestKey = randomUUID();
  const drafts = await Promise.all(
    Array.from({ length: 3 }, () =>
      createRegistryDraft(site.id, undefined, body, requestKey),
    ),
  );
  assert.equal(new Set(drafts.map((d) => d.id)).size, 1);
  assert.equal(new Set(drafts.map((d) => d.records[0].identifier)).size, 1);
  assert(drafts[0].records[0].identifier.endsWith(":P001"));
  const next = await createRegistryDraft(
    site.id,
    undefined,
    { ...body, alias: "NEXT" },
    randomUUID(),
  );
  assert(next.records[0].identifier.endsWith(":P002"));
  await assert.rejects(
    createRegistryDraft(site.id, undefined, body),
    /requestKey/,
  );
  const closed = [...body.footprint, body.footprint[0]];
  const space = await createRegistryDraft(
    site.id,
    undefined,
    {
      ...body,
      alias: "CLOSED",
      kind: "space",
      use: "apartment",
      footprint: closed,
      geometry: {
        id: randomUUID(),
        alias: "CLOSED",
        name: "Closed ring test",
        kind: "unit",
        footprint: closed,
        lower: 0,
        upper: 3,
        lowerVerified: false,
        upperVerified: false,
        bindings: {},
        revision: 1,
        levelLabel: "Ground",
      },
    },
    randomUUID(),
  );
  assert.equal(space.records[0].footprint.length, 4);
  assert.deepEqual(
    space.records[0].footprint,
    space.records[0].geometry!.footprint,
  );
  console.log(
    "PASS Closed record and prism rings share canonical stored coordinates.",
  );
  console.log(
    "PASS Concurrent new-record retries reuse one draft and identity; the next allocation advances without reuse.",
  );
} finally {
  // Remove only the unpublished, source-free objects created by this test invocation.
  await transaction(async (client) => {
    await client.query("DELETE FROM registry_drafts WHERE site_id=$1", [
      site.id,
    ]);
    await client.query(
      "DELETE FROM registry_records WHERE site_id=$1 AND revision=0",
      [site.id],
    );
    await client.query("DELETE FROM cases WHERE site_id=$1", [site.id]);
    await client.query(
      "DELETE FROM registry_sites WHERE id=$1 AND revision=0",
      [site.id],
    );
  });
  await pool().end();
}
