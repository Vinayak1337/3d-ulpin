# K12 client requests (not sent)

**Before roll-out:** the lead must apply `operation-manifest-additions.json` to the evidence operation manifest,
then run the two generators. This branch cannot pass OpenAPI reconciliation or start API documentation as-is.
The manifest is outside this worker's owned paths. No migration is needed.

## Runtime owner's two reads after that roll-out

Use the demo's existing local-operator access and JSON content type. These are **pure POST reads**, not keyed
commands. The following values come from R3 and F3d's retained answers, not a new live read.

### 1. POST `/api/v1/usp/packets/plans/entries`

```json
{
  "scope": {
    "kind": "snapshot",
    "scopeId": "ed4bc3ae-1b02-412e-a5cc-02accf693a1b",
    "world": {
      "namespace": "world",
      "id": "registry-site/ed4bc3ae-1b02-412e-a5cc-02accf693a1b"
    },
    "manifestId": "a9fd4c9d-0a5a-4f4d-9032-527ab7857b78",
    "snapshotDigest": "b7bfa9d7c8f51583d80b985551161bdd758c47315b256267caf62e1d119ff7e0",
    "stage": "recorded"
  },
  "target": {
    "ref": { "namespace": "registry_record", "id": "46b7265e-ca88-402d-83df-065cf7c45140" },
    "revision": 2
  }
}
```

If target, source and access remain unchanged, expect 200, `data.target` equal to the input and one entry:
- `bindingId`: `1e3291701c573f7561ce1b13fc49bc2394561760cb4214394638115435f731de`, as R3 recorded;
- `kind: source_statement`, `label: UNIT-3B`, `includable: true`, `reasonCode: null`;
- citation source `5293cd72-2377-4deb-a51c-c76d11ccb429`, revision 1, page 1;
- locator `page 1; region pt [596,390,644,409]; literal UNIT-3B`, region `[596,390,644,409]` in page points.

The answer names eligibility of the recorded entry, not successful native crop validation. Plan create still
checks page/crop bounds. Changed context is refused; no entry, source, receipt or plan is stored by this read.
Other target profiles return 422 `PACKET_PLAN_ENTRIES_SOURCE_ONLY`.

### 2. POST `/api/v1/usp/property-cards/preview`

Replace `EXPIRES_AT` below with a chosen future offset-aware ISO timestamp at most 24 hours from sending.
It is a template placeholder, not a literal valid request value. Do not reuse an already expired timestamp.

```json
{
  "planId": "8f3ebb97-deab-4235-a377-819e5942bfd8",
  "planVersion": 1,
  "cardId": "6a997624-6c8d-40a9-8215-8a671a74dc1c",
  "expiresAt": "EXPIRES_AT",
  "guard": {
    "mode": "update",
    "expectedVersion": 1,
    "expectedManifestId": "a9fd4c9d-0a5a-4f4d-9032-527ab7857b78"
  }
}
```

If this remains the unrevoked latest card revision with accessible executed plan/packet, expect 200:
`data.mode: update`, `revision: 2`, the requested expiry, the plan's scope above, and ordered `facts` equal to
what a **new** generate command with these inputs would answer now. No new card id, revision, receipt, object
or PDF is created. Repeating the preview answers the same rows while the inputs/authority remain unchanged.
An expired old card does not itself prevent a revision preview: the revision guard checks revocation, not old
expiry. An executed plan's historical disclosure remains accessible after its original plan expiry.

Rows come from the unchanged projection: UNIT-3B, its recorded code, source-stated floor/building/citation,
and explicit unavailable/not-assessed states for facts the snapshot does not support. Do not compare wording
to R3's old PDF: the parallel card-wording worker may change the current projection. The equality is with
**generate now**, not an already stored card. Header/footer/QR lines and font/layout checks are not previewed.

## Studio bodies, field by field

**Entries:** `scope` is the exact scope answered by snapshot capture or identity assignment, unchanged;
`target.ref.namespace` is `registry_record`; `target.ref.id` is the selected unit id; `target.revision` is its
captured record revision. No request key, recipe, reason, expiry, source id or client-computed hash is sent.
Keep the returned `entries[0].bindingId` for plan create and show its label/citation as answered.

**Preview:** `planId` and `planVersion` come from create/execute's answered plan id/version; `expiresAt` is the
same officer-chosen timestamp the intended generate command will use. For a new card, `cardId: null` and
`guard: { mode: 'create' }`. For a revision, `cardId` is the chosen card, `guard.mode: update`,
`guard.expectedVersion` is that card's latest revision and `guard.expectedManifestId` is its own snapshot's
manifest from the card read. No scope, principal, request key, facts, renderer profile or invented card id is
sent. The answer supplies mode/revision/facts/expiry/scope. It requires an executed plan, so execute must
precede preview; preview cannot close the older requirement to see rows before execution stores a packet.

G7 remains a lead/Studio decision: neither route chooses an officer's expiry or inclusion reason.
