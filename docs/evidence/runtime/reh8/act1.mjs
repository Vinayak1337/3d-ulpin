import { save } from './audit.mjs';

// REH8 Act 1 as read from the presenter's log (E:/BhuAayam-data/task-data/reh8/dress-log.jsonl): marks, step
// results and API exchanges, in seconds from each file's drop or press. Frame figures are the page's own recorder
// (dress.mjs); headless Chromium with software WebGL. Screenshots under task-data/reh8/shots, not in Git.
const caseId = '36807201-fef9-4c50-abf9-92ceb8917683';
save('act1.json', {
  act: 1, label: 'our data (NYC), through the Studio front door: Add files, then Add files to batch', caseId,
  caseName: 'REH8 act 1 our data test_only', runtimeNotEmpty: 'Niagara area and the REH4/REH6 batches were present',
  files: [
    { file: 'nyc-10013-multimodal.zip', bytes: 14621643, droppedAt: '2026-10-18T08:35:35Z',
      seconds: { dropToRetainDialog: 0.04, retainPressToBatchWithProbeWords: 13.65 },
      probe: 'ZIP read: 6 map layers taken in as their own files; DEM, LiDAR, ortho and manifest kept, not taken in',
      layers: {
        'buildings-original.geojson': { features: 1662, outcome: 'refused',
          screen: 'This file is already the source of the area "buildings original". Open that area; nothing new '
            + 'is prepared from a second copy.' },
        'roadbed.geojson': { features: 446, outcome: 'ready_not_carded', officerAnswer: 'road, identified by id',
          seconds: { useLayoutToOnTheMap: 5 }, note: 'drafted into a new area "roadbed"; not a building, no card' },
        'parks.geojson': { features: 41, outcome: 'held', screen: 'Needs an answer. No approved layout matches this '
          + 'file. An officer states what each feature is and which field identifies it.', officerAnswer: 'none' },
        'sidewalk.geojson': { features: 213, outcome: 'held', screen: 'Needs an answer (same words)' },
        'hydrography.geojson': { features: 1, outcome: 'held', screen: 'Needs an answer (same words)' },
        'boundary-original.geojson': { features: 1, outcome: 'held', screen: 'Needs an answer (same words)' },
        'DEM, LiDAR, ortho': { outcome: 'held', screen: 'File checked; Not placed yet (not a map layer)' },
      },
      outcome: 'held', frames: 'no part drawn: the buildings layer was refused as a second copy' },
    { file: '5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson (DA6, NYC Building Footprints)',
      bytes: 43263076, droppedAt: '2026-10-18T08:37:13Z',
      seconds: { retainPressToDialogClosed: 5.2, hashInBrowser: 1.6, upload: 2.0, firstProbeWords: 13.7,
        inventoryRead: 'about 260 (48,686 records, about 190 a second; screen said only "Reading file")',
        useLayoutToFirstPackage: 197, useLayoutToLastPackage: 704, packageInterval: 'about 15 to 30',
        firstDrawnPart: null },
      parts: { packages: 25, buildingsReady: 48683, notAcceptedByReader: 3, perPackage: 2000 },
      officerAnswer: 'a building; identifier doitt_id; name not stated; height not offered for large files',
      framesBatchPageWhileStreaming: { from: '08:42:09Z', to: '08:53:53Z', frames: 41499, largestMs: 267,
        over50: 54, over100: 23, longTasks: 208, longestTaskMs: 275,
        note: 'each new package re-renders the growing package list: worst frame 117 ms at package 1 to 267 ms '
          + 'at package 20' },
      map: { area: 'roadbed (the batch\'s only new area: the buildings were drawn into it)',
        whileWriting: 'display-window 503 SERVICE_UNAVAILABLE after 17.1 and 17.7 s (twice); context 422 '
          + 'AREA_LIMIT "Choose an area with at most 10,000 display features."',
        afterRecording: { firstWordsSeconds: 23.2, displaySummarySeconds: 16.4, firstPageSeconds: 32.8,
          to15000DrawnSeconds: 89, screen: 'Showing 15,000 buildings in view, the most drawn at once; move '
            + 'closer to see the rest.', frames: 3180, largestMs: 750, over100: 532, longestTaskMs: 771 } },
      outcome: 'card' },
    { file: 'haryana-2831-tower3-plan1.pdf', bytes: 1655334, seconds: { retainPressToDialogClosed: 1.1 },
      outcome: 'held', screen: 'Not understood. Kept as a PDF document (1.6 MB). No reader in a batch takes this '
        + 'kind of file yet, so it is not on the map; the original is kept with its SHA-256.' },
    { file: 'haryana-2831-tower3-section.pdf', bytes: 2448909, seconds: { retainPressToDialogClosed: 1.1 },
      outcome: 'held', screen: 'Not understood. Kept as a PDF document (2.3 MB). (same words)' },
    { file: 'bihar-magnolia-sanctioned-layout-original.pdf', bytes: 2455183,
      seconds: { retainPressToDialogClosed: 0.6 }, outcome: 'held', screen: 'Not understood. Kept as a PDF '
        + 'document (2.3 MB). (same words)' },
  ],
  card: {
    target: 'feature 122062 of the DA6 file', chosen: 'ticked one of 200 listed ready buildings',
    acknowledgement: 'Rehearsal REH8, test_only data: record these packages from the retained NYC file and make one '
      + 'card for feature 122062.',
    screenBeforePress: 'These packages will be recorded in the register. The 1 chosen buildings will then get a '
      + 'snapshot, an evidence plan and packet, and a property card made and verified without another press. Every '
      + 'other ready building of these packages will be recorded without a card.',
    confirmationRoute: { route: `POST /api/v1/ingestion/cases/${caseId}/confirmations`, status: 202, seconds: 9.9 },
    seconds: { pressToAllRecorded: 386, pressToCardMadeAndVerified: 398.5 }, recorded: 48683,
    card: '199d97e7-50db-45f2-8764-abef3ecf0d99 revision 1', pdf: { bytes: 6901, contentType: 'application/pdf' },
    verification: { page: '/verify/card/199d97e7-50db-45f2-8764-abef3ecf0d99/1', verdict: 'Consistent',
      checks: '6 of 6 passed', signature: 'not assessed (NO_TRUSTED_KEY_POLICY)' },
    printed: { selectedRecord: 'Building 122062 (building); revision 1', identity: 'Identity codes are for '
      + 'recorded spaces only', source: '5zhs-2jue-...geojson, feature 122062', geometry: 'Unavailable: Not '
      + 'supplied by the executed text/CSV profile', rights: 'Not assessed' },
    recordPage: 'Property Card: "Blocked: select a unit with an assigned proposed code" although the card exists',
  },
  pageErrors: 0,
  consoleErrors: 10,
  liveStream: '153 aborted reads of /ingestion/cases/:id/events over the act (the page reconnects and polls '
    + 'intake and targets every 2 to 3 s)',
  idleNote: 'After Act 1 the page was left open about 90 min (session limit); one ERR_NO_BUFFER_SPACE at 10:16Z',
});
