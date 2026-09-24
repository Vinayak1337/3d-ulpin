#!/usr/bin/env python3
"""Validate the active handoff graph, not application correctness or old backlog status."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

PLAN = 'docs/usp-agent-handoffs/release-plan.json'
RETIRED = (
    r'H00\s+(?:section\s*4|§\s*4)',
    r'00-README\.md#4-data-packs',
    r'H14\s+(?:J\s+A1[–-]A5|E4\b)',
    r'Later training stays outside live ingestion',
    r'No per-import training',
    r'The next implementation gate is F0',
)


def prose(text: str) -> str:
    # Code-fence examples are still scanned for retired instructions below, but
    # code containing Markdown syntax must not create false document links.
    return re.sub(r'^(`{3,}|~{3,})[^\n]*\n.*?^\1\s*$', '', text,
                  flags=re.MULTILINE | re.DOTALL)


def anchors(text: str) -> set[str]:
    result: set[str] = set()
    used: dict[str, int] = {}
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*\s*$', prose(text), re.MULTILINE):
        heading = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', heading)
        slug = re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-')
        n = used.get(slug, 0)
        used[slug] = n + 1
        result.add(slug if n == 0 else f'{slug}-{n}')
    result.update(re.findall(r'\bid=["\x27]([^"\x27]+)["\x27]', text))
    return result


def validate(root: Path, relative_plan: str = PLAN) -> list[str]:
    root = root.resolve()
    errors: list[str] = []

    def fail(message: str) -> None:
        errors.append(message)

    def exists(relative: str, context: str, *, file: bool = True) -> Path | None:
        if not isinstance(relative, str) or not relative:
            fail(f'{context}: missing path')
            return None
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or (not path.is_file() if file else not path.exists()):
            fail(f'{context}: missing or outside-repository path {relative}')
            return None
        return path

    def runtime_receipt(relative: str, test_id: str) -> None:
        prefix = 'docs/evidence/usp/finale' if test_id.startswith('GF-') else 'docs/evidence/usp/full-product'
        path = exists(relative, test_id + ' runtime receipt')
        if not path:
            return
        expected_dir = root / prefix / test_id
        if path.parent != expected_dir or path.suffix != '.json':
            fail(f'{test_id}: runtime receipt outside its test namespace')
            return
        try:
            receipt = json.loads(path.read_text())
        except (OSError, ValueError) as exc:
            fail(f'{test_id}: unreadable runtime receipt: {exc}')
            return
        if not isinstance(receipt, dict):
            fail(f'{test_id}: runtime receipt must be an object')
            return
        if receipt.get('schemaVersion') != 'ulpin-test-receipt/1' or receipt.get('testId') != test_id:
            fail(f'{test_id}: wrong runtime receipt schema/test ID')
        if receipt.get('status') != 'passed' or type(receipt.get('exitCode')) is not int or receipt.get('exitCode') != 0:
            fail(f'{test_id}: receipt does not record a passing command')
        if not re.fullmatch(r'[0-9a-f]{40}', str(receipt.get('codeCommit', ''))):
            fail(f'{test_id}: missing pinned code commit')
        if not re.fullmatch(r'[0-9a-f]{64}', str(receipt.get('manifestHash', ''))):
            fail(f'{test_id}: missing manifest hash')
        for field in ('sourceHashes', 'modelHashes'):
            values = receipt.get(field)
            if not isinstance(values, list) or (field == 'sourceHashes' and not values) or any(
                    not re.fullmatch(r'[0-9a-f]{64}', str(value)) for value in (values or [])):
                fail(f'{test_id}: invalid {field}')
        if test_id == 'GF-AI' and not receipt.get('modelHashes'):
            fail('GF-AI: learned routes require model hashes')
        try:
            datetime.strptime(receipt.get('runAt', ''), '%Y-%m-%dT%H:%M:%SZ')
        except (ValueError, TypeError):
            fail(f'{test_id}: missing UTC run timestamp')
        if not isinstance(receipt.get('environment'), dict) or not receipt['environment']:
            fail(f'{test_id}: missing execution environment')
        if not isinstance(receipt.get('command'), str) or not receipt['command'].strip():
            fail(f'{test_id}: missing executed command')
        cases = receipt.get('expectedActual')
        if not isinstance(cases, list) or not cases:
            fail(f'{test_id}: missing expected/actual cases')
        else:
            case_ids = set()
            for case in cases:
                if not isinstance(case, dict) or not all(k in case for k in ('caseId','expected','actual','result')):
                    fail(f'{test_id}: malformed expected/actual case')
                    continue
                if case['result'] != 'passed' or not case['caseId'] or case['caseId'] in case_ids:
                    fail(f'{test_id}: failed or duplicate expected/actual case')
                case_ids.add(case['caseId'])
        artifacts = receipt.get('artifacts')
        if not isinstance(artifacts, list) or not artifacts:
            fail(f'{test_id}: missing execution artifacts')
        else:
            for artifact in artifacts:
                if not isinstance(artifact, dict):
                    fail(f'{test_id}: malformed artifact')
                    continue
                artifact_path = exists(artifact.get('path'), test_id + ' artifact')
                if artifact_path:
                    hasher = hashlib.sha256()
                    with artifact_path.open('rb') as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            hasher.update(block)
                    digest = hasher.hexdigest()
                    if digest != artifact.get('sha256'):
                        fail(f'{test_id}: artifact hash mismatch')

    try:
        plan = json.loads((root / relative_plan).read_text())
    except (OSError, ValueError) as exc:
        return [f'plan unreadable: {exc}']
    if plan.get('schemaVersion') != 'ulpin-release-plan/1':
        fail('unsupported schemaVersion')
    owners = plan.get('owners', {})
    tests = plan.get('tests', {})
    releases = plan.get('releases', {})
    if not owners or not tests or not releases:
        fail('owners, tests and releases must be nonempty')
    gates: dict[str, dict] = {}
    for gate in plan.get('gates', []):
        id = gate.get('id')
        if not id or id in gates:
            fail(f'duplicate or missing gate id: {id}')
        gates[id] = gate
    if not gates:
        fail('no gates')
    for id, gate in gates.items():
        release = gate.get('release')
        if release not in releases:
            fail(f'{id}: unknown release {release}')
        for dependency in gate.get('dependsOn', []):
            if dependency not in gates:
                fail(f'{id}: unknown dependency {dependency}')
            elif release == 'finale_v1' and gates[dependency].get('release') != 'finale_v1':
                fail(f'{id}: finale depends on deferred gate {dependency}')
        if gate.get('status') not in ('pending', 'blocked', 'complete'):
            fail(f'{id}: invalid gate status')
        if not gate.get('tests'):
            fail(f'{id}: no tests')
        for test in gate.get('tests', []):
            if test not in tests:
                fail(f'{id}: unknown test {test}')
        for evidence in gate.get('evidence', []):
            exists(evidence, id + ' evidence')
        if gate.get('status') == 'complete':
            if not gate.get('evidence'):
                fail(f'{id}: complete without evidence')
            expected_receipts = {r for t in gate.get('tests', []) for r in tests.get(t, {}).get('receipts', [])}
            if set(gate.get('evidence', [])) != expected_receipts:
                fail(f'{id}: gate evidence must equal its exact test receipts')
            if any(tests.get(t, {}).get('status') != 'passed' for t in gate.get('tests', [])):
                fail(f'{id}: complete without passed tests')
            if any(gates.get(d, {}).get('status') != 'complete' for d in gate.get('dependsOn', [])):
                fail(f'{id}: complete before dependencies')
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(id: str) -> None:
        if id in visiting:
            fail(f'dependency cycle at {id}')
            return
        if id in visited or id not in gates:
            return
        visiting.add(id)
        for dep in gates[id].get('dependsOn', []):
            visit(dep)
        visiting.remove(id)
        visited.add(id)
    for id in gates:
        visit(id)
    for release, data in releases.items():
        members = data.get('requires', [])
        if len(members) != len(set(members)) or not members:
            fail(f'{release}: empty or duplicate required gates')
        for id in members:
            if id not in gates:
                fail(f'{release}: unknown required gate {id}')
                continue
            if release == 'finale_v1' and gates[id].get('release') != release:
                fail(f'{release}: deferred member {id}')
            for dep in gates[id].get('dependsOn', []):
                if dep not in members:
                    fail(f'{release}: missing prerequisite {dep} for {id}')
        for id, gate in gates.items():
            if gate.get('release') == release and id not in members:
                fail(f'{release}: omitted owned gate {id}')
    active_release = plan.get('currentRelease')
    if active_release not in releases:
        fail('unknown currentRelease')
    remaining = [g for g in releases.get(active_release, {}).get('requires', [])
                 if gates.get(g, {}).get('status') != 'complete']
    next_gate = plan.get('nextGate')
    if next_gate != (remaining[0] if remaining else None):
        fail('nextGate does not match first remaining required gate')
    if next_gate in gates and any(gates.get(d, {}).get('status') != 'complete'
                                  for d in gates[next_gate].get('dependsOn', [])):
        fail('nextGate dependencies are not complete')
    referenced_tests: set[str] = set()
    seen: set[str] = set()
    for req in plan.get('requirements', []):
        id = req.get('id')
        if not id or id in seen:
            fail(f'duplicate or missing requirement id {id}')
        seen.add(id)
        if req.get('owner') not in owners:
            fail(f'{id}: unknown owner')
        if req.get('gate') not in gates:
            fail(f'{id}: unknown gate')
        if not req.get('docs') or not req.get('tests'):
            fail(f'{id}: requires documents and tests')
        for doc in req.get('docs', []):
            exists(doc, str(id))
        for test in req.get('tests', []):
            referenced_tests.add(test)
            if test not in tests:
                fail(f'{id}: unknown test {test}')
            if test not in gates.get(req.get('gate'), {}).get('tests', []):
                fail(f'{id}: test {test} missing from owning gate')
    if not seen:
        fail('no requirements')
    for id, test in tests.items():
        if test.get('owner') not in owners:
            fail(f'{id}: unknown owner')
        if test.get('kind') not in ('runtime', 'documentation'):
            fail(f'{id}: invalid test kind')
        if test.get('status') not in ('planned', 'passed', 'failed', 'blocked'):
            fail(f'{id}: invalid test status')
        if id not in referenced_tests:
            fail(f'{id}: orphan test')
        if not test.get('specs'):
            fail(f'{id}: no specification')
        for spec in test.get('specs', []):
            exists(spec, id + ' specification')
        if test.get('status') == 'passed' and not test.get('receipts'):
            fail(f'{id}: passed without receipt')
        for receipt in test.get('receipts', []):
            if test.get('status') == 'passed' and test.get('kind') == 'runtime':
                runtime_receipt(receipt, id)
            else:
                exists(receipt, id + ' receipt')
    baseline = plan.get('baseline', {})
    if not re.fullmatch(r'[0-9a-f]{40}', baseline.get('commit', '')):
        fail('baseline must pin full commit SHA')
    exists(baseline.get('receipt'), 'baseline receipt')
    docs: set[Path] = set()
    directory = exists(plan.get('activeDocDirectory'), 'activeDocDirectory', file=False)
    if directory:
        docs.update(directory.glob('*.md'))
    for entry in plan.get('entryPoints', []):
        path = exists(entry, 'entry point')
        if path:
            docs.add(path)
            declarations = re.findall(r'<!-- plan-next-gate: ([A-Z0-9-]+|none) -->', path.read_text())
            if declarations != [next_gate or 'none']:
                fail(f'{entry}: next-gate declaration disagrees with manifest')
            visible = re.findall(r'Next gate:\s*([A-Z0-9-]+)', path.read_text().replace('*', ''))
            if visible and visible != [next_gate]:
                fail(f'{entry}: visible next gate disagrees with manifest')
    if not docs:
        fail('no active documents')
    current_path = root / 'docs/engineering-plan/CURRENT_WORK.md'
    if current_path in docs and next_gate and not re.search(
            rf'Next gate:\s*{re.escape(next_gate)}\b', current_path.read_text()):
        fail('CURRENT_WORK next gate disagrees with manifest')
    # Strongly pin the active entry points; old dated hashes in body history are allowed.
    for entry in ('AGENTS.md', 'docs/usp-agent-handoffs/00-README.md',
                  'docs/usp-agent-handoffs/02-lead-agent-execution.md',
                  'docs/engineering-plan/CURRENT_WORK.md'):
        path = root / entry
        if path in docs and baseline.get('commit') not in path.read_text():
            fail(f'{entry}: consolidated baseline missing or stale')
    for path in sorted(docs):
        content = path.read_text()
        name = str(path.relative_to(root))
        for retired in RETIRED:
            if re.search(retired, content, flags=re.IGNORECASE):
                fail(f'{name}: retired instruction/reference: {retired}')
        for target in re.findall(r'!?\[[^\]\n]*\]\(([^)\n]+)\)', prose(content)):
            target = target.strip().strip('<>')
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            dest = (path.parent / unquote(url.path)).resolve() if url.path else path
            if not dest.is_relative_to(root) or not dest.exists():
                fail(f'{name}: broken local link {target}')
                continue
            if url.fragment and dest.suffix == '.md' and unquote(url.fragment) not in anchors(dest.read_text()):
                fail(f'{name}: broken heading anchor {target}')
    check = plan.get('planValidation', {})
    for field in ('validator', 'tests'):
        exists(check.get(field), 'planValidation ' + field)
    if check.get('status') == 'passed':
        exists(check.get('receipt'), 'planValidation passed receipt')
    elif check.get('status') != 'pending':
        fail('invalid planValidation status')
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
    args = parser.parse_args()
    errors = validate(args.root)
    if errors:
        for error in errors:
            print('ERROR:', error)
        print(f'FAIL: {len(errors)} active-plan errors')
        return 1
    print('PASS: active document links/anchors, owners/tests, release DAG, baseline and next gate')
    print('Document consistency only; no application/runtime gate is passed by this validator.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
