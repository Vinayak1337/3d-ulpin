# LR1: a large map file's layout means what a small file's layout means

Branch `task/lr1-large-layout`, cut from `task/lp3b-large-file-automatic` at `4e87e096`. Step 0 is
[step0.md](step0.md); counts and the file and line of each decision are in [result.json](result.json).

## What changed

- **D1 one meaning.** `compileStreamedMapping` (`streamed-mapping.ts:36`) no longer has its own rules: it adapts the
  streamed profile (`layoutProfile`, `:24`) and calls the small layout's `compileMapping` (`registry.ts:84`), so the
  kinds, targets, conversions, geometry-by-kind and the older building layout's degree rule are one set. The streamed
  plan takes `kind` and the `feature.*` targets by the same schema and the same target rule (`layoutTargetsIssue`,
  `contracts/usp/ingestion.ts:38`). Refusals keep the small layout's words and keep the `STREAMED_MAPPING_*` codes the
  large card already explains (`streamed-mapping.ts:19`). The returned `Mapping` is the one a proved part hands to the
  normaliser (`proved-area-part.ts:89`), so the kind reaches the registry as a small file's does.
- **D2 whole-number key.** The profile counts whole numbers per path (`streamed-profile-inventory.ts:43`); the
  layout accepts `literal_integer_identifier@1` only when every accepted value is one. The mapped worker copies the
  number as its digits and reserves it across chunks as before (`chunk-mapping-normalizer.ts:22-37`). Because a parsed
  number cannot tell `12` from `12.0`, a part also reads the key's token in the raw bytes and refuses a token that is
  not plain digits (`proved-area-part.ts:60`).
- **D3 declared system.** The geo service exposes CR1's `_geojson_crs` alone (`area.py:99`, route
  `resolve-geojson-crs`); the raw reader asks it once at the end of the file (`streaming-vector-worker.ts:217`,
  `streamed-map-receipt.ts:35`). A refusal stops the file with CR1's words under `STREAMING_SOURCE_CRS`. An accepted
  projected declaration is stored as written (`sourceCrs`), with its code (`authority`) and unit; a file that declares
  nothing, or CRS84, keeps its receipt byte for byte. The sealed profile carries the receipt's code and unit
  (`streamed-profile-worker.ts:38`). Raw parts are unchanged; each part's collection already carries the `crs` member
  to `normalize_area`, which transforms it with CR1's code (geo test
  `test_a_proved_part_collection_is_read_in_its_declared_system`). No transform or projection code was added in
  TypeScript.
- **D4.** Lines and points reach the same normaliser, so road and utility layouts are accepted for large files with
  those geometries; a kind whose geometry the file lacks is refused with the small layout's words.

## Findings for the lead

- **F1** `chunk-mapping-normalizer.ts` (not in the owned list) had to change: it read string keys and `building.*`
  names only. Smallest change; reservation unchanged. Also `registry.ts` (types of `compileMapping` only),
  `retained-map-original.ts:18` (a receipt counts unless its unit is unknown), `areas.ts:92` (the new geo operation's
  name) and `streamed-profile-inventory.ts` (the count) are outside the list.
- **F2** `intake-large.ts:34,52-56,73-75` (read-only) still tells the officer "Large files are read in longitude and
  latitude only for now" for `STREAMING_SOURCE_CRS`, "approved polygon layout" for `STREAMED_MAPPING_GEOMETRY` and
  "not complete text" for `STREAMED_MAPPING_COVERAGE`. After LR1 the first fires only for a declaration CR1 refuses;
  the sentences should name the declaration and CR1's reason, any geometry, and a whole number.
  `PART_INTEGER_IDENTIFIER` has no sentence there.
- **F3** the streamed plan schema lives in `contracts/usp/streamed-profile.ts`, not `ingestion.ts`; edited there.
- **F4 (stop rule b)** `registry.test.ts:126` asserts that the streamed plan's operations refuse `feature.*`
  targets: the restriction D1 removes. Not edited; it now fails. The one-line flip is
  `assert(StreamedPrefixMappingPlanSchema.shape.operations.safeParse(plan.operations).success);`. No small-file
  behaviour changed: every other small-file test passes as before.
- **F5** the whole-number token check happens at the part, not at the layout: the profile sees parsed values only. A
  file whose key is written `12.0` passes the layout and then stops at its first part with the words above.
- Not walked: no database, Docker or real 1 GB file here; Niagara Falls EPSG:2958 parcels were not run end to end.
