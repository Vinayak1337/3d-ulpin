# T061 actual-model workflow result

**Passed:** 10 API/workflow groups, 6 retained-result browser groups and 2 recorded
register browser groups. These ran against the local production application and
the actual private Docker Celery/ONNX worker. No ML transport or resolver was
mocked. Both browser journeys made zero API writes and reported no page errors or
failed API responses. See `workflow-result.json` for exact identities and receipts.

The new test dataset is **T061 synthetic ML verification 99741d82**:

- [Workspace](http://127.0.0.1:3000/studio/properties/1e6c6e44-15ee-4c41-b6bd-067e59151b47/workspace?area=4c039f5f-c667-405a-962c-c317e6f32a8b)
- [Recorded unit](http://127.0.0.1:3000/studio/properties/1e6c6e44-15ee-4c41-b6bd-067e59151b47/register?area=4c039f5f-c667-405a-962c-c317e6f32a8b&tab=floors&record=a0779a57-1106-4b5d-bd3f-1dbd498c777f)
- [Test block](http://127.0.0.1:3000/studio/areas/4c039f5f-c667-405a-962c-c317e6f32a8b?feature=1e6c6e44-15ee-4c41-b6bd-067e59151b47)

The batch retained four independent outcomes: 75 floor-plan regions, 8 building
regions, a genuine empty overhead tile, and a failed unsupported image page.
Exact original hashes, inference raster/mask hashes and dimensions, model hashes,
preprocessing profiles and reload receipts matched. Same-key replay returned the
same batch/application; conflicting keys, stale revisions and a different raster
hash were rejected. Applying the selected contour generated unreviewed facts.

One model contour then followed ordinary explicit fact review, the real geometry
build and technical recording. All 220 distinct vertices (221 closed-ring points)
were preserved. Under separately authored synthetic metre controls and a 3 m test
height, the computed area is **69.992404514 m²** and volume **209.977213542 m³**.
The canonical synthetic unit is `a0779a57-1106-4b5d-bd3f-1dbd498c777f`.
The real register rendered it selected in a ready 3D scene; reload retained that
identity and left its dossier unchanged.

A building component entered the ordinary derived-footprint draft, review and
commit flow. Its exact contour vertices and original source evidence survived.
The resulting synthetic roof feature is
`4090eb05-5a24-4ed6-b449-18631c183210`; its height remains `null`.

Eight attached originals were individually checked before and after failure,
recovery and recording: three published raster images, their three attribution
documents, and the separately authored synthetic levels/control documents. Their
bytes, SHA-256 hashes and receipt statuses remained unchanged. Exact public source
attribution JSON is also retained in `workflow/*-source-attribution.json`; no
credential or signed-URL fields were found. Existing datasets were not changed and
the repository snapshot was not refreshed.

The first real worker run exposed a missing native `libexpat.so.1` dependency in
rasterio polygonization. The original failed attempts and unchanged-source proof
remain in the evidence. Installing `libexpat1` and checking actual runtime imports
in readiness fixed it. The same items were retried with retained request keys;
previous failures were unchanged. The unsupported-page item was separately retried
through the actual worker and failed again without affecting its original source.

The UI was inspected at desktop and 390 px widths. Pixel overlays align with the
retained raster, result receipts and model limits remain visible, empty/failure
states are distinct, and the mobile Controls path fits without horizontal
overflow. Initial harness assumptions about retaining a desktop panel through its
responsive unmount and reading results before their asynchronous GET completed
were corrected; those harness failures remain separately recorded.

This is workflow and contour-preservation evidence. The published originals are
real evaluation sources; the surrounding property, metric placement and levels
are fictional test inputs. Floor classes and connected regions contain errors:
the selected bedroom-class region spans adjoining areas in the source plan. Its
recording does **not** approve room semantics or surveyed dimensions. Three input
images do not establish generalization, cadastral accuracy, Indian field
qualification or physical-device acceptance.

Key evidence: `workflow/batch-after-worker-retry.json`,
`workflow/unreviewed-package.json`, `workflow/recorded-dossier.json`,
`workflow/recorded-footprint.json`, `browser/results.json`,
`recorded-register/results.json`, and the corresponding PNG captures.
