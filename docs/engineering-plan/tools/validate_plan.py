#!/usr/bin/env python3
"""Validate planning records only. Does not access the project, desktop, DB or network."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--planning-snapshot', action='store_true', help='Also assert that this initial package claims no completed implementation.')
    parser.add_argument('--write-report', action='store_true', help='Write PLAN_VALIDATION.json inside this plan folder.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    checks: list[str] = []
    def load(name: str):
        return json.loads((root / name).read_text(encoding='utf-8'))
    def check(condition: bool, description: str):
        if not condition:
            raise ValueError(description)
        checks.append(description)
    try:
        board=load('backlog.json'); cross=load('legacy_task_crosswalk.json')
        edge=load('edge_cases.json')['cases']; accept=load('acceptance_traceability.json')
        inputs=load('input_support_plan.json')['families']
        tasks=board['tasks']; maintenance=board['maintenance']
        indexed={x['id']:x for x in tasks + maintenance}
        check(len(indexed)==len(tasks)+len(maintenance),'Execution and maintenance IDs are unique')
        check(len({x['id'] for x in edge})==len(edge),'Edge-case IDs are unique')
        allowed={'Planned','Ready','In progress','Review','Verify','Accepted','Implemented','Blocked','Deferred'}
        check(all(x['status'] in allowed for x in indexed.values()),'Task statuses use the declared workflow')
        check(sum(x['status'] in {'In progress','Review','Verify'} for x in indexed.values()) <= board['wip_limit'], 'Active implementation WIP does not exceed its declared limit')
        check(all(d in indexed for x in indexed.values() for d in x.get('depends_on',[])),'All dependencies resolve')
        visited=set(); visiting=set()
        def visit(tid):
            if tid in visiting: raise ValueError('Dependency cycle at '+tid)
            if tid in visited: return
            visiting.add(tid)
            for dep in indexed[tid].get('depends_on',[]): visit(dep)
            visiting.remove(tid);visited.add(tid)
        for tid in indexed:visit(tid)
        checks.append('Dependency graph is acyclic')
        check(all(indexed[d].get('sequence',-1)<x['sequence'] for x in tasks for d in x.get('depends_on',[]) if d.startswith('T')),'Preferred execution order respects dependencies')
        check(all(x.get('evidence') and all(indexed[d]['status']=='Accepted' for d in x.get('depends_on',[])) for x in indexed.values() if x['status']=='Accepted'),'Any accepted tasks have evidence references and accepted prerequisites')
        check(all((root/x['detail_plan_path']).is_file() for x in tasks if x['detail_plan_exists']),'Detailed plans claimed as authored actually exist')
        old_schema=load('legacy/schema_tasks.json')['tasks'];old_renderer=load('legacy/renderer_tasks.json')['tasks']
        old_ids={f'schema:{x["id"]}' for x in old_schema}|{f'renderer:{x["id"]}' for x in old_renderer}
        maps=cross['mappings']
        check(len(maps)==len(old_ids) and {x['legacy_id'] for x in maps}==old_ids,'Every old schema/renderer task has one unambiguous crosswalk record')
        check(all(x['new_tasks'] and all(t in indexed for t in x['new_tasks']) for x in maps),'All legacy mapping targets resolve')
        check(all(set(x['legacy_refs'])=={m['legacy_id'] for m in maps if x['id'] in m['new_tasks']} for x in tasks),'Task-to-legacy and legacy-to-task mappings agree')
        old_tests=set(re.findall(r'^## (T\d\d) — ',(root/'legacy/schema_acceptance_tests.md').read_text(encoding='utf-8'),re.M))
        check({x['legacy_id'] for x in accept['schema_tests']}=={'schema-test:'+x for x in old_tests},'All 28 original schema tests remain traceable')
        eids={x['id'] for x in edge}
        check(all(x['edge_cases'] and all(e in eids for e in x['edge_cases']) for x in accept['schema_tests']),'Schema test-to-edge-case references resolve')
        check(all(all(t in indexed for t in x['tasks']) for x in edge),'All edge-case task references resolve')
        for kind,old_file in [('ui_gates','legacy/ui_gates.json'),('benchmarks','legacy/benchmarks.json')]:
            check({x['id'] for x in accept[kind]}=={x[0] for x in load(old_file)},f'Every original {kind} record is retained')
            check(all(all(t in indexed for t in x['tasks']) for x in accept[kind]),f'All {kind} task references resolve')
        check(all(x['tasks'] and all(t in indexed for t in x['tasks']) for x in accept['requirements']),'Product requirement-to-task references resolve')
        check({x['id'] for x in inputs}=={x['id'] for x in load('legacy/input_catalog.json')['categories']},'All 25 input families are retained')
        check(all(all(t in indexed for t in x['tasks']) for x in inputs),'All input profile task references resolve')
        check(all(hashlib.sha256((root/x['preserved_copy']).read_bytes()).hexdigest()==x['sha256'] for x in load('legacy/SOURCE_MANIFEST.json')),'Preserved legacy records match their source hashes')
        check(board['next_task'] in indexed,'Next task exists')
        core={x['id'] for x in tasks if x['release']!='R3-optional'}
        def ancestors(tid):
            acc=set()
            for d in indexed[tid].get('depends_on',[]): acc.add(d);acc|=ancestors(d)
            return acc
        check(all(not any(indexed[d].get('release')=='R3-optional' for d in ancestors(t)) for t in core),'No core-release task depends on optional expansion')
        check(not maintenance[0]['blocks_product_tasks'] and not any('M001' in ancestors(t) for t in core),'Proof cleanup is not a hidden product dependency')
        if args.planning_snapshot:
            check(len(tasks)==56 and len(maps)==81 and len(edge)==70,'Initial package counts: 56 execution tasks, 81 legacy task mappings, 70 edge cases')
            check(all(x['execution_state']=='not_started' and not x['evidence'] and x['status'] in {'Planned','Deferred'} for x in indexed.values()),'Initial planning snapshot contains no claimed implementation/test completion')
            check(all(not load('PLAN_STATUS.json')[k] for k in ['host_work_performed','repository_modified','application_tests_run','proofs_deleted']),'Planning status explicitly records no host/application work')
        result={'status':'PASS','kind':'planning_record_consistency_only','checks_passed':len(checks),'checks':checks,
                'not_verified':['Application code or behavior','Database migrations or integrity','Desktop access or deletion','Source-format parsing','Geodetic/geometry correctness','Actual renderer images or performance','Physical device accessibility','Complete prior conversation retrieval']}
        if args.write_report: (root/'PLAN_VALIDATION.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(result,indent=2));return 0
    except (OSError,ValueError,KeyError,TypeError) as exc:
        print(json.dumps({'status':'FAIL','kind':'planning_record_consistency_only','error':str(exc),'checks_before_failure':checks},indent=2));return 1

if __name__=='__main__':
    raise SystemExit(main())
