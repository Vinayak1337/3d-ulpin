# Independent officer verification — 15 September 2026

The production browser checks and synthetic B preparation were performed in a separate headless Chromium session. All B source upload, fact selection, placement review, model build, technical review and recording actions used the actual UI. The real Bronx area was read-only. Exact timings, samples, source hashes, identifiers, final build ID and screenshot hashes are retained in [officer-independent-ui.json](evidence/officer-independent-ui.json).

## What was observed

- The retained real Bronx context renders 62 buildings with non-local HTTP(S) blocked. Local Cesium assets and blob workers remain allowed. Source identifier `353927` opens its canonical property and the same property’s register/preparation links. Unknown lookup returns “Not present in loaded data.”
- A’s recorded synthetic floor and room reopened in plan/section with its then-current 0–3 m bounds and named benchmark. A’s subsequent correction to 4 m belongs to the UI agent’s separate evidence.
- B’s first authored synthetic CSV supplied its 4×4 m outline, lower level, name and floor but omitted the upper level. After those four facts and placement were reviewed, building correctly returned HTTP 422 with `synthetic-b-room: review its upper level.` A separate synthetic reference CSV supplied upper 3 m. The fifth reviewed fact allowed a model with one space; technical review returned three proposed records and zero findings, and the UI recorded them.
- After reload, B retained identifier `3DU-4CC6J5WEQ99HY9BWKRJ67J6P1A:B002` and its own `S002` room under Ground. The section shows 0–3 m at `BM-SYNTHETIC-UI-ONLY`. Read-only dossier readback confirms 16 m² and 48 m³. Both original CSV files and the reviewed derivative remain linked. These are deliberately synthetic observations, not real survey evidence.
- Final production reopens B and renders its neighbors with external HTTP(S) blocked and no console errors. One earlier capture overlapped a deliberate server rebuild and its local worker request failed while the server was stopped; that interrupted capture was replaced after restart.

## Bounded local measurements

| Measurement | Result | Scope |
| --- | --- | --- |
| Fresh context to captured rendered 62-building scene | 1,299 ms | N=1; includes network-idle quiet wait and screenshot overhead |
| Warm reload to captured scene | 1,123 ms | N=1; same definition |
| Property selection to matching dossier response/visible content | p95 71 ms; max 198 ms | 20 alternating exterior-only B/C selections after warmup |
| Matching dossier browser request | p95 35.679 ms | Same 20 requests; not database-only timing |
| Continuous camera drag, frames with actual GL draws | 59.96 frames/s | 360 drawn frames in 6,004 ms; 11,042 GL draw calls; N=1 |
| Continuous-drag drawn-frame interval | p95 16.7 ms | WebGL draws binned by animation-frame intervals |
| Sparse wheel interaction | 19.10 drawn frames/s | 60 input events with nominal 80 ms pauses; input-paced/request-render behavior, not maximum capacity |

The browser-only [camera frame probe](evidence/camera-render-probe.js) records the continuous-drag method. The renderer was `ANGLE Metal Renderer: Apple M3` in headless Chromium at 1366×768 and device pixel ratio 1. The frame probe wraps actual WebGL draw calls and only counts animation intervals containing draws; it is not an idle requestAnimationFrame benchmark or direct GPU-present timing. Other agents performed local UI work during this session. Initial load/selection samples precede the final small UI/proposal changes; final camera and reopen captures use the build identified in the JSON. These samples do not establish performance on low-end devices or large interior models.

1366×768, 1920×1080, 1093×614 and 390×844 viewports showed no page horizontal overflow. **1093×614 is the CSS viewport equivalent of 1366×768 at 125%; native browser zoom was not tested.** Mobile places the inspector below the map and uses an explorer overlay. Initial read-only production checks had zero console errors/warnings; B’s expected missing-upper rejection accounts for one HTTP 422 console entry during the negative test.

## Retained screenshots

- [Final real 62-building area](evidence/ui/independent/officer-final-real62.png)
- [Final B room in its shared block](evidence/ui/independent/officer-final-B-room.png)
- [B recorded section](evidence/ui/independent/officer-independent-B-recorded-section.png)
- [1920×1080](evidence/ui/independent/officer-independent-1920.png), [125% equivalent only](evidence/ui/independent/officer-independent-125-equivalent.png), [mobile](evidence/ui/independent/officer-independent-mobile.png)

AI transport and preparation integration is separately documented in [OFFICER_AI.md](OFFICER_AI.md): 22 unit checks and 10 scoped integration checks pass, with zero actual Nous inference runs. The local mock transport proves bounded validation, persistence, crop processing and isolation; it does not prove real model quality. The Indian data permission and coherent-document blockers remain recorded in [SOURCE_ACCESS.md](../demo-data/real-block/SOURCE_ACCESS.md).

## Restart and offline reopen

After the lead restarted all local services, web and dispatcher with external server HTTP(S) egress denied, a fresh independent browser context also blocked non-local HTTP(S). The real 62-building scene and B’s room with A/C neighbors rendered again. B002/S002 and both property navigation destinations remained unchanged. The UI downloaded the retained upper-reference CSV again, and its bytes exactly matched the original upload. No source/record mutation or browser console error occurred. [Restarted real area](evidence/ui/independent/officer-restart-real62.png) · [Restarted B room](evidence/ui/independent/officer-restart-B-room.png).
