# AI-06C — source-only V8 candidate

30 September 2026. **Four new training profiles from two official families; one additional supported footprint-key family.** All 16 V7 source objects, labels and splits and all 88 prior input hashes are unchanged. No model inference, fitting, threshold selection, held-out scoring or promotion occurred. This source/label candidate awaits independent review.

Base: `305a349454b9f307c1d3f4c617ee3d81a450954e`; branch `task/desktop-ai06c-v8-corpus` in `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`. The clean Qwen branch remains at `cb2bafd`; its comparison was not repeated or edited. Primary staging was read-only. Owned changes are the corpus, existing preparation/loader support, focused source checks and this handoff. Source catalogue, learning narrative and root plans remain lead-owned.

## Eligibility and bounded labels

Reused the accepted [SOURCE-KEY-01 pack](footprint-key-sources-handoff.md). Its eleven responses were copied byte-identically from `E:/BhuAayam-data/task-data/desktop-source-key-01/`; no discovery, download or source edit occurred. Issuing URLs, acquisition times, native bytes, hashes, source versions, geography and reference limitations remain in the corpus and private receipt.

- **Kadaster/PDOK BAG Pand:** eligible for bounded offline schema research under the issuer's Public Domain Mark 1.0 designation. This is a status mark, not a separate licence grant. Preserve Kadaster/PDOK attribution and the 29 September service snapshot. Production eligibility remains false.
- **IGN BD TOPO Bâtiment:** eligible for bounded offline schema research. Issuer dataset metadata designates `lov2`; retained Licence Ouverte 2.0 terms permit extraction, transformation and derived information with source/update-date attribution and no endorsement. Attribution records IGN, the dataset URL, metadata update of 25 September 2026 and the live WFS snapshot of 29 September. Production eligibility remains false.

| Source field | Candidate decision | Issuer evidence |
| --- | --- | --- |
| BAG `geometry` | `building.geometry` | Native JSON Schema `/title`, `/description`, `/properties/geometry`: `Pand`, primary geometry, `geometry-polygon`; five native Polygons |
| BAG `properties.identificatie` | **Unknown; excluded from scoring** | Catalogue defines a unique object designation, but retained stability wording in JSON Schema `/properties/id/description` concerns the separate service UUID |
| IGN `properties.cleabs` | `building.sourceKey` | WFS XSD `batimentType/cleabs`; guide pages 13/20: required unique 24-character absolute key with documented lifecycle limits |
| IGN `geometry` | `building.geometry` | WFS XSD `geometrie: gml:MultiSurfacePropertyType`; guide pages 65/66 describe building MultiPolygon geometry and contour origins |
| IGN `properties.origine_du_batiment` | Negative for the three fixed targets | Guide page 65 defines it as the origin of building/reservoir geometry; it is a source classification |

**BAG is not counted as a new positive key family.** Its five native 16-character identifiers preserve leading zeros and are distinct, but neither that sample nor the retained unique-object definition establishes native identifier lifecycle stability. The explicit service-UUID statement cannot be transferred to `identificatie`. No extra acquisition was authorized; that exact evidence gap stays open.

IGN `cleabs` remains distinct from the WFS service ID and RNB references. The guide preserves the key for attribute/geometry edits, with exceptions for delete/recreate, split and merge; those limits and the source revision remain explicit. All five sampled geometry origins are `Cadastre`. The guide distinguishes wall/ground contours from aerial roof outlines. Native Z coordinates are preserved; vertical datum, surveyed height, legal identity, floors and units remain unqualified.

The new sources have **36 unlabelled properties** (BAG 10, IGN 26), recorded as exclusions rather than negative examples. This means they were not qualified for these three targets in this bounded curation; it does not assert that every property lacks known semantics. IGN `identifiants_sources` has two present null values and three strings, with no absent keys. No building-name positive was invented.

## Source-only inputs and preservation

The loader adds narrow retained OGC JSON Schema and WFS XSD locators. It reads native publisher titles, field names, optional descriptions and types; XML imports are never fetched, and DOCTYPE/entity declarations are rejected. These four schema entries have no descriptions, so profiles retain `none recorded`. Guide/catalogue prose and reviewer label explanations stay outside model inputs. No English translation, raw identifier value, coordinate list or service-ID substitution enters a profile.

| Split | Families | Fields | Positive fields |
| --- | ---: | ---: | ---: |
| Training | 10 | 44 | 14 |
| Calibration, unchanged | 4 | 25 | 7 |
| Evaluation, unchanged | 2 | 11 | 4 |
| Diagnostic, unchanged | 2 | 12 | 5 |

Total: 18 families / 92 fields. The four additions are three positives and one negative; training now has three positive key families. Prior source objects and all 88 publisher-profile hashes replay exactly. Halifax/Kitchener and DC/SF predictions remain closed. Five rows support one schema profile per field; rows were not multiplied into extra training examples.

## Checks and correction

- Source-only preparation exited 0. Full Python/argv/cwd/timestamps/stdout/stderr are in the final candidate's `prepare-command.json`. It verifies the immutable V7 corpus/proof and accepted acquisition receipt, copies unchanged sources, replays the exact prefix and writes exclusive corpus/proof/coverage files.
- **Three focused V8 checks passed**, exit 0: V7 prefix/proof/split preservation, reviewer-prose/raw-ID isolation and unknown-state preservation, plus invalid schema locator/numeric-key-label rejection. Actual command is in `checks/pytest-result.json`: retained learner Python 3.11.15 / pytest 8.3.3, `pytest --noconftest services/geo/tests/test_usp_learning_footprint_sources.py -q -p no:cacheprovider`, with the explicit candidate/originals environment and private `--basetemp`.
- The two existing V7 source checks passed in the preceding run and were reused. Initial normal collection failed because the shared production conftest imports optional Pillow, absent from the learner environment; the source checks require none of its fixtures. No package was installed. One intermediate result logger failed on an absent output directory; its unrecorded child outcome is not claimed.
- One new check caught an incorrect all-five-null exclusion note for IGN source references. Native `observedWire` counts were already correct. The note/check now reflect two nulls/three strings. The initial freeze is preserved and marked superseded in `completion-v8/candidate-status.json`; the corrected immutable candidate is in **`completion-v8/revision-02/`**. All 92 selected input hashes and selected labels are unchanged between attempts.
- Final Python syntax compilation and whitespace checks passed. Four changed Python files are snapshotted with raw SHA256 and normalized Git blob IDs. The retained IGN guide's pages 13/20 and newly rendered pages 65/66 were visually inspected; exact native page text is preserved separately from profiles.

No service, Docker, GPU, provider or background worker was started; all one-shot commands returned. The initial request was Astra/max/default, updated by the lead to Astra/high/default during this task. Supplied permissions are `never` / `danger-full-access`; actual current model/effort/tier were not independently returned. Prior receipts were preserved.

## Immutable handoff

**Current candidate:** `E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/completion-v8/revision-02/`. Its completion receipt pins 24 artifacts, eleven original response copies, four code snapshots, eligibility/locator decisions, commands, final checks and the prior failed-check evidence. The repository corpus is JSON-equivalent to this immutable candidate; Git line-ending conversion does not redefine private byte hashes.

| Artifact | SHA256 |
| --- | --- |
| `completion-receipt.json` | `29a19735da89d2974f676b5d3759c902278ac9ad73d8602fb5ba4a84185c1584` |
| `learning-corpus-v8-immutable.json` | `ff9c80d3e1c31dec126d7f534a88c45b37ed0d589b35792ad67d4b2ed850efee` |
| `input-proof-v8.json` | `d2ff07556ded56d8eaf7b0744f6cf2a8dd8c15f076f8df81f3136254a425fa9a` |
| `coverage-freeze-v8.json` | `ea1c7f541f4432bf6578eb2f8af7977356a09a35ad94d255a322ad64b7ddf5b8` |
| `eligibility-review.json` | `7425bee47f8e148cc558a74c1f3394498629ef98dfd0fe720e85c41de6103fc1` |

The unchanged source-pack acquisition receipt is `d908a440ff793e544bf4be6b645a3ce974d67faffba3763f2e854528c2f73785`. V7 remains untouched: corpus `81773eaf350d96778bc59c8f0f61a0d66e66cf335edb1ec167dd2ce1efd718c7`, proof `b801b049abdea3f8c88bab8f5c72ef2916acf026ad5168fe45518e5c73259559`. This is foreign source preparation, with no model-quality, Indian operational, association, whole-record conversion, source-accuracy, runtime or release qualification.
