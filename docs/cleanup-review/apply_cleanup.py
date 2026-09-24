#!/usr/bin/env python3
"""Apply the approved, bounded 2026-09-23 cleanup on its review branch only.

Not the complete candidate list: runtime/CI/dataset-dependent retirements remain
deferred. Requires exact reviewed objects, a clean checkout, and --apply.
Never changes main, rewrites history, installs data, or touches a database.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import subprocess
from urllib.parse import quote, unquote, urlsplit

BASE = 'f623cff897f91bb3ebd4c225f700ac263f7beb72'
REVIEW = 'a2fb23fb53a92032fb7223a28f633d15dc865697'
HANDOFF = 'e167b1f6c1a830b2b5c6c1708e8f0b0214e4d849'
BRANCH = 'review/data-transition-cleanup-20260923'
PREFIX = 'docs/cleanup-review/'
RECEIPT = PREFIX + 'applied-cleanup.json'
BASE_URL = f'https://github.com/Vinayak1337/3d-ulpin/blob/{BASE}/'
TREE_URL = f'https://github.com/Vinayak1337/3d-ulpin/tree/{BASE}/'
# Existing api-regression.ts still writes these conventional output paths.
RETAIN_REPORTS = {'docs/API_TEST_EVIDENCE.md', 'docs/API_CLOSED_RING_EVIDENCE.md',
                  'docs/API_STALE_RESULT_EVIDENCE.md'}
APPROVED_RULES = {'D01', 'D02', 'D03', 'D04', 'A01', 'A02', 'A03', 'A04'}
EXCLUDED_DUPLICATE_KEEPER = 'docs/3D_ULPIN_UI_Demo_Guide.docx'


def git(*args: str) -> bytes:
    return subprocess.check_output(['git', *args])


def tree(ref: str) -> dict[str, dict]:
    result = {}
    for entry in git('ls-tree', '-rlz', ref).split(b'\0'):
        if not entry:
            continue
        meta, path = entry.split(b'\t', 1)
        mode, kind, sha, size = meta.decode().split()
        if kind != 'blob':
            raise RuntimeError(f'Unsupported tracked entry: {path!r}')
        result[path.decode()] = {'blob': sha, 'bytes': int(size), 'mode': mode}
    return result


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def write(path: str, text: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.rstrip() + '\n', encoding='utf-8')


def classify(path: str, rules: list[dict]) -> str:
    for rule in rules:
        if path in rule.get('paths', []) or any(path.startswith(x) for x in rule.get('prefixes', [])):
            return rule['id']
        if rule['id'] == 'K99':
            return rule['id']
    raise RuntimeError(f'Unclassified: {path}')


def choose(baseline: dict, spec: dict) -> dict[str, str]:
    selected = {}
    for path in baseline:
        rule = classify(path, spec['ordered_rules'])
        allowed = rule in APPROVED_RULES or (rule == 'A05' and path.endswith('.md')
                    and not path.startswith('docs/v2-design/') and path not in RETAIN_REPORTS)
        if allowed and path != EXCLUDED_DUPLICATE_KEEPER:
            selected[path] = rule
    if len(selected) != 231:
        raise RuntimeError(f'Unexpected cleanup scope: {len(selected)} paths, expected 231')
    return selected


README = '''# 3D ULPIN — evidence-linked 3D property workbench

**Start implementation with [the adopted handoffs](docs/usp-agent-handoffs/00-README.md).**
The direction is a visually strong, persisted Studio: select a building, inspect its
supplied floors and units, open the matching evidence, resolve uncertainty, and
produce a genuinely property-scoped compilation. Adaptive bulk ingestion extends
that working journey rather than delaying it.

## Current direction versus existing software

The handoffs were imported unchanged from `docs/usp-agent-handoffs@e167b1f` for
local discovery on this cleanup branch. They define planned implementation and
acceptance, not completed new features. The application baseline inspected by
those plans is `f623cff`. Check current code and actual test receipts before
claiming a capability works. This cleanup does not import new datasets, run
migrations, enable public services, or implement F0/V0/I1.

| Need | Read |
| --- | --- |
| Build order, agent ownership and D0–D7 acquisition/test runbooks | [00 — Start here](docs/usp-agent-handoffs/00-README.md) |
| Shared identities, snapshots, jobs, access and transactions | [01 — Shared contracts](docs/usp-agent-handoffs/01-shared-contracts-and-ownership.md) |
| Feature implementation | Assigned file 10–19, including its data/tests in J and assignment in K |
| Active 3D UI, quick/full register and visual acceptance | [99 — UI and integration](docs/usp-agent-handoffs/99-ui-ux-and-integration.md) |
| Current application operation | [Studio guide](docs/STUDIO_DEMO_GUIDE.md), [startup](docs/OFFICER_STARTUP.md), [platform](docs/PLATFORM.md) |
| Cleanup, retained dependencies and historical recovery | [Cleanup record](docs/cleanup-review/README.md) |

Studio remains the officer interface with **Batches / Map / Register**. Improve
the actual route and shared map, not a disconnected showcase. Preserve legacy URL
resolution, canonical identities, evidence and existing processing capabilities.
The application remains local/single-operator until the separate F2 and deployment
gates pass. A technical record or system identifier is not official ULPIN issuance,
legal title, an enforcement decision or excavation clearance.

## Data: preserve the existing packs; acquire new ones explicitly

| Pack | Role and availability boundary |
| --- | --- |
| D0 | New bounded authored workflow fixture derived from existing reference material; not a real survey and not created by this cleanup |
| D1 | Small real 3DBAG roof-model sample; preserve original shapes, IDs and missing interiors; acquisition/rendering require evidence |
| D2 | Optional Helsinki textured context, geographically separate |
| D3 | Existing Delhi/Uttam Nagar Google/OSM inputs; estimates/scenarios remain distinct from observed outlines and recorded boundaries |
| D4 | DDA document rows for extraction/scoped reporting; no automatic geometry or ownership |
| D5 | Matched permitted Indian building plan, section and evidence; availability must be confirmed |
| D6 | Separate modality-specific ML evaluation data; not a prerequisite to the first useful UI |
| D7 | Approved same-area cadastral/road/utility and rights evidence; missing access gates only the corresponding real-world claim |

Exact sources, caps, fallbacks and expected tests are in handoff 00 and each
feature's J section. **A source catalogue is not an acquired dataset.** Do not
replace original data with attractive invented heights, units or road widths.
Do not create a second mutable property database for a new format.

Existing inputs remain available: [fixture guide](fixtures/README.md),
[upload packages](data-source/README.md), [repository snapshot](repo-data/README.md),
[Uttam Nagar provenance](docs/GOOGLE_UTTAM_NAGAR.md) and
[additive transfer instructions](docs/UTTAM_NAGAR_SETUP.md).
The canonical source tree, ZIP entry points and manifest-bound scene assets are
retained. Duplicate unpacked convenience copies are not separate datasets.

## Run the existing local application

Use an already configured environment and the [startup guide](docs/OFFICER_STARTUP.md).
With locked dependencies installed, the existing developer commands are:

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm dev
```

These commands act on the configured services; choose an isolated environment for
tests. The launcher `pnpm demo` and `Start Demo.command` remain available for their
documented setups. Do not build over another agent's running worktree.

Open **http://127.0.0.1:3000/studio/work**. Use **Add files → Review details →
Check & record**, or open saved datasets. Map quick inspection and the full register
must preserve the same selected property and evidence context.

`REPO_DATA=true` selects the separate repository snapshot services; false preserves
the linked environment. Follow [repo-data/README.md](repo-data/README.md) rather
than changing credentials or resetting volumes. Do not run `repo:init`, reseeding,
snapshot export or restore over populated data. `pnpm data:uttam:install` is a
separate additive operation, not an instruction to refresh the base snapshot.

## Verify according to the work performed

```sh
pnpm typecheck
pnpm test:studio
pnpm test:register-scope
pnpm test:uttam
```

Registry/API/export/browser tests require their documented isolated services and
fixtures; see handoff 00 and the assigned feature. Pure tests, application integration,
real-source accuracy, visual quality and deployment qualification are distinct.
Do not report a historical screenshot or a successful inventory as a new runtime pass.

The retained [architecture](docs/ARCHITECTURE.md),
[API contract](docs/IMPLEMENTATION_CONTRACT.md), [registry](docs/REGISTRY.md),
[local spatial extraction](docs/local-spatial-extraction.md), and
[hosting assessment](docs/HOSTING.md) describe baseline mechanisms. New Sarvam,
public contribution and MCP work follows handoffs 13/18/19 and is not assumed live.

## Historical material

Superseded orchestration packs, old walkthroughs and duplicated public galleries
are referenced through the [pinned historical index](docs/cleanup-review/README.md#historical-recovery).
The remaining engineering-plan data/tools and design donors are retained where
CI, generators or visual references still use them. They do not override current
handoff sequencing. Cleanup never rewrites Git history or deletes local database volumes.
'''

AGENTS = '''# 3D ULPIN — current agent entry point

## Adopted direction and what to read

Effective 23 September 2026, follow `docs/usp-agent-handoffs/00-README.md`,
`01-shared-contracts-and-ownership.md`, the assigned feature's complete A–K
sections, relevant `99-ui-ux-and-integration.md`, and current code. The handoffs
are copied without semantic changes from `e167b1f`; new paths/types in them are
implementation requirements, not existing capabilities. Read `apps/web/AGENTS.md`
and the installed framework documentation before applicable web changes.

Deliver the active **Studio** product: one shared map/data/selection boundary,
Batches / Map / Register, contextual quick register and full register. First prove
F0 → F1-min → V0: supplied building/floor/unit → exact evidence → scoped PACK0
artifact → reopen saved state; separately qualify D1 real roof geometry. Follow
I1 and feature/F2 gates afterwards. Do not make local V0 wait for public identity,
all ML modalities, live Sarvam, remote MCP or an authentic complete cadastral set.
Do not substitute a beautiful isolated showcase or mock APIs for integration.

Old T-number plans, the engineering backlog, dated screenshots and prototype
readmes are historical/test/reference material, not the current execution order.
`docs/engineering-plan/tools` and its required records remain CI inputs. Do not
reset their history or delete tests to make a new task appear complete. The old
orchestration pack is preserved in pinned Git history through the cleanup index.

## Preserve data, identities and existing mechanisms

Keep Next.js/TypeScript, the existing shared Three/Cesium runtime boundaries,
PostgreSQL/PostGIS, private S3-compatible originals, Redis/Celery, dispatcher and
private Python processing. Extend the recorded registry and case/import draft
services, not another property database, map or job broker. Keep compatible legacy
URLs and unique document/GIS/raster/point-cloud/ML inspection capabilities.

Preserve original bytes/hashes, source and geometry revisions, exact locators,
reference systems, quantity definitions, attribution, identities and review
history. Official supplied parcel ULPIN is distinct from system building/floor/space
IDs. A floor is not necessarily a unit; one building can span parcels and one unit
can span floors. Never fabricate ownership, official issuance, heights, floors,
control points or positive-volume conflicts. Display-only decorations/exploded
floors are not measurement/evidence authority. Unknown/withheld/conflicting is
not zero. Keep observed, planned, estimated and synthetic information explicit.

Use the DATA role's named D0–D7 runbooks. Check actual bytes before claiming a
local path or external archive exists. Preserve D0 donors and D3 Google/OSM packs.
Acquire small permitted samples, retain hashes, test independent expected outputs,
and use the stated fallback when access fails. Do not send private records to an
external model. Live provider/account/real-source qualification stays separate.

`REPO_DATA=true` selects isolated repository services; false preserves the linked
environment. Never reset populated volumes, run implicit `repo:init`/reseeding,
export a replacement committed snapshot or overwrite `.env`/credentials. Dataset
cleanup permits only the exact verified redundant copies recorded in
`docs/cleanup-review/applied-cleanup.json`, not a general data purge. Canonical
originals, upload ZIPs and manifest-bound scene assets remain protected.

## Ownership and execution

Use an isolated branch/worktree and record its base SHA. FND owns shared backend,
contracts, migrations, configuration, dependencies and API/worker wiring. UI owns
shared frontend parents, route state, caches and map/runtime integration. DATA owns
fixture/acquisition directories and independent expected cases. Feature agents
own their bounded leaves/tests; transfer ownership explicitly. Submit a narrow
patch with reproducer to a shared owner rather than writing a competing service.

Start with at most two implementation owners plus DATA; after V0 keep at most
three unfinished integration-dependent workstreams. FND may explicitly hold PACK0
initially. No recursive agent spawning, force push, unrelated reformatting,
implicit main merge, public activation, credit purchase or secret commits.

Keep local/single-operator restrictions until F2 and DEPLOY qualify every relevant
API, asset, SSR and public path. Do not globally remove local guards. Sarvam is
planned governed processing; integrity, confidentiality and residency need separate
evidence. Manual mapping and deterministic answers remain valid fallbacks.

## Verification and cleanup discipline

Read the task's named tests and data before editing. Use locked dependencies,
`scripts/engineering/isolation.mjs`, existing runners and the build-server guard.
Never build against another agent's live worktree. Report actual commands, exit
status, code/data hashes, saved receipts, exact expected/actual results and relevant
fresh browser captures. Separate contract, local integration, real-source, visual
and deployment results. A file named final/current or a test-plan document is not
proof. Do not print secrets or binary contents; bound command output.

This branch's cleanup removes only approved redundancies and retired reference
material after checks. Remaining runtime/CI-dependent candidates in the review
are **not** an executable deletion list. Keep donors, unique visual inputs,
working originals and regression coverage until a tested replacement exists.
'''

CURRENT = '''# Current work — adopted USP handoffs

**Updated 23 September 2026.** The former T-number execution narrative is retained
as historical evidence, not the current task queue. Begin with
[handoff 00](../usp-agent-handoffs/00-README.md),
[shared contracts](../usp-agent-handoffs/01-shared-contracts-and-ownership.md) and
[active Studio UI](../usp-agent-handoffs/99-ui-ux-and-integration.md).

The next implementation gate is F0, followed by F1-min and V0 using D0 and a
separate D1 real-roof sample. No F0/V0/I1 implementation pass is claimed by the
cleanup. D0–D7 acquisition and feature-specific tests are in those handoffs.
Do not seed or empty the existing product to prepare a new dataset.

Existing evidence worth consulting when its exact feature is relevant:

| Historical result | Scope |
| --- | --- |
| [T093](tasks/T093_RESULT.md) | Floor-registry implementation evidence at its recorded revision |
| [T092](tasks/T092_RESULT.md) | LiDAR/imagery/elevation display evidence, not universal reconstruction |
| [T091](tasks/T091_RESULT.md) | Responsive map/control observations from that run |
| [T083](tasks/T083_RESULT.md) | Saved-dataset persistence evidence |
| [T079](tasks/T079_RESULT.md) | Complete authored source-package showcase and stated limitations |

Recheck current code/tests rather than inheriting their pass status. Existing
backlog/acceptance/tools stay for CI traceability, not as a competing roadmap.
The [full earlier current-work record](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/engineering-plan/CURRENT_WORK.md)
remains available without duplicating it into new instructions.
'''

ENGINEERING_START = '''# Historical engineering plans and verification inputs

**Current implementation starts at [USP handoff 00](../usp-agent-handoffs/00-README.md).**
Use [01](../usp-agent-handoffs/01-shared-contracts-and-ownership.md) for shared
contracts, the assigned feature A–K file, and
[99](../usp-agent-handoffs/99-ui-ux-and-integration.md) for the actual Studio UI.
Do not resume an old task merely because it is marked next in this folder.

This retained tree contains dated T-number plans/results and machine-readable
acceptance history. Its tools, reference catalogue, legacy source copies,
backlog and crosswalks are still consumed by CI. They preserve earlier coverage;
they do not override F0 → F1-min → V0 or D0–D7 in the adopted handoffs.

Do not delete this tree recursively or reset accepted statuses. Migrate each
consumer and preserve source hashes before retiring its input. The fixed
baseline material is historical, not proof that new features or datasets pass.
[CURRENT_WORK.md](CURRENT_WORK.md) routes to the current assignment and selected
historical results. [The previous entry point](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/engineering-plan/00_START_HERE.md)
is retained in Git history.

Existing validation, from this directory:

```sh
python tools/validate_plan.py
python -m unittest discover -s tools/tests -p 'test_*.py'
```

These check historical planning/collector consistency only, not application,
dataset or browser acceptance. Do not use `--planning-snapshot` to erase later
results, or regenerate/backdate manifests as fabricated new evidence.
'''


def banner(path: str, note: str) -> None:
    p = Path(path)
    if not p.is_file():
        raise RuntimeError(f'Missing documentation: {path}')
    text = p.read_text(encoding='utf-8')
    first, sep, rest = text.partition('\n')
    relative = posixpath.relpath('docs/usp-agent-handoffs/00-README.md', str(p.parent))
    box = f'> **Direction note — 23 September 2026:** {note} Current implementation and data/testing assignments are in [USP handoff 00]({relative}) and the assigned feature file.\n'
    write(path, first + '\n\n' + box + '\n' + rest.lstrip('\n'))


def mutable_markdown(path: str) -> bool:
    if path in {'README.md', 'AGENTS.md', 'data-source/README.md', 'fixtures/README.md'}:
        return True
    if path.startswith(('docs/usp-agent-handoffs/', 'docs/engineering-plan/legacy/',
                        'docs/evidence/', 'docs/engineering-plan/evidence/',
                        'design/reference-map-v5/data/', 'design/reference-map-v5/dataset/')):
        return False
    return path.endswith('.md') and path.startswith(('docs/', 'design/', 'deploy/', 'infra/'))


LINK = re.compile(r'(!?\[[^\]\n]*\]\()([^\s)]+)(\))')
REF_LINK = re.compile(r'^(\s*\[[^\]\n]+\]:\s*)([^\s]+)', re.M)


def local_target(path: str, url: str) -> str | None:
    parts = urlsplit(url)
    if parts.scheme or parts.netloc or url.startswith(('#', '/')):
        return None
    return posixpath.normpath(posixpath.join(posixpath.dirname(path), unquote(parts.path)))


def rewrite_historical_links(path: str, text: str, deleted: dict, dirs: set) -> str:
    def url_for(url: str) -> str:
        target = local_target(path, url)
        parts = urlsplit(url)
        if target in deleted:
            return BASE_URL + quote(target, safe='/') + ('#'+parts.fragment if parts.fragment else '')
        if target in dirs:
            return TREE_URL + quote(target, safe='/') + ('#'+parts.fragment if parts.fragment else '')
        for prefix in ('/studio-review/', '/reference/review/', '/reference/review-t079/'):
            if url.startswith(prefix):
                return BASE_URL + 'apps/web/public' + quote(parts.path, safe='/')
        return url
    return REF_LINK.sub(lambda m:m[1]+url_for(m[2]), LINK.sub(lambda m:m[1]+url_for(m[2])+m[3], text))


def all_links(path: str, text: str) -> set[str]:
    return {m[2] for m in LINK.finditer(text)} | {m[2] for m in REF_LINK.finditer(text)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply:
        raise SystemExit('No change made. Pass --apply only on the approved review branch.')
    root = Path(git('rev-parse','--show-toplevel').decode().strip()).resolve()
    os.chdir(root)
    branch = git('branch','--show-current').decode().strip()
    if branch != BRANCH:
        raise SystemExit(f'Refusing branch {branch!r}; only {BRANCH} is authorized.')
    if Path(RECEIPT).exists():
        raise SystemExit('Cleanup already has a receipt; re-review before another destructive run.')
    if git('status','--porcelain').strip():
        raise SystemExit('Refusing a dirty checkout.')
    git('merge-base','--is-ancestor', REVIEW, 'HEAD')
    drift = git('diff','--name-only', REVIEW, 'HEAD').decode().splitlines()
    if any(not (p.startswith(PREFIX) or p == '.github/workflows/ulpin-cleanup-apply.yml') for p in drift):
        raise RuntimeError('Unreviewed branch drift outside cleanup tooling; no deletion made.')
    baseline, handoff_tree = tree(BASE), tree(HANDOFF)
    spec = json.loads(Path(PREFIX+'decisions.json').read_text())
    if spec['baseline'] != BASE or spec['handoff_commit'] != HANDOFF:
        raise RuntimeError('Unexpected rule baseline.')
    selected = choose(baseline, spec)
    duplicates = []
    for path, rule in selected.items():
        if not Path(path).is_file() or blob_sha(Path(path).read_bytes()) != baseline[path]['blob']:
            raise RuntimeError(f'Changed/missing deletion candidate: {path}')
        keeper = (EXCLUDED_DUPLICATE_KEEPER if rule=='D01' else
                  path.removeprefix('fixtures/lake-view-complete-inputs/') if rule=='D02' else
                  'design/reference-map-v5/data/lake-view-complete/' + path.removeprefix('data-source/lake-view-files/') if rule=='D03' else None)
        if keeper:
            if keeper in selected or keeper not in baseline or baseline[keeper]['blob'] != baseline[path]['blob']:
                raise RuntimeError(f'No retained identical counterpart: {path}')
            if blob_sha(Path(keeper).read_bytes()) != baseline[path]['blob']:
                raise RuntimeError(f'Retained bytes changed: {keeper}')
            duplicates.append({'deleted':path,'retained':keeper,'blob':baseline[path]['blob']})
    if len(duplicates)!=91:
        raise RuntimeError('Expected 91 verified duplicate counterparts.')
    texts = {p:Path(p).read_text(encoding='utf-8') for p in baseline if mutable_markdown(p) and Path(p).is_file()}
    dirs = set()
    for path in selected:
        parts = Path(path).parts
        for i in range(1,len(parts)):
            d='/'.join(parts[:i])
            if all(p in selected for p in baseline if p.startswith(d+'/')):
                dirs.add(d)
    imported=[]
    for path in sorted(handoff_tree):
        if path.startswith('docs/usp-agent-handoffs/'):
            if not path.endswith('.md') or Path(path).exists():
                raise RuntimeError(f'Unexpected handoff target: {path}')
            raw=git('show', f'{HANDOFF}:{path}')
            Path(path).parent.mkdir(parents=True,exist_ok=True); Path(path).write_bytes(raw)
            imported.append({'path':path,'blob':handoff_tree[path]['blob']})
    if len(imported)!=15:
        raise RuntimeError('Expected the complete 15-file handoff tree.')
    for path in selected:
        Path(path).unlink()
    write('README.md', README)
    write('AGENTS.md', AGENTS)
    write('docs/engineering-plan/CURRENT_WORK.md', CURRENT)
    write('docs/engineering-plan/00_START_HERE.md', ENGINEERING_START)
    path='data-source/README.md';text=Path(path).read_text()
    text=text.replace('`lake-view-files/` contains the same originals unpacked for inspection; do not upload that directory as a second dataset.',
        '[The canonical unpacked originals](../design/reference-map-v5/data/lake-view-complete/) are available for inspection. The redundant `lake-view-files/` copy was removed; do not upload the originals again as a second dataset.')
    text=text.replace('The saved map is also available at http://127.0.0.1:3000/studio/showcase?saved=22b196c2-b467-4f38-9252-5b4c5e3a2f14 on this machine.',
        'Use the saved ID returned by this environment; do not copy a historical machine-specific dataset UUID.')
    write(path,text)
    banner(path,'These are existing labelled source packages, not the newly prepared D0–D7 packs. Keep their originals, ZIPs and identities; do not reseed or reset data for cleanup.')
    path='fixtures/README.md';text=Path(path).read_text()
    text=text.replace('# Synthetic demonstration inputs','# Fixture inputs and data preparation',1)
    text=text.replace('Every file here is generated teaching data, not surveyed measurements, official identities or ownership evidence.',
        'The C-001/C-002 examples described below are generated teaching data, not surveyed measurements, official identities or ownership evidence. Other subfolders have their own provenance; `google-uttam` contains separately labelled external reference inputs and scenarios.')
    intro='''\n## New data work\n\nFollow [D0–D7 in handoff 00](../docs/usp-agent-handoffs/00-README.md#4-data-packs-acquire-before-implementing-against-imaginary-inputs) and the assigned feature's J tests. New `fixtures/usp/D0`–`D7` packs and acquisition scripts are implementation destinations, not datasets created by this cleanup. Preserve canonical `reference-neighborhood`, `complete-demo`, `studio/reference-v2`, Google/Uttam data and manifest-bound scene assets. Only a redundant expanded transfer-kit copy was removed; its canonical files and ZIP remain. Do not infer a format's capabilities or classification from its folder name.\n\n## Existing C-001 / C-002 teaching cases\n'''
    first,_,rest=text.partition('\n');write(path,first+'\n'+intro+'\n'+rest.lstrip())
    p=Path('package.json');pkg=json.loads(p.read_text())
    if pkg['scripts'].get('guide') != 'node scripts/guide.mjs':
        raise RuntimeError('Unexpected guide command; re-review consumer.')
    del pkg['scripts']['guide'];write(str(p),json.dumps(pkg,indent=2,ensure_ascii=False))
    p=Path('.gitattributes');write(str(p),p.read_text().replace('Astra_MVP_Handoff_Pack/** -text\n',''))
    p=Path('.gitignore');write(str(p),p.read_text()+'\n# Reproducible historical comparison output is not a public runtime asset.\noutput/studio-review/\n')
    p=Path('scripts/studio/compare.py');text=p.read_text()
    text=text.replace("OUT=ROOT/'apps/web/public/studio-review'", "# Retained historical utility; never overwrite the public source-reference manifest.\nOUT=(ROOT/os.environ.get('STUDIO_REVIEW_OUTPUT','output/studio-review')).resolve()\nif OUT == (ROOT/'apps/web/public').resolve() or (ROOT/'apps/web/public').resolve() in OUT.parents:\n raise ValueError('Comparison output must stay outside apps/web/public')")
    if "OUT=ROOT/'apps/web/public/studio-review'" in text:raise RuntimeError('Gallery output fix failed.')
    text=text.replace("'kind':'labelled-original-and-runtime-comparison'", "'kind':'historical-reference-comparison-not-current-acceptance'")
    write(str(p),text)
    notes={
        'docs/STUDIO_DEMO_GUIDE.md':'This walkthrough describes the retained application baseline, not completion of the planned USP workflows.',
        'docs/OFFICER_STARTUP.md':'Keep these operational startup/isolation instructions; later feature completion requires its own evidence.',
        'docs/ARCHITECTURE.md':'This is baseline architecture context; adopted shared-contract changes are specified in handoff 01.',
        'docs/IMPLEMENTATION_CONTRACT.md':'This describes baseline API behavior; new USP contracts are requirements, not already implemented endpoints.',
        'docs/OFFICER_AI.md':'The Nous-specific behavior below is historical/baseline. Governed Sarvam and manual fallback requirements are in handoff 19; no live provider pass is implied.',
        'docs/HOSTING.md':'This is a retained hosting assessment, not proof of a qualified deployment. Follow the separate environment gates in handoff 19.',
        'docs/HACKATHON_BRIEFING.md':'This is a dated presentation brief, not the new feature-completion ledger.',
        'docs/HACKATHON_DEMO.md':'This is a retained baseline demonstration, not evidence that the new features or datasets are finished.',
        'docs/REGISTER_CONTROLS_AND_EXPORTS.md':'Preserve baseline controls and original archives. The new property-only packet has separate scope/permission tests in handoff 10.',
        'docs/engineering-plan/STUDIO_UX_PLAN.md':'This earlier execution sequence is historical; preserve useful requirements and CI inputs, but follow handoffs 00/99 for new implementation.',
        'design/bulk-studio-v4/README.md':'Historical standalone prototype retained for reference; not an alternative product, schema authority or new dataset.',
        'design/officer-studio-v3/DESIGN_BRIEF.md':'Historical visual brief retained with its unique references; it does not override the active-Studio acceptance in handoff 99.',
        'design/reference-map-v5/README.md':'Prototype code and its data/reference donors remain where generators/tests depend on them. Do not remove the data or use this standalone page as product completion.',
        'docs/v2-design/README.md':'Historical design/reference input retained for existing acceptance checks, not current execution instructions.',
    }
    for path,note in notes.items():banner(path,note)
    for path in sorted(RETAIN_REPORTS):
        banner(path,'This is a historical API result at its stated revision and a conventional output path of the existing regression script. Re-run in an isolated environment for a current result.')
    path='docs/EXPLAINER_GUIDE.md';text=Path(path).read_text()
    text=text.replace('Run\n`node outputs/ml-explainer/verify.mjs` against the local app to repeat the checks.',
        'Those historical checks and their one-off harness are retained in [the pinned output directory]('+TREE_URL+'outputs/ml-explainer/). They were not re-run by cleanup. Do not use that removed working-tree command as a current acceptance gate; use the assigned feature and active-Studio tests for new work.')
    write(path,text)
    retargeted=[]
    for path in sorted(set(texts)|set(notes)|{'docs/EXPLAINER_GUIDE.md'}):
        if Path(path).is_file() and mutable_markdown(path):
            text=Path(path).read_text();updated=rewrite_historical_links(path,text,selected,dirs)
            if updated!=text:
                write(path,updated);retargeted.append(path)
    manifest=json.loads(Path('apps/web/public/studio-review/comparison-manifest.json').read_text())
    reference_checks=[]
    for name,item in manifest['images'].items():
        source=Path(item['source'])
        if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=item['sha256']:
            raise RuntimeError(f'Visual-reference source changed/missing: {name}')
        reference_checks.append(item['source'])
    def exists_target(path,url):
        target=local_target(path,url)
        return target is None or '{' in target or '<' in target or Path(target).exists()
    link_errors=[]
    for path in sorted(set(texts)|{x['path'] for x in imported}):
        if not Path(path).is_file():continue
        now=Path(path).read_text(encoding='utf-8');before=texts.get(path,'')
        for url in all_links(path,now):
            target=local_target(path,url)
            previously_missing=(url in all_links(path,before) and target not in baseline and
                not any(x.startswith((target or '')+'/') for x in baseline))
            if not exists_target(path,url) and not previously_missing:
                link_errors.append({'path':path,'url':url})
    if link_errors:raise RuntimeError('New broken Markdown targets: '+json.dumps(link_errors))
    allowed_non_md={'package.json','.gitignore','.gitattributes','scripts/studio/compare.py'}
    protected=[]
    for path,item in baseline.items():
        if path in selected:continue
        if not Path(path).is_file():raise RuntimeError(f'Unapproved removal: {path}')
        if not mutable_markdown(path) and path not in allowed_non_md:
            if blob_sha(Path(path).read_bytes())!=item['blob']:
                raise RuntimeError(f'Protected source changed: {path}')
            protected.append(path)
    for entry in imported:
        if blob_sha(Path(entry['path']).read_bytes())!=entry['blob']:
            raise RuntimeError(f'Imported handoff changed: {entry["path"]}')
    report={
        'schemaVersion':'ulpin-applied-cleanup/1','date':'2026-09-23','branch':BRANCH,
        'baseline':BASE,'review':REVIEW,'handoffs_copied_from':HANDOFF,
        'deletions':[{'path':p,'rule':r,**baseline[p]} for p,r in sorted(selected.items())],
        'deleted_files':len(selected),'deleted_logical_bytes':sum(baseline[p]['bytes'] for p in selected),
        'by_rule':dict(sorted(collections.Counter(selected.values()).items())),
        'verified_duplicate_pairs':duplicates,'handoffs_imported':imported,
        'protected_files_hash_checked':len(protected),'visual_reference_sources_hash_checked':reference_checks,
        'retargeted_markdown':retargeted,'new_broken_local_markdown_links':link_errors,
        'deferred':['R01 older UI: V0/replacement browser gate not passed','R02 donor/render/fixture dependencies',
                    'R03/R04 test-target replacements','A06 historical evidence still referenced or not separately qualified',
                    'A07 CI-dependent plan retirement','A08/A09 unique design references','A10 generator/test-dependent prototype'],
        'not_performed':['dataset import/reset/reseed','database migration','application feature implementation',
                         'new V0/I1 qualification','production deployment','main merge','history rewrite'],
        'test_results':'See the linked GitHub Actions run; this file records structural checks, not future test success.'}
    write(RECEIPT,json.dumps(report,indent=2,ensure_ascii=False))
    old=Path(PREFIX+'README.md').read_text()
    old=old.replace('# Data-transition cleanup review — recommendations only','# Pre-cleanup inventory — historical review',1)
    applied=f'''# Data-transition cleanup — applied on the review branch

**23 September 2026.** The user approved cleanup. This branch removes **{len(selected)}**
verified redundant or retired paths, totaling **{report['deleted_logical_bytes']:,} logical bytes**.
The [machine-readable receipt](applied-cleanup.json) lists every deletion, its
baseline blob, all 91 retained duplicate counterparts, the copied handoff hashes,
and the still-deferred dependency-gated groups. This is working-tree cleanup;
Git history and local data volumes were not changed.

Current implementation starts at [handoff 00](../usp-agent-handoffs/00-README.md),
then [01](../usp-agent-handoffs/01-shared-contracts-and-ownership.md), the feature
A–K file and [99](../usp-agent-handoffs/99-ui-ux-and-integration.md). The complete
15-file handoff tree is copied byte-for-byte from `{HANDOFF}`; PR #7 is not merged
into main by this operation. Planned capabilities remain planned.

## Applied changes

91 duplicate files were removed only after matching the retained originals.
Retired orchestration plans and selected historical walkthrough/result documents
now resolve to pinned history. Obsolete public galleries, old annotated tutorials
and generated explainer captures no longer ship in the active tree. `pnpm guide`
was retired with its server. The comparison generator now writes to ignored
`output/studio-review/`, not public assets or the protected reference manifest.

README, AGENTS, current-work/engineering entry points and affected data/operation
guides distinguish baseline behavior from new implementation and data plans.
Historical design and CI-dependent material that remains has explicit steering
notes. The existing docs Word-guide copy is retained as the duplicate's historical
counterpart, not an active tutorial. Three API report paths remain because the
existing regression script still writes them.

## Preserved and deferred

Canonical sources, upload ZIPs, repo-data, Uttam Nagar transfer packs, source IDs,
scene assets and all reference images named by comparison-manifest.json remain.
Application TypeScript/Python services, tests, dependencies/lockfile and old
runtime donors are unchanged. F0/V0/I1 are not claimed complete. Retirements
requiring replacement browser/CI/geometry coverage are **deferred**, not an
instruction to recursively delete the remaining historical candidates.

Structural checks verify protected file hashes, 91 duplicate counterparts,
reference-image hashes, exact handoff copies and newly broken Markdown targets.
The branch-scoped apply workflow runs pure repository tests before pushing the
cleanup commit. Its actual result is in GitHub Actions, not presumed by this text.
No database, GPU/browser journey, local-PC or real-source qualification is implied.

## Historical recovery

| Retired material | Immutable source |
| --- | --- |
| Original MVP mandate, source basis and agent pack | [Astra pack]({TREE_URL}Astra_MVP_Handoff_Pack/) |
| Earlier root implementation handoff | [GPT_6_PRO_HANDOFF.md]({BASE_URL}GPT_6_PRO_HANDOFF.md) |
| Earlier block, parcel and deep-review plans | [BLOCK_DEMO_PLAN]({BASE_URL}BLOCK_DEMO_PLAN.md), [PARCEL_TO_3D_PLAN]({BASE_URL}PARCEL_TO_3D_PLAN.md), [DEEP_REVIEW]({BASE_URL}DEEP_REVIEW.md) |
| Dated operational/verification reports | [Baseline docs]({TREE_URL}docs/); exact paths are in the receipt |
| Annotated tutorial and guide source | [Tutorial]({TREE_URL}docs/tutorial-images/), [guide server]({BASE_URL}scripts/guide.mjs) |
| Previous public comparison galleries | [Studio gallery]({TREE_URL}apps/web/public/studio-review/), [reference review]({TREE_URL}apps/web/public/reference/review/), [T079 review]({TREE_URL}apps/web/public/reference/review-t079/) |
| Previous ML explainer captures and harness | [Explainer output]({TREE_URL}outputs/ml-explainer/) |

For an exact path, recover with `git show {BASE}:<path>` in an isolated destination.
Do not restore an entire obsolete instruction pack as current policy. No second
large archive is copied into the repository. Do not rewrite history to shrink
these historical blobs. The original rule generator remains a read-only classifier
of the original baseline, **not** an executable current deletion allowlist.

---

'''
    write(PREFIX+'README.md',applied+old)
    spec['mode']='historical_recommendations_not_executable_allowlist'
    spec['execution_receipt']='applied-cleanup.json'
    write(PREFIX+'decisions.json',json.dumps(spec,indent=2,ensure_ascii=False))
    changed=git('diff','--name-only').decode().splitlines()
    for path in changed:
        if path in selected or mutable_markdown(path) or path in allowed_non_md or path.startswith(PREFIX):
            continue
        raise RuntimeError(f'Unapproved modification: {path}')
    git('diff','--check')
    print(json.dumps({'deleted':len(selected),'logical_bytes':report['deleted_logical_bytes'],
        'duplicates_verified':len(duplicates),'handoffs':len(imported),
        'protected_hash_checks':len(protected),'new_broken_links':len(link_errors)},indent=2))


if __name__=='__main__':
    main()
