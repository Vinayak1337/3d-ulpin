/** Private, current-record projection. Absence here does not imply a legal or technical finding. */
export interface BuildingLedger {
  schemaVersion: 'building-ledger/1';
  building: {
    id: string;
    applicationId: string;
    revision: number;
    recordState: 'recorded' | 'unrecorded';
    name: string;
    frame: { id: string; benchmark: string };
    placement: 'local_only' | 'geographic';
  };
  parcelUlpin: {
    state: 'unknown' | 'recorded' | 'conflicting';
    assertions: Array<{ parcelId: string; value: string; issuer: string; sourceId: string }>;
  };
  spaces: {
    state: 'recorded' | 'absent';
    records: Array<{
      id: string;
      applicationId: string;
      revision: number;
      name: string;
      use: string | null;
      evidence: Array<{ sourceId: string; locator: string }>;
    }>;
  };
  sources: Array<{
    id: string;
    revision: number;
    name: string;
    sha256: string;
    fileUrl: string;
    locators: string[];
  }>;
  history: {
    feature: Array<{ revision: number; recordedAt: string }>;
    registry: Array<{ recordId: string; revision: number; recordedAt: string }>;
    featureHasMore: boolean;
    registryHasMore: boolean;
  };
  assessment: {
    state: 'not_assessed';
    latestCheck: 'absent' | 'historical';
    reason: string;
  };
  missing: string[];
}
