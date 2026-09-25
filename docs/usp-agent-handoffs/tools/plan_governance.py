"""Evidence-bound plan governance. This checks records, not signer authenticity."""
from __future__ import annotations

from datetime import date
import hashlib
import json
from pathlib import Path
import re
import subprocess

HUMAN_IDS = {'H90-1', 'H90-2', 'H90-3', 'H90-4', 'H90-5'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def model_family(model):
    """Do not accept a self-labelled cross-family review for two OpenAI models."""
    if not isinstance(model, str):
        return None
    for prefix, family in (('gpt-', 'openai'), ('o1', 'openai'), ('o3', 'openai'),
                           ('o4', 'openai'), ('claude-', 'anthropic'), ('gemini-', 'google')):
        if model.lower().startswith(prefix):
            return family
    return None


def validate_governance(root, relative_plan, plan, fail, exists, timestamp, runtime_receipt):
    gates = {g['id']: g for g in plan.get('gates', []) if g.get('id')}
    tests = plan.get('tests', {})

    def nonblank(value):
        return isinstance(value, str) and bool(value.strip())

    def array(value, context):
        if not isinstance(value, list):
            fail(context + ': must be an array')
            return []
        return value

    def pinned_file(pin, context):
        if not isinstance(pin, dict):
            fail(context + ': missing path/hash evidence')
            return None
        path = exists(pin.get('path'), context)
        if path and (not re.fullmatch(r'[0-9a-f]{64}', str(pin.get('sha256', ''))) or
                     hashlib.sha256(path.read_bytes()).hexdigest() != pin.get('sha256')):
            fail(context + ': evidence hash mismatch')
            return None
        return path

    def record(pin, context):
        path = pinned_file(pin, context)
        if path:
            try:
                value = json.loads(path.read_text(encoding='utf-8'))
                if isinstance(value, dict):
                    return value
            except (OSError, ValueError, UnicodeError):
                pass
            fail(context + ': evidence must be a UTF-8 JSON object')
        return {}

    owner = plan.get('projectOwner')
    owner_time = None
    if 'projectOwner' not in plan:
        fail('projectOwner: must be explicit null until designated by evidence')
    if owner is not None:
        if not isinstance(owner, dict) or not nonblank(owner.get('id')):
            fail('projectOwner: invalid owner identity')
            owner = None
        else:
            evidence = record(owner.get('evidence'), 'projectOwner')
            if (evidence.get('schemaVersion') != 'ulpin-owner-designation/1' or
                    evidence.get('ownerId') != owner['id'] or evidence.get('role') != 'owner' or
                    not nonblank(evidence.get('statement')) or not nonblank(evidence.get('sourceReference'))):
                fail('projectOwner: missing explicit owner designation/source')
            owner_time = timestamp(evidence.get('recordedAt'), 'projectOwner designation')

    def approval(value, subject, context, *, owner_only=False, producers=(), after=None):
        if not isinstance(value, dict):
            fail(context + ': missing approvedBy evidence')
            return None
        identity = value.get('identity')
        if not isinstance(identity, dict) or not nonblank(identity.get('id')):
            fail(context + ': missing approver identity')
            identity = {}
        kind = identity.get('kind')
        if kind not in ('human', 'agent'):
            fail(context + ': approver must be human or agent')
        if identity.get('id') in [p.get('id') for p in producers]:
            fail(context + ': approver must differ from every producer')
        if owner_only and (kind != 'human' or not owner or identity.get('id') != owner.get('id') or
                           identity.get('role') != 'owner'):
            fail(context + ': requires designated human owner approval')
        if kind == 'agent':
            family = model_family(identity.get('model'))
            if (not family or identity.get('modelFamily') != family or
                    any(not nonblank(identity.get(k)) for k in ('product', 'effort'))):
                fail(context + ': invalid observed approver model/settings')
            families = {model_family(p.get('model')) for p in producers}
            if not families or None in families or family in families:
                fail(context + ': approval is not verified cross-family')
        approved_at = timestamp(value.get('approvedAt'), context + ' approval')
        if after and approved_at and approved_at < after:
            fail(context + ': approval predates reviewed evidence')
        if owner_only and owner_time and approved_at and approved_at < owner_time:
            fail(context + ': approval predates owner designation')
        evidence = record(value.get('evidence'), context + ' approval')
        if (evidence.get('schemaVersion') != 'ulpin-approval-source/1' or
                evidence.get('identity') != identity or evidence.get('decision') != 'approved' or
                evidence.get('subjectSha256') != digest(subject) or
                evidence.get('recordedAt') != value.get('approvedAt') or
                not nonblank(evidence.get('statement')) or not nonblank(evidence.get('sourceReference'))):
            fail(context + ': approval evidence does not bind identity, decision and current subject')
        return approved_at

    dependencies = {}
    for dep in array(plan.get('humanDependencies'), 'humanDependencies'):
        if not isinstance(dep, dict):
            fail('humanDependencies: malformed dependency')
            continue
        dep_id = dep.get('id')
        if not isinstance(dep_id, str) or dep_id not in HUMAN_IDS or dep_id in dependencies:
            fail('humanDependencies: ID must uniquely name the H90 short list')
            continue
        dependencies[dep_id] = dep
        needed_for = array(dep.get('neededFor'), dep_id + ' neededFor')
        if any(not isinstance(g, str) or g not in gates for g in needed_for) or len(set(map(str, needed_for))) != len(needed_for):
            fail(dep_id + ': invalid neededFor gates')
        if dep.get('status') not in ('open', 'resolved', 'not_required'):
            fail(dep_id + ': invalid dependency status')
        if dep.get('owner') is not None and not nonblank(dep.get('owner')):
            fail(dep_id + ': owner must be identity/role or explicit null')
        if 'owner' not in dep or not nonblank(dep.get('fallback')):
            fail(dep_id + ': missing owner/fallback')
        if dep_id in ('H90-1', 'H90-2', 'H90-3') and (dep.get('status') == 'not_required' or not needed_for):
            fail(dep_id + ': required short-list dependency cannot be dropped')
        if dep_id in ('H90-4', 'H90-5') and dep.get('status') != 'not_required' and not nonblank(dep.get('trigger')):
            fail(dep_id + ': optional dependency requires explicit H90 trigger')
        if dep.get('status') == 'resolved':
            resolution = record(dep.get('evidence'), dep_id + ' resolution')
            if (resolution.get('schemaVersion') != 'ulpin-human-dependency/1' or
                    resolution.get('id') != dep_id or resolution.get('status') != 'resolved' or
                    resolution.get('neededFor') != needed_for or resolution.get('owner') != dep.get('owner') or
                    not nonblank(dep.get('owner')) or not nonblank(resolution.get('sourceReference')) or
                    not nonblank(resolution.get('statement'))):
                fail(dep_id + ': missing bound resolution evidence')
            timestamp(resolution.get('recordedAt'), dep_id + ' resolution')
    if set(dependencies) != HUMAN_IDS:
        fail('humanDependencies: seed exactly the five H90 short-list entries')

    dates = {}
    for gate_id, gate in gates.items():
        values = [gate.get('fallbackDecisionDate'), gate.get('targetDate')]
        if gate.get('scheduleStatus') == 'unscheduled':
            if any(v is not None for v in values) or any(k not in gate for k in ('targetDate', 'fallbackDecisionDate')):
                fail(gate_id + ': unscheduled dates must be explicit null')
        elif gate.get('scheduleStatus') == 'scheduled':
            try:
                if any(not isinstance(v, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v) for v in values):
                    raise ValueError()
                fallback, target = map(date.fromisoformat, values)
                if fallback > target:
                    fail(gate_id + ': fallbackDecisionDate must not follow targetDate')
                dates[gate_id] = (fallback, target)
            except (ValueError, TypeError):
                fail(gate_id + ': schedule requires valid ISO dates')
        else:
            fail(gate_id + ': scheduleStatus must be unscheduled or scheduled')
        blocked_by = array(gate.get('blockedBy'), gate_id + ' blockedBy')
        for dep_id in blocked_by:
            dep = dependencies.get(str(dep_id), {})
            if dep.get('status') != 'open' or gate_id not in dep.get('neededFor', []):
                fail(gate_id + ': blockedBy must link an open human dependency needed for this gate')
        if gate.get('status') == 'blocked' and not blocked_by:
            fail(gate_id + ': blocked gate must cite an open human dependency')
        if gate.get('status') != 'blocked' and blocked_by:
            fail(gate_id + ': only blocked gates may cite blockedBy')
        if gate.get('status') != 'complete' and (gate.get('approvedBy') is not None or gate.get('completedAt') is not None):
            fail(gate_id + ': incomplete gate cannot claim approval/completion')
    for gate_id, (fallback, target) in dates.items():
        for dep_id in gates[gate_id].get('dependsOn', []):
            if dep_id not in dates or fallback <= dates[dep_id][0] or target <= dates[dep_id][1]:
                fail(gate_id + ': schedule dates must increase after dependencies')

    # Every attempt is immutable by pinned bytes and by append-only comparison
    # with ALL reachable plan versions, including after a deletion was committed.
    attempts_by_test = {}
    receipt_data = {}
    for test_id, test in tests.items():
        attempts = array(test.get('attempts'), test_id + ' attempts')
        attempts_by_test[test_id] = attempts
        ids, paths = set(), set()
        for attempt in attempts:
            if not isinstance(attempt, dict):
                fail(test_id + ': malformed attempt')
                continue
            attempt_id, relative = attempt.get('id'), attempt.get('receipt')
            if not nonblank(attempt_id) or attempt_id in ids or not nonblank(relative) or relative in paths:
                fail(test_id + ': attempt IDs and receipt paths must be unique')
                continue
            ids.add(attempt_id); paths.add(relative)
            status = attempt.get('status')
            if status not in ('passed', 'failed'):
                fail(test_id + ': attempt must record passed or failed')
                continue
            pinned_file({'path': relative, 'sha256': attempt.get('sha256')}, test_id + ' attempt')
            if test.get('kind') == 'runtime':
                data = runtime_receipt(relative, test_id, status)
                if data:
                    receipt_data[(test_id, relative)] = data
        if test.get('status') in ('passed', 'failed') and not attempts:
            fail(test_id + ': executed test requires retained attempts')
        for relative in test.get('receipts', []):
            found = [a for a in attempts if isinstance(a, dict) and a.get('receipt') == relative]
            if not found or found[0].get('status') != test.get('status'):
                fail(test_id + ': current receipt must identify an attempt with matching status')
        if test.get('status') == 'failed' and not test.get('receipts'):
            fail(test_id + ': failed test requires current failure receipt')
    try:
        shallow = subprocess.run(['git', '-C', str(root), 'rev-parse', '--is-shallow-repository'],
                                 capture_output=True, text=True, timeout=10, check=True)
        if shallow.stdout.strip() != 'false':
            fail('attempts: complete Git history is required to verify immutability')
        history = subprocess.run(['git', '-C', str(root), 'log', '--full-history', '--format=%H', '--', relative_plan],
                                 capture_output=True, text=True, timeout=20, check=True).stdout.splitlines()
        seen_histories = set()
        for commit in history:
            old_bytes = subprocess.run(['git', '-C', str(root), 'show', f'{commit}:{relative_plan}'],
                                       capture_output=True, timeout=10, check=False)
            if old_bytes.returncode:  # A historical deletion is not an empty history.
                continue
            old_plan = json.loads(old_bytes.stdout)
            for test_id, old_test in old_plan.get('tests', {}).items():
                old_attempts = old_test.get('attempts', [])
                signature = (test_id, digest(old_attempts))
                if old_attempts and signature not in seen_histories:
                    seen_histories.add(signature)
                    if attempts_by_test.get(test_id, [])[:len(old_attempts)] != old_attempts:
                        fail(test_id + ': immutable attempt history was removed, reordered or changed')
    except (OSError, ValueError, subprocess.SubprocessError):
        fail('attempts: cannot verify reachable Git history')

    waivers = {}
    waiver_times = {}
    for waiver in array(plan.get('waivers'), 'waivers'):
        if not isinstance(waiver, dict):
            fail('waivers: malformed waiver')
            continue
        test_id, gate_id = waiver.get('test'), waiver.get('gate')
        if not isinstance(test_id, str) or not isinstance(gate_id, str):
            fail('waivers: missing test/gate')
            continue
        key = (gate_id, test_id)
        if key in waivers or test_id not in gates.get(gate_id, {}).get('tests', []):
            fail('waivers: duplicate or unrelated test/gate')
        waivers[key] = waiver
        if not nonblank(waiver.get('reason')):
            fail('waivers: explicit reason required')
        if tests.get(test_id, {}).get('status') == 'passed':
            fail('waivers: waived test must remain honestly open, not passed')
        claims = array(waiver.get('claimRemovedFrom'), 'waivers claimRemovedFrom')
        if not claims:
            fail('waivers: explicit removed claim evidence required')
        for claim in claims:
            if not isinstance(claim, dict) or not nonblank(claim.get('claim')):
                fail('waivers: missing explicit removed claim')
                continue
            before = pinned_file(claim.get('before'), 'waiver claim before')
            after = pinned_file(claim.get('after'), 'waiver claim after')
            try:
                if (not before or not after or before == after or
                        claim['claim'] not in before.read_text(encoding='utf-8') or
                        claim['claim'] in after.read_text(encoding='utf-8')):
                    fail('waivers: named claim must exist before and be absent from current claim document')
            except (OSError, UnicodeError):
                fail('waivers: claim evidence must be UTF-8 text')
        subject = {k: waiver.get(k) for k in ('test', 'gate', 'reason', 'claimRemovedFrom')}
        waiver_times[key] = approval(waiver.get('approvedBy'), subject, 'waiver ' + gate_id + '/' + test_id, owner_only=True)

    rc = plan.get('releaseCandidate')
    if not isinstance(rc, dict) or rc.get('status') not in ('pending', 'pinned'):
        fail('releaseCandidate: requires explicit pending/pinned state')
        rc = {}
    if rc.get('status') == 'pending' and ('commit' not in rc or rc['commit'] is not None):
        fail('releaseCandidate: pending commit must be explicit null')
    if rc.get('status') == 'pinned':
        sha = rc.get('commit')
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{40}', sha):
            fail('releaseCandidate: must pin full commit SHA')
        else:
            try:
                result = subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', sha, 'HEAD'],
                                        capture_output=True, timeout=10, check=False)
                if result.returncode:
                    fail('releaseCandidate: commit is not a verified ancestor of HEAD')
            except (OSError, subprocess.SubprocessError):
                fail('releaseCandidate: cannot verify commit ancestry')

    completion_times = {}
    for gate_id, gate in gates.items():
        if gate.get('status') != 'complete':
            continue
        completion_times[gate_id] = timestamp(gate.get('completedAt'), gate_id + ' completion')
        evidence = array(gate.get('evidence'), gate_id + ' evidence')
        expected = set(gate.get('tests', [])) - {t for g, t in waivers if g == gate_id}
        if any(tests.get(test_id, {}).get('status') != 'passed' for test_id in expected):
            fail(gate_id + ': complete without passed tests or explicit owner waivers')
        actual, producers, times = set(), [], []
        pins = []
        for relative in evidence:
            matches = [(t, data) for (t, r), data in receipt_data.items() if r == relative and t in expected and data.get('status') == 'passed']
            if len(matches) != 1:
                fail(gate_id + ': gate evidence must equal its exact test receipts (retained passed attempts)')
                continue
            test_id, data = matches[0]
            actual.add(test_id)
            producers.append(data['agent'] if isinstance(data.get('agent'), dict) else {})
            pins.append({'path': relative, 'sha256': hashlib.sha256((root / relative).read_bytes()).hexdigest()})
            review = data['review'] if isinstance(data.get('review'), dict) else {}
            for field_value in (data.get('runAt'), review.get('reviewedAt')):
                time = timestamp(field_value, gate_id + ' evidence')
                if time:
                    times.append(time)
            if gate_id == 'GF5':
                gf4 = gates.get('GF4', {})
                gf4_time = timestamp(gf4.get('completedAt'), 'GF5 GF4 completion') if gf4.get('status') == 'complete' else None
                run_at = timestamp(data.get('runAt'), 'GF5 receipt')
                if not gf4_time or not run_at or run_at <= gf4_time or not gf4.get('approvedBy') or not gf4.get('evidence'):
                    fail('GF5: receipts must run after evidenced GF4 completion')
                if rc.get('status') != 'pinned' or data.get('codeCommit') != rc.get('commit'):
                    fail('GF5: every receipt must use exact releaseCandidate.commit')
        if actual != expected:
            fail(gate_id + ': complete without passed tests or explicit owner waivers')
        if len(evidence) != len(set(map(str, evidence))) or (not evidence and expected):
            fail(gate_id + ': complete without evidence or with duplicate evidence')
        times.extend(t for (g, _), t in waiver_times.items() if g == gate_id and t)
        if gate_id == 'GF5':
            if rc.get('status') != 'pinned':
                fail('GF5: completion requires a pinned release candidate')
            gf4 = gates.get('GF4', {})
            if gf4.get('status') != 'complete' or not gf4.get('approvedBy') or not gf4.get('evidence') or not gf4.get('completedAt'):
                fail('GF5: completion requires evidenced GF4 completion even with waivers')
        subject = {'gate': gate_id, 'tests': gate.get('tests'), 'evidence': pins,
                   'waivers': [w for (g, _), w in waivers.items() if g == gate_id],
                   'completedAt': gate.get('completedAt'),
                   'releaseCandidate': rc.get('commit') if gate_id == 'GF5' else None}
        approved_at = approval(gate.get('approvedBy'), subject, gate_id,
                               owner_only=gate_id == 'GF5', producers=producers,
                               after=max(times) if times else None)
        completed_at = completion_times[gate_id]
        if completed_at and approved_at and completed_at < approved_at:
            fail(gate_id + ': completion predates approval')
    for gate_id, completed_at in completion_times.items():
        for dep_id in gates[gate_id].get('dependsOn', []):
            dep_time = completion_times.get(dep_id)
            if completed_at and dep_time and completed_at < dep_time:
                fail(gate_id + ': completion predates dependency completion')
