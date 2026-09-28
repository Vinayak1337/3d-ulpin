# Demo video: explaining adaptive ingestion

This is what to say and show when the video explains how BhuAayam takes in messy evidence. The source is the agreed backend workflow in [docs/api/adaptive-ingestion-workflow.md](../api/adaptive-ingestion-workflow.md) on `staging`. The screen actions are in [DEMO_VIDEO.md](DEMO_VIDEO.md).

## The one idea to land

> An officer drops in whatever evidence they have. BhuAayam keeps the originals untouched, breaks each file into pieces that still make sense, works on those pieces in parallel, and shows them on the map in order as each one passes its checks. A result that isn't certain goes to AI for a suggestion. Code does the actual conversion, and the system learns from every checked example.

If the viewer remembers only one thing: **original kept, split by meaning, checked, published in order, learns as it goes.**

## Where it goes in the video

About 75 seconds of motion graphics between beat 1 (the problem) and beat 2 (the Lake View upload). The live screens that follow then prove parts of it:

- The Lake View upload shows the proposed mapping and progress.
- The NYC ZIP shows streaming: 2,363 features arrive in order while the map fills.
- Findings mode shows validation.

Call back to the graphic when each one appears ("this is the ordered publisher you just saw").

## Script: six beats

Speak slowly. Each beat is one graphic.

### A · Any evidence in (0:00–0:10)

**Say:** "A property's story is scattered: survey layers, deeds and tables, floor plans, drone point clouds, satellite imagery. The officer uploads them together, as files or one archive."

**Show:** File icons of different kinds (GeoJSON, PDF, XLSX, DWG/IFC, LAS, GeoTIFF) falling into one upload box. A progress bar starts immediately.

### B · The original is sacred (0:10–0:20)

**Say:** "Large files upload in resumable parts, so nothing is lost if the connection drops. Before anything is touched, the exact original bytes are stored and fingerprinted. Every later result points back to them."

**Show:** The file splits into upload parts, reassembles, and gets a lock icon with a SHA-256 tag. Show a small caption: "Designed for 1–7 GB sources".

### C · Split by meaning, not by size (0:20–0:35)

**Say:** "Cutting a file every ten megabytes would break it. BhuAayam splits along meaning: whole features in a map layer, row groups with their headers in a table, sections in a document, windows in an image, point batches in a scan. Each piece gets a number: 0, 1, 2, and so on."

**Show:** Three lanes labelled **Upload parts** (bytes), **Processing chunks** (meaning) and **Map tiles** (display). Then chunks numbered 0…N drop into one queue.

### D · The cheapest route that is good enough (0:35–0:50)

**Say:** "Each chunk takes the cheapest route that is qualified to handle it. First, a known recipe for this exact format. Next, a trained model. Last, AI. The AI never sees the whole city: it gets a small evidence packet and proposes which field means what. For example: 'this column is height, in feet.' The AI only proposes; code does the conversion and checks the result. Once a mapping works, the other chunks reuse it."

**Show:** A three-way switch: **Recipe → ML → AI**. A small card reads "HGT_FT → height (ft → m)". A gear labelled "deterministic converter" does the work.

### E · Checked, recovered, published in order (0:50–1:05)

**Say:** "Every result is checked: shape, units, coordinates, identifiers, links to other records. Routine failures fix themselves: retry, try another reader, shrink the batch. A piece that truly can't be read is set aside with a clear issue, and nothing is invented to fill the gap. Chunks can finish in any order, but the map fills in order. If chunk 2 is still waiting, 3 and 4 wait with it, and the officer can see why."

**Show:** This is the key graphic. Five slots, then a pointer that advances:

```
0 ✓  1 ✓  2 …AI  3 ✓  4 ✓
▲ published up to here
```

Slot 2 turns green (or amber for "set aside with issue"), and the pointer jumps to 4. SSE is a thin "notification" line to Studio. The data arrives over a thicker HTTP line.

### F · It learns while it works (1:05–1:15)

**Say:** "In the background, a learner trains on examples that have been checked independently. A new model first runs in shadow. It takes over only after it proves itself on held-out data, and it can always say 'not sure' and hand back to AI. The more a district uploads, the less AI it needs."

**Show:** A second loop beside the queue: checked examples feed a model. The model gets a "shadow" badge, then a "promoted" badge. An AI-calls counter goes down.

**Close the segment with:** "And the officer? They see drafts, findings and evidence arriving while the upload is still running. Let's see it."

## Say / don't say

| Say | Don't say |
| --- | --- |
| "Designed for sources of 1–7 GB" | "Handles 7 GB files" (not qualified yet) |
| "AI proposes; code converts and checks" | "AI converts the data" / "AI fills in missing details" |
| "Learns from checked examples; promoted only after evaluation" | "Trains on every chunk and gets smarter automatically" |
| "Missing facts stay marked unknown" | Anything suggesting the system guesses owners, IDs or coordinates |
| "Shown on the map when it passes its checks" | "Official" or "verified" for a draft |
| "Map overlap is a finding for review" | "Encroachment detected" |

## What's running vs being built

Use a small corner tag on each graphic, and the *implemented / in development* slide at the end.

| Stage | In the video | Status |
| --- | --- | --- |
| Upload, original kept with hash | Live (Lake View, NYC) | Running in the backend (private originals); the 71 MiB upload-and-restart check passed, 1–7 GB is not yet qualified |
| Streaming in order | Live (NYC 2,363 features) | Streaming GeoJSON chunks with ordered reads and quarantine exist in the backend. The video's NYC stream runs through the local upload server |
| Proposed field mapping | Live (Add files → mapping) | Exact recipes are running. The AI proposal contract exists, but proposals need approval and their accuracy is not yet qualified |
| Validation and findings | Live (deviation, overlap) | Running for the building shown |
| ML takes over from AI | Graphic only | A field-mapping model has been trained offline but not promoted. **Label: in development** |
| Documents, rasters, point clouds split by meaning | Graphic only | Target design. **Label: in development** |

Also say once, in the narration or on the closing slide: the Lake View records and the NYC floors and residents are sample registry data served through the API; the NYC footprints and heights are official city open data.
