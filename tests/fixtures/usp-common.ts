/** Authored contract examples, not a captured live property/identity/access grant. */
export const uspFixtures = {
  intake: { kind: 'intake', workspaceId: 'demo-workspace', version: 1 },
  scope: { kind: 'snapshot', scopeId: 'demo-area', world: { namespace: 'world', id: 'synthetic' },
    manifestId: 'data-manifest-1', snapshotDigest: 'a'.repeat(64), stage: 'draft' },
  pin: { ref: { namespace: 'space', id: '000127/U-A101' }, revision: 0 },
  create: { mode: 'create', requestKey: 'create-000127' },
  update: { mode: 'update', requestKey: 'edit-000127', expectedVersion: 1, expectedManifestId: 'data-manifest-1' },
  evidence: {
    sourceRevision: { ref: { namespace: 'source_revision', id: 'source-1' }, revision: 1 },
    assetRevision: { ref: { namespace: 'asset', id: 'original-1' }, revision: 1 },
    partRevision: { ref: { namespace: 'source_part', id: 'part-1' }, revision: 1 },
    locator: { kind: 'rows', range: { start: 1, end: 2 } }, purpose: 'record', origin: 'direct',
    target: { namespace: 'space', id: '000127/U-A101' },
  },
};
export const uspSerializedFixtures = Object.fromEntries(
  Object.entries(uspFixtures).map(([key, value]) => [key, JSON.stringify(value)]),
);
