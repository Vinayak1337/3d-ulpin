# BhuAayam launch reel

A 2 min 32 s launch film written as code: 3840 × 2160 at 60 fps (plus a 1080p cut), with an original score and a narrator. It covers the whole workflow: problem, ingest, AI reading, chunking and model hand-over, streaming, explore, floors and flats, checks, underground, proof, the Studio, then Identify · Prove · Govern.

## What changed from the first cut, and why

| First cut (`../launch`) | This reel |
| --- | --- |
| Neon mint, violet and teal on near-black: a generic "AI dashboard" look that isn't our product | The Studio's own design language: forest `#235347`, paper `#f4f7f8`, Studio map greys, status badges, white cards, Noto Sans. Night scenes only where they help (the cold open and the AI and chunk engine), with lime as the single accent |
| Small 46–64 px captions at the bottom, many long sentences | Editorial kinetic type: 70–190 px headlines with masked line reveals, one idea per beat |
| Crossfades between scenes | Cuts on a 100 BPM grid, with colour-panel, slat and iris wipes, a flash drop, a map-into-browser match cut, and a 3D wall of Studio screens |
| Ambient pad and blips, and drums in only a few windows | A full track in A minor: kick, clap, hats, sidechained bass, pads, arpeggio and a lead hook. It has a breakdown for the AI section, a snare-roll build into the drop, a muffled mix underground, and three hits for Identify · Prove · Govern |
| Sound design barely tied to the picture | A whoosh into every cut and impacts on section changes. Seals chime, each chunk publication rings a pentatonic note, and the code types audibly. The real Studio clicks and keystrokes are mapped from `events.json` |
| 3D in a dark, fogged city; a ghosted city that read as smoke | The Studio map look in 3D. Other buildings sink into the ground so the hero stands alone, and the frame is shifted so type and model never overlap |
| Fake Studio screenshots | Real recordings (`../launch/rec`) in browser frames with the real cursor, click ripples, zoom and a speed tag, plus a "Real Studio" step list beside them |
| 3 min 16 s | 2 min 32 s, cut on a 100 BPM grid |

The page also adds light film grain and deterministic camera drift, so it feels less synthetic.

## Pacing and voice-over

The scenes are authored on a 104 s clock. `warp.js` maps that clock to the film:

- Every cut and every voice-over line start is a knot.
- Each span plays at least 22% slower, and the ending plays 60% slower.
- Any span whose line needs more room stretches until the line fits under its headline.
- Each cut-to-cut segment is rounded to whole beats at 100 BPM.

The picture, the footage speed tags and the score all run through the same map, so text, voice, cuts and music stay together.

The narrator is Kokoro v1.0 (Apache-2.0), rendered locally as a 60/40 blend of `am_michael` and `am_onyx`. The script is in `vo/lines.json`. Each line has an authored span `[a, b]` that matches the headline it speaks, and a `say` text spelled for pronunciation ("Bhoo Aayaam", "three-D Ulpin"). `vo/vo.py` regenerates the WAVs and `durations.json`. The score ducks the music under every line and keeps the lead melody out of the spoken passages.

## Files

- `index.html`, `reel.css`: the 1920 × 1080 stage, using Studio tokens.
- `reel.js`: the timeline. It holds 15 scenes, kinetic type, wipes, footage frames and the 3D choreography.
- `world.js`: the Three.js city (official NYC footprints from `../launch/data/city.json`). It has a night plan and the Studio map look, a sink-to-footprint mode, and floors, flat, checks and utilities.
- `score.js`: the score and voice mix, rendered offline with Web Audio on the film clock.
- `warp.js`: the authored-to-film time map.
- `vo/`: the script, the generated narration and its generator.
- `render.mjs`: the renderer. `SCALE=2 FPS=60` renders 4K60.

## Render

```bash
python3 -m http.server 8790 --bind 127.0.0.1          # from the worktree root
open "http://127.0.0.1:8790/video/reel/index.html"     # Space plays; ←/→ step (Shift for 0.1 s); ?t=42
SCALE=2 FPS=60 node video/reel/render.mjs video out/reel4k.mp4 60 4   # 3840 × 2160, 60 fps
node video/reel/render.mjs audio out/reel.wav
ffmpeg -i out/reel4k.mp4 -i out/reel.wav -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 320k -ar 48000 -movflags +faststart out/BhuAayam-reel-4k.mp4
```

## On-screen content

- The city is the official NYC open-data building layer (ZCTA 10013); heights and footprints are the published values.
- Lake View Residence, Flat 801, its card, codes and register rows are the Studio's sample registry data. The chunk counts, the training curve and the model versions animate the design and are not measured results.
- Footage is the demo Studio recorded frame by frame. Each frame is tagged with its real speed ("Real time" or "2.4× speed").
