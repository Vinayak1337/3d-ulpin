#!/usr/bin/env python3
"""Classify a pinned Git inventory. Writes reports only; never deletes/moves source files.

Run from an isolated checkout:
  python3 docs/cleanup-review/classify_inventory.py --repo . --output /tmp/ulpin-review
Or use the preserved inventory from the review artifact:
  python3 classify_inventory.py --inventory inventory.json --output ./classification
"""
from __future__ import annotations
import argparse
import collections
import csv
import hashlib
import json
import pathlib
import subprocess
import sys
from typing import Any

BASELINE = 'f623cff897f91bb3ebd4c225f700ac263f7beb72'


def read_git_inventory(repo: pathlib.Path) -> list[dict[str, Any]]:
    resolved = subprocess.check_output(
        ['git', '-C', str(repo), 'rev-parse', BASELINE + '^{commit}'], text=True
    ).strip()
    if resolved != BASELINE:
        raise ValueError('Pinned baseline is unavailable; do not substitute current HEAD.')
    raw = subprocess.check_output(
        ['git', '-C', str(repo), 'ls-tree', '-r', '-l', '-z', BASELINE]
    )
    rows = []
    for part in raw.split(b'\0'):
        if not part:
            continue
        header, raw_path = part.split(b'\t', 1)
        mode, kind, sha, size = header.decode('ascii').split()
        rows.append(dict(path=raw_path.decode('utf-8'), mode=mode, type=kind,
                         git_blob_sha=sha, bytes=None if size == '-' else int(size),
                         review_source='git_metadata_recomputed'))
    return rows


def classify(path: str, rules: list[dict[str, Any]]) -> dict[str, Any]:
    for rule in rules:
        if path in rule.get('paths', []) or any(path.startswith(p) for p in rule.get('prefixes', [])):
            return rule
        if rule['id'] == 'K99':
            return rule
    raise ValueError('No fallback rule')


def reports(inventory: list[dict[str, Any]], spec: dict[str, Any],
            edges: dict[str, list[str]] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if spec.get('baseline') != BASELINE:
        raise ValueError('Rules do not name the expected baseline.')
    canonical = json.dumps([{k: r[k] for k in ('path','mode','type','git_blob_sha','bytes')}
                            for r in sorted(inventory, key=lambda x: x['path'])],
                           separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    actual_digest = hashlib.sha256(canonical).hexdigest()
    if actual_digest != spec.get('inventory_metadata_sha256'):
        raise ValueError('Inventory metadata differs from the reviewed baseline; re-review instead of applying stale rules.')
    paths = [x['path'] for x in inventory]
    if len(paths) != len(set(paths)):
        raise ValueError('Inventory contains duplicate paths.')
    if any(x.get('type') != 'blob' for x in inventory):
        raise ValueError('This reviewed inventory expects tracked blobs only; investigate new entry types.')
    by_path = {x['path']: x for x in inventory}
    by_blob: dict[str, list[str]] = collections.defaultdict(list)
    incoming: dict[str, list[str]] = collections.defaultdict(list)
    for item in inventory:
        by_blob[item['git_blob_sha']].append(item['path'])
    for source, destinations in (edges or {}).items():
        for dest in destinations:
            incoming[dest].append(source)
    rules = spec['ordered_rules']
    preliminary = {p: classify(p, rules) for p in paths}
    output = []
    summary: dict[str, Any] = {
        'schemaVersion': 'ulpin-cleanup-result/1', 'baseline': BASELINE,
        'handoff_commit': spec['handoff_commit'], 'date': spec['decision_date'],
        'mode': 'recommendations_only_no_deletions',
        'inventory_metadata_sha256': actual_digest,
        'tracked_files': len(inventory), 'tracked_blob_bytes': sum(x['bytes'] or 0 for x in inventory),
        'review_methods': dict(collections.Counter(x['review_source'] for x in inventory)),
        'static_graph_supplied': edges is not None,
        'limits': [
            'All tracked files receive a disposition; UTF-8 content was machine-scanned and key consumers/candidate groups manually reviewed.',
            'Binary/image/archive/Word payloads were reviewed by Git metadata and references, not full decoding or visual inspection.',
            'Literal import/reference tracing is not a complete runtime reachability proof. Unknown computed reads remain a removal gate.',
            'No application tests, DB reset, source deletion, movement, deployment or main merge occurred.',
            'Sizes are logical checkout bytes, not unique Git object bytes or a promised reduction in Git history/clone size.'
        ],
        'by_rule': {}, 'by_action': {}, 'duplicate_candidates': {'files': 0, 'bytes': 0},
    }
    for item in sorted(inventory, key=lambda x: x['path']):
        p = item['path']; rule = preliminary[p]
        counterparts = sorted(q for q in by_blob[item['git_blob_sha']] if q != p)
        keeper = None
        if rule['id'] == 'D01':
            keeper = 'docs/3D_ULPIN_UI_Demo_Guide.docx'
        elif rule['id'] == 'D02':
            keeper = p.removeprefix('fixtures/lake-view-complete-inputs/')
        elif rule['id'] == 'D03':
            keeper = rule['canonical_prefix'] + p.removeprefix('data-source/lake-view-files/')
        if keeper is not None:
            if keeper not in by_path or by_path[keeper]['git_blob_sha'] != item['git_blob_sha']:
                raise ValueError(f'Missing byte-identical retained counterpart for {p}: {keeper}')
            if preliminary[keeper]['id'] in ('D01', 'D02', 'D03'):
                raise ValueError(f'Circular duplicate removal: {p} and {keeper}')
            summary['duplicate_candidates']['files'] += 1
            summary['duplicate_candidates']['bytes'] += item['bytes'] or 0
        review_basis = 'Full UTF-8 text available for static scan; candidate group and dependencies reviewed.' if item['review_source'] == 'full_text_preserved' else 'Git blob identity/size and referencing consumers; binary content not decoded.'
        retention = ('Retain the listed identical counterpart; no new duplicate archive needed.' if keeper else
                     'Use the pinned baseline for historical recovery; keep only unique, useful requirement/design/test references, not a second bulk archive.' if rule['action'].startswith(('ARCHIVE','DELETE_OR_ARCHIVE','RETIRE')) else
                     'Retain in active checkout until its stated gate is satisfied.')
        row = {
            **item, 'decision_id': rule['id'], 'action': rule['action'],
            'reason': rule['reason'], 'before_removal': rule['gate'],
            'review_basis': review_basis,
            'retained_identical_path': keeper,
            'other_identical_blob_paths': counterparts,
            'literal_static_importers': sorted(set(incoming.get(p, []))),
            'retention': retention,
            'baseline_url': 'https://github.com/Vinayak1337/3d-ulpin/blob/' + BASELINE + '/' + p,
        }
        output.append(row)
        for dest, key in [('by_rule',rule['id']),('by_action',rule['action'])]:
            group = summary[dest].setdefault(key, {'files':0, 'bytes':0})
            group['files'] += 1; group['bytes'] += item['bytes'] or 0
    summary['removal_or_archive_candidates'] = sum(x['files'] for k,x in summary['by_action'].items() if not k.startswith('KEEP'))
    summary['retained_or_update_files'] = len(inventory)-summary['removal_or_archive_candidates']
    return output, summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--repo', type=pathlib.Path)
    group.add_argument('--inventory', type=pathlib.Path)
    parser.add_argument('--rules', type=pathlib.Path, default=pathlib.Path(__file__).with_name('decisions.json'))
    parser.add_argument('--edges', type=pathlib.Path, help='Optional preserved conservative literal-import graph')
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()
    try:
        spec = json.loads(args.rules.read_text(encoding='utf-8'))
        inv = read_git_inventory(args.repo) if args.repo else json.loads(args.inventory.read_text(encoding='utf-8'))
        edges = json.loads(args.edges.read_text(encoding='utf-8')) if args.edges else None
        result, summary = reports(inv, spec, edges)
        if args.output.exists():
            raise ValueError('Output path already exists; choose a new report directory. Source files are never overwritten.')
        args.output.mkdir(parents=True)
        (args.output/'full-inventory.json').write_text(json.dumps(result, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
        (args.output/'summary.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
        fields = ['path','decision_id','action','bytes','git_blob_sha','review_source','reason','before_removal','retained_identical_path','literal_static_importers','retention','baseline_url']
        candidates = [r for r in result if not r['action'].startswith('KEEP')]
        for name, rows in [('full-inventory.csv',result),('candidates.csv',candidates)]:
            with (args.output/name).open('w', newline='', encoding='utf-8') as handle:
                writer = csv.DictWriter(handle, fieldnames=fields, extrasaction='ignore'); writer.writeheader()
                for row in rows:
                    writer.writerow({**row,'literal_static_importers':'; '.join(row['literal_static_importers'])})
        text=['# Exact cleanup candidates\n', f'Baseline `{BASELINE}`. Recommendations only; no source deleted. All preconditions remain mandatory.\n']
        for rule in spec['ordered_rules']:
            rows=[r for r in candidates if r['decision_id']==rule['id']]
            if not rows: continue
            text += [f"\n## {rule['id']} — {rule['action']} ({len(rows)} files)\n",rule['reason']+'\n', '**Before removal:** '+rule['gate']+'\n','\n```text']
            text += [r['path'] for r in rows]
            text += ['```\n']
        (args.output/'candidate-paths.md').write_text('\n'.join(text)+'\n',encoding='utf-8')
        print(json.dumps(summary,indent=2))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print(f'Review report failed: {exc}',file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
