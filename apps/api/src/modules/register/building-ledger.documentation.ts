const str = { type: 'string' };
const integer = { type: 'integer' };
const array = (items: object) => ({ type: 'array', items });
const obj = (properties: Record<string, object>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const assertion = obj({ parcelId: str, value: str, issuer: str, sourceId: str });
const evidence = obj({ sourceId: str, locator: str });
export const buildingLedgerDocumentation = obj({
  schemaVersion: str,
  building: obj({ id: str, applicationId: str, revision: integer,
    recordState: { type: 'string', enum: ['recorded', 'unrecorded'] }, name: str,
    frame: obj({ id: str, benchmark: str }), placement: { type: 'string', enum: ['local_only', 'geographic'] } }),
  parcelUlpin: obj({ state: { type: 'string', enum: ['unknown', 'recorded', 'conflicting'] }, assertions: array(assertion) }),
  spaces: obj({ state: { type: 'string', enum: ['recorded', 'absent'] }, records: array(obj({
    id: str, applicationId: str, revision: integer, name: str, use: { type: 'string', nullable: true },
    evidence: array(evidence),
  })) }),
  sources: array(obj({ id: str, revision: integer, name: str, sha256: str, fileUrl: str, locators: array(str) })),
  history: obj({ feature: array(obj({ revision: integer, recordedAt: str })),
    registry: array(obj({ recordId: str, revision: integer, recordedAt: str })),
    featureHasMore: { type: 'boolean' }, registryHasMore: { type: 'boolean' } }),
  assessment: obj({ state: { type: 'string', enum: ['not_assessed'] },
    latestCheck: { type: 'string', enum: ['absent', 'historical'] }, reason: str }),
  missing: array(str),
});
