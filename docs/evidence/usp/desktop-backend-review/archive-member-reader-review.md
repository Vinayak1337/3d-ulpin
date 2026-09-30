# BUNDLE-02A independent selected-member review

30 September 2026. Candidate `2b995d2ec531dfa61dcc8b59762145b8e142357f`, compared with `f71884ee3d97456360570bc70655d48a82de9868`. Primary `3a13c62bc18eeb9561776b0f44e41aeb8350ee81` and its current instructions/plans were read only. Reviewed the four new files and the existing inventory helper. Supplied permissions are `never` / `danger-full-access`; GPT-6.1 Sol/high was requested, actual per-turn model/effort/tier are not exposed.

## Original verdict: one P2 correction required — closed by lead below

**Lead closure, 30 September:** the completed review was integrated as `2d5dcd9`. The lead corrected only the new member reader: every companion sharing the selected case-insensitive full stem must be unique and pass issue/CRC/hash/size eligibility. An unrelated invalid group remains an unselected issue. The new regression failed on the original candidate for duplicate DBF and ineligible CPG cases, then all four member-reader tests passed after correction (exit 0); `py_compile` and `git diff --check` also passed. The affected real District SHX replay preserved the original hash and exactly matched the independent `ZipInfo` read plus previous output/lineage. Private correction receipt `E:/BhuAayam-data/task-data/desktop-archive-member-reader/lead-companion-correction-20260930.json`, SHA-256 `1b244cbdf1ec803c7836353024ca56130f18fe331f5a135ba396802c4ec2ac17`, pins the checked code and source. This closes the reported P2 by lead verification; it is not a second independent review. Prior NYC byte/script evidence is reused without another campaign. Acceptance remains local member-byte extraction, not API admission or GIS interpretation.

**[P2] Reject ambiguous companions in the selected shapefile group.** `services/geo/geo/native_archive_member.py:66` accepts a shapefile member when its inventory companion state is `complete`; `:85` checks duplicate paths only for the selected member. The existing inventory (`native_archive.py:132`) marks a group complete whenever one issue-free occurrence of each required suffix exists, even if a required companion has another duplicate occurrence. Consequently a unique `.shx` is returned from a group with two `.dbf` entries, while lineage simultaneously reports the group as complete and the duplicate as an unselected issue. This violates the selected-group companion eligibility requirement and leaves a downstream reader unable to choose an unambiguous attribute companion. Reject duplicate or otherwise ineligible companions in the selected stem's group; retain unrelated archive issues without denying an independent valid selection. The correction belongs in the newly owned member reader, without changing the accepted inventory contract.

Focused in-memory reproduction (no operational data or disk archive):

```python
import io, zipfile
from geo.native_archive import inventory_archive
from geo.native_archive_member import read_archive_member
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for name, value in [('district.shp', b'shp'), ('district.shx', b'shx'),
                        ('district.dbf', b'first'), ('district.prj', b'prj'),
                        ('district.dbf', b'second')]:
        z.writestr(name, value)
raw = buf.getvalue()
inv = inventory_archive(raw)
member = inv['members'][1]
result = read_archive_member(raw, inv['sourceSha256'], 1,
                             member['sha256'], member['actualBytes'])
```

Actual: returns `b'shx'`, `companion='complete'`, `inventoryCoverage='incomplete'`, and `unselectedIssues=[{'ordinal':4,'issue':'DUPLICATE_PATH','companion':'complete'}]`. Expected: explicit companion rejection before returning bytes. Reproduction exited 0; Python's duplicate-name warning confirmed the duplicate was encoded. The three existing tests all pass, but cover a duplicate selected path rather than a duplicate required sibling.

## Accepted findings at byte/lineage scope

The immutable outer hash, current inventory, ordinal, expected member SHA/size and CRC are checked against the same input bytes. Selection uses the ordinal's `ZipInfo`, not a name lookup. First and later duplicates of the selected path are rejected. Unsafe paths, special/directory/encrypted/corrupt selections, nested archives, scripts and unsupported routes are denied through the inventory and route checks. Selected bytes are reread with bounded chunks, size/SHA checks and ZIP CRC validation. Limits remain 10 MiB outer input, 256 entries, 30 MiB declared expansion, 8 MiB selected output and the inventory's 1000:1 ratio; the shared 15-second deadline is cooperative, checked around inventory and each selected read, rather than an OS process-kill guarantee.

The CLI reads the original, then creates a fresh output directory and exclusively writes only `member.bin` and `lineage.json` (lineage at most 128 KiB). There is no extraction path derived from the member name, execution, source write, recursion, API wiring or new dependency. A failed second output write may leave the first artifact in that fresh directory; exit 2 still reports failure, and no successful publication contract is claimed here.

## Retained source evidence and checks

Consulted `docs/api/real-sources.md`, `docs/api/datasets.json`, the Karnataka D3 manifest and the private NYC manifest. Karnataka is official district context with unresolved exact-file launch terms. NYC is an existing local assembly with per-member provenance, not an issuer-original ZIP. These distinctions remain intact.

Reused the saved independent byte-equality and actual script-denial observations in `E:/BhuAayam-data/task-data/desktop-archive-member-reader/verification-20260930-resume.json`; its SHA-256 independently matched `08f6e8a063f6bd21dfb7f2dba4d30503a487d66a3bbf81e7d4c475e6956bbf7d`. Current saved outputs rehashed to District member `d7613a1ec2f13f42139cbb62159667105a1374185572a28a76f98fff75cd9be2` / lineage `a2d00a88876e8e91749d47a898b34f8b0a6dea788e7fbaac6a4a06f56bbb0974`, and NYC member `107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e` / lineage `f4303e0fe06463c8aecbefb5acdc22206eab96552f2711957f87466ec6fa9919`. The NYC member pin also matches its private manifest. The saved receipt records script ordinal 2 denied with exit 2 and no output directory; this review did not repeat that accepted source run.

`PYTHONPATH=services/geo C:/Python313/python.exe -m unittest services.geo.tests.test_native_archive_member -v` passed 3/3, exit 0. The one targeted reproduction above exited 0 with the observed acceptance defect. Receipt/code/output SHA checks and `git diff --check f71884e 2b995d2` exited 0; the four executable/test source hashes match the receipt after CRLF-to-LF normalization. No broad input matrix, source download, service, model run or production edit occurred. This review qualifies only the observed member bytes and lineage; GIS interpretation/admission, canonical records, association, learning and release gates remain separate.
