# BhuAayam launch video

A launch film of about 3 min 36 s, written as code. It cuts **real Studio recordings** (upload, live streaming, floors, checks, Property Card, register, portal) together with motion graphics for what the screen can't show (the problem, AI reading unfamiliar data, the chunk engine with ML hand-over, the proposal). Every frame is a pure function of time, so renders are deterministic.

- `film.js`: the edit, a list of recording clips (with speed, zoom path and captions) and graphics ranges. Recorded clips get a screen frame, cursor, click ripples, file-drop chips and a "Real time" or "2× speed" tag.
- `record.mjs`: drives the demo Studio (`pnpm studio:demo`) through the flows and captures every painted frame into `rec/` (git-ignored, about 150 MB).

- `index.html`, `style.css`: the 1920 × 1080 stage.
- `main.js`: the timeline. It holds 14 scenes, the captions, camera choreography and the chunk-engine simulation.
- `city.js`: the Three.js world. It uses the official NYC building footprints for ZCTA 10013 (`data/city.json`, converted to metres), with floors, a flat, the deviation and overlap checks, and the underground utilities.
- `audio.js`: the soundtrack, synthesised offline with Web Audio. It is cued to the cuts, chunk publications, file seals and typing.
- `shots/`: real Studio screenshots used in the Studio segment.

## Preview and render

```bash
python3 -m http.server 8790 --bind 127.0.0.1        # from the worktree root
open "http://127.0.0.1:8790/video/launch/index.html" # Space plays; ←/→ step; ?t=78 starts at 78 s
node video/launch/render.mjs stills 12,60,115 out/   # PNG stills
node video/launch/record.mjs video/launch/rec        # re-record the Studio (demo Studio must be running)
node video/launch/render.mjs video out/video.mp4 30 4
node video/launch/render.mjs audio out/music.wav
node video/launch/render.mjs mux out/video.mp4 out/music.wav out/BhuAayam-launch.mp4
```

Rendering needs ffmpeg (`brew install ffmpeg`) and the repository's Playwright. Set `GPU=0` to use SwiftShader instead of Metal.

## Voice-over script

The captions carry the story on their own. To add a voice, keep it under the music, around −6 dB below the captions' pace.

In the current cut the order is: open and problem (graphics), ingest (recorded), understand and normalise (graphics), then stream, explore, adaptive intake, documents to floors, check, identify, findings, underground and portal (all recorded), then the proposal and end card (graphics). The times below come from the earlier graphics-only cut; reuse the lines in the new order.

| Time | Scene | Voice-over |
| --- | --- | --- |
| 0:00 | Open | "Land records are flat. Cities aren't." |
| 0:09 | Logo | "BhuAayam. *Bhu*, land. *Aayam*, dimension. The 3D property registry." |
| 0:14 | Problem | "One building, three records, three answers. The deed, the sanctioned plan and the drone survey disagree, and today an officer reconciles them by hand." |
| 0:26 | Ingest | "With BhuAayam, the officer drops in whatever evidence exists: GIS layers, deeds, tables, plans, LiDAR and imagery. The originals are sealed first, so every result traces back to unchanged bytes." |
| 0:37 | Understand | "When data is unfamiliar, the backend hands a small sample to AI. AI reads the structure, then proposes how to split the file and what each field means: this column is roof height, in feet. AI only proposes; deterministic code converts and checks, and nothing is invented." |
| 0:53 | Normalise | "The file is split by meaning into complete features. AI normalises the first chunks into one unified schema, while a second worker trains a model on every checked result. Once the model qualifies, it takes over the remaining chunks, faster. If it is unsure, the chunk goes back to AI. Chunks finish in any order, but the map fills in order." |
| 1:18 | Stream | "So the city appears live on the map while the upload is still running, chunk by chunk." |
| 1:32 | Explore | "Search any building and fly straight to it. Height, parcel and source: every value cites its evidence." |
| 1:48 | Floors | "Every building opens into its floors, and every flat gets its own 3D ULPIN." |
| 2:02 | Check | "Where the plan and the survey disagree, BhuAayam shows it in place: one storey more than sanctioned. Overlaps are measured in 3D and resolved as a hashed revision." |
| 2:14 | Underground | "Below the parcel sit water, sewer, gas and a metro corridor. Draw a trench and see what it crosses." |
| 2:23 | Studio | "All of this lives in BhuAayam Studio, built for the officer." |
| 2:37 | Card | "Each flat gets a Property Card with a QR code anyone can verify: the same revision and the same hash chain." |
| 2:46 | Register | "The building register lists floors, flats, owners and residents, and exports in forms that are human-readable and machine-usable." |
| 2:55 | Proposal | "What we propose is a 3D land registry that builds itself from the evidence. Identify. Prove. Govern." |
| 3:08 | End | "BhuAayam. Every floor. Every flat. One verifiable record." |

## On-screen content

- The city is the official NYC open-data building layer; heights, BINs and BBLs are the published values.
- The Lake View deed, plan, survey, register rows, Property Card and resident names are the Studio's sample registry data. The chunk counts, the training curve and the model versions animate the design. They are not measured results.
