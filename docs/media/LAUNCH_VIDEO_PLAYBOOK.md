# BhuAayam launch films

**A practical guide to complete product stories, clean motion graphics and reproducible video.**
28 September 2026 · Production playbook v1.1

## 1. The recommendation

Keep the earlier film’s visual restraint and code-rendered foundation. Add a stronger story, complete demo coverage, fresh captures and a disciplined review loop.

The follow-up [data and coverage review](LAUNCH_DATA_AND_COVERAGE.md) inventories both launch folders and the newer desktop video. Use it for the specific capabilities and capture gaps of the next BhuAayam film; this document supplies the reusable production method.

The supplied architecture is useful. Its best ideas are explicit time-based rendering, real product assets, a shot list before animation, audio cues on a shared timeline, and inspecting the actual output. Those fit BhuAayam well. Its emphasis on viral one-shot showreels, constant novelty and mandatory springs is less useful for a product that needs viewers to understand evidence and decisions.

**The creative brief:** make BhuAayam feel impressive because the viewer sees a meaningful journey from source material to a usable, traceable record. Let motion reveal that journey.

The previous film already has much of the proposed engine. Its source uses native Skia Canvas through `@napi-rs/canvas`, time-driven scene functions, captured Studio camera sequences, an original procedural score and FFmpeg. A move to HTML, Remotion or another framework would not, by itself, make the next film better.

### What to adopt, adjust and leave behind

| Idea from the supplied architecture | Decision for BhuAayam |
| --- | --- |
| Render any frame from its timestamp | Adopt. Also pin assets, fonts, data snapshots and tool versions. |
| Use real screenshots, brand assets and UI states | Adopt. Capture complete actions and their outcomes, not just attractive screens. |
| Shot list, style guide, contact sheets and animatic | Adopt as a small set of production artifacts. |
| Measure music and place sound cues deliberately | Adopt. Let musical phrases support the story; preserve reading time. |
| One container morphs through every state | Use selectively for a motif or transition. It need not contain the whole film. |
| Something happens on every beat | Replace with purposeful pacing. A readable hold can be the right choice. |
| Springs everywhere; every shot a different technique | Replace with a consistent motion vocabulary and a few memorable moments. |
| Always render 60 fps with four subframes | Choose after a short motion test. Start from the working 30 fps pipeline. |
| One enormous HTML file | Keep a small shared renderer, separate scenes, a timeline and asset manifests. |
| Code must generate all music | Optional. Use the strongest suitable original or licensed score. |
| Three critique rounds and all scores above 8/10 | Fix observable defects. Scores are prompts for discussion, not proof of quality. |
| Continue after an approval timeout | Reject. Silence cannot resolve a required approval. Routine authorized edits can continue. |
| Model-specific installation commands and viral claims | Omit. The workflow should survive a change of model or tool. |

## 2. Define what “complete” means before animation

The earlier 52-second film covered sources, the map, a delivery diagram, height colours, a building inspector and an illustrative comparison. Its README records a broken Evidence tab and unavailable registry search during capture. It was a map-and-layers launch film, rather than a complete officer journey.

For the next film, create a **coverage sheet** before choosing final duration. For each requested feature, record:

| Field | What it answers |
| --- | --- |
| Viewer takeaway | What should someone understand after this moment? |
| Product route and action | What will we actually open, select, upload or review? |
| Input and resulting state | What changes, and how will the viewer see it? |
| Record and source | Which dataset, record, revision and source support the image or claim? |
| Capture status | Ready, needs recapture, or blocked; with a concrete reason. |
| Film location | Shot ID and time range, or an explicit scope decision. |

A feature is covered when its useful action and result are understandable. A title card naming “Evidence” does not cover evidence inspection. An animated arrow naming “AI” does not demonstrate extraction.

Aim for one coherent chain:

**Bring material in → understand what it contains → inspect it spatially → inspect its evidence → resolve or acknowledge issues → review and record → retrieve or verify the result.**

Follow one case through that chain where the available data supports it. If a city layer and an interior-plan example come from different sources or countries, introduce the second example clearly. Do not edit them into an apparent single property.

Every required capability must have a filmed moment or an explicitly resolved gap. Do not quietly move missing features into a future video. Optional social cutdowns can follow the main film; they do not substitute for its promised coverage.

## 3. Proposed BhuAayam story

Use **Identify → Prove → Govern** as the narrative spine. The following 105-second structure is a compact planning example, not a claim that every flow is currently available. After reviewing the broader retained material, the [complete-film treatment](LAUNCH_DATA_AND_COVERAGE.md#suggested-complete-film-timing) starts at roughly three minutes to include the citizen/officer loop, spatial tools and evidence inspection. Choose duration from coverage and reading time, then adjust after the animatic.

| Time | Sequence | Product proof and motion direction |
| --- | --- | --- |
| 0–4 s | The hook | A strong real spatial view, then a concise proposition. A source outline becomes the visual thread for the film. Avoid a long logo introduction. |
| 4–10 s | BhuAayam appears | Establish the actual Studio and the question the officer is trying to answer. One decisive camera move, then settle. |
| 10–23 s | Bring evidence together | Show supported files, inspection and a meaningful mapping/confirmation action. Enlarge the relevant UI region while keeping enough context to orient the viewer. |
| 23–31 s | See the result arrive | Show the actual import/result state and its link to the scene. If waiting is shortened, use a clear edit; never turn editorial timing into a speed claim. |
| 31–41 s | Understand the place | Reveal relevant map, imagery or elevation layers. Use a controlled orbit or layer transition; label distinct coverage or dates where needed. |
| 41–52 s | Find the exact object | Select a building, then a level or space only where supported. Keep the selection recognisable as the camera and inspector change. |
| 52–65 s | Follow the evidence | Open a real source locator, page, clause or source row. Match the selected feature to its evidence and hold the important content long enough to read. |
| 65–76 s | Understand the issue | Show a supported check, comparison or missing-evidence state. Highlight the exact finding and its basis. Unknown remains unknown. |
| 76–88 s | Review and record | Show a meaningful officer decision and resulting status. Use the actual workflow; do not animate an invented successful record or assignment. |
| 88–99 s | Use the result | Show the register and the supported card, export or same-device verification outcome. Give the result its own readable hold. |
| 99–105 s | Close | Resolve the visual motif into the brand lockup. “Identify. Prove. Govern.” and one accurate call to action. |

During scoping, explicitly check section/measurement tools, underground views, deviations, revision history and exports against the coverage sheet. The retained Launch 2 material includes the public request, officer and public-result journey; carry that workflow into the full-demo treatment. Public deployment, conversational assistance, production learning, generative previews and scale claims still require their own current evidence; demonstration footage does not establish those capabilities.

If complete coverage takes longer than the working budget, lengthen the film or agree on a narrower story. Do not solve it by making all the UI unreadably fast.

## 4. Visual and motion direction

Use the earlier film as the starting reference: warm off-white, deep forest green, restrained lime accents, large confident type and actual product imagery. Its observed palette includes `#F4F3EB`, `#102C25`, `#081F19`, `#235347` and `#D6F478`. Treat these as a film reference; use the current approved logo and product assets when capturing the new demo.

The product UI remains the actual light interface. Dark title or transition scenes belong to the film, not a redesigned application.

### Give each visual element a job

- **Large type** expresses one short idea, rather than explaining everything on screen.
- **The UI** proves the action and result. Enlarge the important panel instead of shrinking the entire desktop into a decorative card.
- **The 3D view** establishes spatial relationships. Keep orientation understandable and pause for inspection.
- **Highlights and leader lines** connect evidence to objects. They should point to exact captured content.
- **Whitespace** separates ideas. Avoid filling every corner with chapter labels, badges and captions.

Build three signature moments: a place revealed from its source layers; a selected object connected to evidence; and an evidence-backed result becoming a usable record or card. Reuse that visual language across the film.

### Motion rules

Use smooth easing for camera moves, masking and typography. Use restrained springs where a UI element benefits from a small sense of weight. Prefer a clean cut when the task changes; reserve elaborate transitions for relationships that matter.

Give each demonstration a setup, action and readable result. As an initial editing allowance, hold a simple result for roughly 2–3 seconds and a dense source detail for longer; confirm by watching at the intended playback size. Musical accents may punctuate a selection without forcing an immediate cut.

Use a cursor to clarify actual interactions. Record the click target and action outcome during capture, then derive any enlarged cursor from that event track. Do not place a decorative click over an unrelated screenshot.

Motion graphics can abstract a process, but cannot manufacture missing UI, records, geometry, evidence or product success. Keep “Illustrative” and other supported source-status labels visible where they affect interpretation.

## 5. Capture the product, then compose the film

Separate the unpredictable live application from the repeatable film render:

```text
Pinned demo + selected data
          ↓
Rehearsed actions and readiness checks
          ↓
Captured UI states / camera frames / action events
          ↓
Shot timeline + titles + motion + audio cues
          ↓
Frame renderer → encoder → review → final deliverables
```

### Before capture

Record the served application revision, dataset/record revisions and whether each relevant route uses local demonstration data or a live backend. Consult the [source index](../api/real-sources.md) and [dataset catalogue](../api/datasets.json). Reuse retained originals and manifests; new acquisition follows the project’s official-source rules.

Rehearse the complete selected journey once, including the source viewer and final result. A missing route or broken interaction becomes a named capture blocker. Resolve it through its owning lane or resolve the film’s scope; never disguise it with a fabricated screenshot. This preparation does not require rebuilding the product or qualifying every release gate.

Keep record IDs, source hashes, geography, dates, limitations and permission references in the capture manifest. These are production records, not clutter for every frame. Retain visible qualifications when their omission would change the meaning of the footage. Do not invent records or expected facts to fill the story.

### During capture

Use explicit readiness conditions: required data resolved, relevant layers loaded, expected selection visible, fonts ready and camera settled. Avoid treating an arbitrary delay or a continuously busy network as proof of readiness.

For a browser composition, explicitly load the fonts used by Canvas, await image decoding, and check the resulting assets before rendering. `document.fonts.ready` alone does not define or fetch an undeclared font. See the [FontFaceSet loading API](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load).

Capture important source details at a resolution suitable for their final crop. A large output canvas cannot recover detail from a small screenshot. Keep a wider establishing view and a sharper detail capture when necessary.

For 3D shots, reuse the product renderer. Preload the relevant assets, disable uncontrolled camera damping/auto-rotation for deterministic capture where supported, and set camera position and target from time. Coordinate any required application hook with the frontend owner. If deterministic capture is unavailable, retain the actual recording and edit from it; do not claim arbitrary-seek reproducibility for that capture.

Freeze footage and source snapshots before the full composition render. Rendering should not repeatedly upload files, mutate records or depend on a live provider. Use owned isolated services for any authorized rehearsal writes, and preserve original data and volumes.

### A concrete freshness issue to resolve

The old film’s manifest lists 1,662 prepared NYC building footprints. The current source index records 1,661 admitted display proposals and one rejected geometry; the rejected source ID is also the old close-up subject, `751920`. This is a reason to choose and capture the new subject from the current admitted records. It is not permission to alter the original dataset. Recheck the new build and receipt before using any count in copy.

## 6. Keep the existing renderer; make the production modular

The default for this project is the existing **native Canvas + captured product footage + FFmpeg** approach. Reuse the useful drawing, typography, camera-playback and audio code in a new versioned production folder. Preserve the earlier film and source.

Browser HTML/SVG is an option when DOM layout materially simplifies a shot. Remotion is an option for a recurring React-based video system with many reusable compositions. Both can follow the same frame-driven principle; Remotion’s documentation explicitly warns about animation not driven by its frame clock. See [Animating properties](https://www.remotion.dev/docs/animating-properties).

Do not migrate the engine just to follow the pasted article. First prototype the hardest 5–8 seconds in the current pipeline. Change tools only for a demonstrated limitation.

Suggested production structure:

```text
production/
  brief.md               story, audience, required coverage, formats
  coverage.csv           feature → action → outcome → shot
  style.md               palette, type, composition, motion rules
  timeline.json          shot ranges, captures, copy, layout, cues
  assets/manifest.json   original source and capture lineage
  assets/captures/        frozen product pixels and camera frames
  src/scenes/            one module per meaningful sequence
  src/motion/            shared easing, camera and transition helpers
  src/render.mjs         frame evaluation and encoder lifecycle
  audio/                 music, effects, cue data and mix
  review/                storyboard, animatic, relevant comparisons
  out/                   final film, poster, captions if used, receipt
  README.md              exact reproduction commands and versions
```

This is a proposed layout, not a new dependency or scaffold created by this document. Keep it smaller if the production does not need every part.

### Frame contract

Treat a frame as `render(frameIndex, frozenInputs)`, with `t = frameIndex / fps`. Use integer frame boundaries for the edit. A frame rendered directly should match the same frame reached after other frames, within the pinned rendering environment.

Derive motion and procedural decoration from time and a fixed seed. A random generator seeded once but advanced on every frame is still dependent on render order. Precompute decorative samples or key them to stable identifiers. Reset relevant drawing state for each frame.

Keep preview playback separate from export. Use an explicit render mode; do not rely solely on `navigator.webdriver`. Controlled browser clocks can assist capture, but do not freeze network data, asset loading or every source of state. See [Playwright Clock](https://playwright.dev/docs/clock).

Fail clearly on missing required assets, failed font loading or a nonzero encoder exit. Respect pipe backpressure and close owned processes on failure. Record the timeline, input hashes, tool versions, frame count and encoding settings. Pixel identity is an environment-specific check, especially for GPU scenes.

## 7. Technical corrections to the pasted examples

The snippets are useful sketches, not a production-ready package.

| Example or assertion | Correction |
| --- | --- |
| `t % duration` makes a seamless loop | It only wraps time. Position, appearance, velocity and audio must join across the boundary. Design a periodic sequence and inspect consecutive boundary frames. A launch film can simply end. |
| Hash the MP4 to test “frame 300” | Compare the same decoded pixel frame rendered directly, sequentially and after an out-of-order seek. Whole-file hashes can change with metadata or encoding and do not test frame independence. |
| `beats[::4]` supplies downbeats | It assumes 4/4 meter and that the first detected beat is a bar start. Verify meter and phase manually, or use the known tempo map of an original score. |
| Use the critical spring expression whenever damping ratio is at least one | The shown formula is exact at critical damping, not for the general overdamped case. Implement the proper cases or constrain and document the supported parameters. |
| Summing spring responses works for every animated property | Superposition applies to the chosen linear spring system. Per-step clamping, collisions or changing spring parameters need a different treatment. |
| Four averaged subframes always improve quality | Averaging successive frames can ghost small text. Choose a shutter interval, avoid sampling across hard cuts, and keep UI/text sharp. Use extra samples only where they visibly help. |
| A single 6×5 contact sheet at 2 fps reviews the film | It covers only about 15 seconds. Paginate across the entire duration and add samples around transitions and important outcomes. |
| Waiting for fonts makes the example portable | The example names a font without supplying its definition. Register/load licensed font files explicitly and fail on missing required faces. |
| “No dependencies” | The browser route still needs a browser, automation, fonts/assets and an encoder. Pin these just as carefully as the native Canvas dependency. |

The beat tracker returns estimated beat positions, not a verified musical bar map; this distinction follows its documented output. See [librosa beat tracking](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html). FFmpeg documents `tmix` as mixing successive frames; selective shutter sampling is an additional production decision. See [FFmpeg tmix](https://ffmpeg.org/ffmpeg-filters.html#tmix).

## 8. Sound and export

Build the score around the story’s energy: a short hook, room for evidence inspection, a lift around the useful result and a resolved ending. Choose the music before finalising detailed timing. If voiceover is used, establish the script and speech timings before polishing motion; include captions and keep the film understandable muted.

Use a small coherent sound palette: a restrained selection click, a soft transition and a deeper accent for a major reveal. Not every moving object needs a whoosh. For procedural music, export cues from the same timeline; for supplied music, verify detected beats by listening. Keep rights information with the audio assets.

| Output setting | Working recommendation |
| --- | --- |
| Primary format | 1920×1080, 16:9, suitable for the desktop product. |
| Frame rate | 30 fps by default; evaluate 60 fps for fast spatial motion using a short comparison. |
| Video | H.264, `yuv420p`, fast-start MP4; begin around CRF 16–18 and inspect the result. |
| Audio | Stereo AAC at 48 kHz; retain a separate uncompressed mix. |
| Loudness | Around −14 LUFS integrated and no higher than −1 dBTP as an initial web-delivery target, adjusted for the destination. |
| Other ratios | Recompose from the same story/assets. Do not crop a desktop film into vertical and lose the action. |

Measure loudness and true peak after mixing, then verify the encoded output. FFmpeg supports measured two-pass loudness normalisation; −14 LUFS is a working choice here, not a universal platform requirement. See [FFmpeg loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm).

## 9. Review only what the next decision needs

1. **Coverage and rehearsal:** confirm each required action/outcome and identify missing material. Do this before expensive animation.
2. **Storyboard:** inspect one representative still per shot, plus separate before/after states where a transition carries meaning.
3. **Animatic:** watch a low-resolution complete cut with provisional sound. Fix comprehension, reading time and the story’s ending.
4. **Motion proof:** render the hardest short sequence at final quality. Set the camera treatment, text scale and blur policy from that result.
5. **Full cut:** watch normal-speed playback with sound and muted. Inspect transition strips where something pops, clips or loses its relationship.
6. **Final delivery:** check the actual encoded file, not just source frames. Confirm duration, dimensions, frame rate, audio, full decode and complete feature coverage.

Contact sheets reveal composition and coverage; they cannot establish timing, smoothness or sound sync. Review the full duration, including the last result and closing hold. Check phone-width playback for the main message, then native-size details for UI proof. If a feature requires reading tiny text, recrop or recompose it.

Keep one short issue list with timestamps. Fix the important observed problems and rerender the affected sequence before the final assembly. No mandatory three-round campaign and no endless numerical scoring.

The final film is ready when the story is understandable, required features have actual outcomes, essential content is legible, claims match the captured data, motion has no visible defects and the soundtrack supports the edit.

## 10. Reusable production brief

> Create a complete BhuAayam launch film from the selected current frontend and data. Preserve the earlier film’s clean typography, restrained palette and confident camera work. Make the strongest moments come from the product doing something useful.
>
> Start by inventorying the selected build, assets and required demo capabilities. Rehearse the complete journey. Create a coverage sheet linking each requested feature to a real action, resulting state, source and shot. Surface missing capabilities before editing; do not fabricate UI or data to cover them.
>
> Tell the story through Identify → Prove → Govern. Derive the duration from the required coverage; the current complete-demo treatment starts around three minutes. Preserve reading time and the citizen/officer outcome. Use the actual product pixels and renderer. Keep unrelated datasets and geographies distinct.
>
> Build on the existing native Canvas and FFmpeg pipeline unless a short prototype reveals a concrete reason to change it. Use a shared frame-based timeline, frozen captures, modular scenes and deliberate audio cues. Keep the previous production intact.
>
> Review storyboard stills, a complete animatic and the hardest motion sequence before rendering the final film. Then inspect the encoded film with sound and muted, fix observable issues and verify the final export. Continue routine authorized production decisions; ask only for material missing direction or a required permission, never treat silence as approval.
>
> Deliver the film, poster, source, capture/source manifest, exact reproduction instructions and a concise coverage note. Include captions if speech is used. Produce additional formats only when requested or included in the brief.

## Reference basis

This playbook assesses the supplied text and the earlier production’s source, README, manifests and selected review stills. The linked follow-up inventories the second production and sampled frames from the newer desktop video. Neither document constitutes a frame-by-frame audiovisual review or a current runtime verification of the complete demo.

- [Earlier launch production](</Users/vinayak/Desktop/BhuAayam Launch/README.md>) and [renderer](</Users/vinayak/Desktop/BhuAayam Launch/source/film.mjs>).
- [Supplied architecture](</Users/vinayak/.codex/attachments/432191aa-809b-4ca1-aa4d-cdf331173522/Pasted text.txt>). Social engagement, model-performance and production-time claims were not used as technical evidence.
- [Frontend goal](../frontend/GOAL.md), [build tracker](../frontend/PLAN.md), [design system](../design-system/README.md), [source index](../api/real-sources.md), [source rules](../usp-agent-handoffs/28-data-acquisition-and-finale-tests.md) and [record-backed status vocabulary](../usp-agent-handoffs/99-ui-ux-and-integration.md).

Film production does not change frontend ownership or qualify a product release, accuracy benchmark, official issuance or production-scale claim.
