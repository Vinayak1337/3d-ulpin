#!/usr/bin/env python3
"""Regenerate the readable backlog from its JSON source. No project or network access."""
from pathlib import Path
import json

def render_task(task: dict, root: Path) -> str:
    """Render both original epic tasks and later, sparse historical records."""
    lines=[f"### {task['id']} — {task['title']}"]
    status=f"**Status:** {task['status']}."
    for key, label in [('release', 'Release'), ('suggested_owner', 'Suggested owner')]:
        if key in task:
            status+=f" **{label}:** {task[key]}."
    lines.append(status)
    lines.append(f"\n**Dependencies:** {', '.join(task['depends_on']) or 'None; environment and authorization requirements still apply'}.")
    for key, label in [('scope', 'Scope'), ('scope_note', 'Scope note'),
                       ('outputs', 'Outputs'), ('acceptance', 'Acceptance'),
                       ('out_of_scope', 'Excluded')]:
        if key in task:
            lines.append(f"\n**{label}:** {task[key]}")
    if 'legacy_refs' in task:
        lines.append(f"\n**Earlier references:** {', '.join(task['legacy_refs']) or 'New explicit user/architecture requirement'}.")
    plan=task.get('detail_plan_path') or task.get('plan_path')
    if plan:
        state='authored; inspect its status before execution' if (root/plan).is_file() else 'write just before execution'
        lines.append(f"\n**Detailed plan:** `{plan}` — {state}.")
    else:
        lines.append('\n**Detailed plan:** No path recorded.')
    for key, label in [('sequence', 'Recorded sequence'), ('planning_reference', 'Planning reference'),
                       ('execution_state', 'Recorded execution state'), ('result_path', 'Recorded result')]:
        if key in task:
            lines.append(f"\n**{label}:** `{task[key]}`.")
    if task.get('evidence'):
        lines.append('\n**Recorded evidence:** '+', '.join(f'`{path}`' for path in task['evidence'])+'.')
    return '\n'.join(lines)+'\n'


def render_backlog(board: dict, root: Path) -> str:
    epic_ids={epic['id'] for epic in board['epics']}
    for task in board['tasks']:
        if task.get('epic') is not None and task['epic'] not in epic_ids:
            raise ValueError(f"Unknown epic {task['epic']} for {task['id']}")
    accepted=sum(x['status']=='Accepted' for x in board['tasks'])
    chunks=[f'# Ordered task backlog\n\nGenerated from `backlog.json`, plan version {board["plan_version"]}. Accepted execution tasks: {accepted}/{len(board["tasks"])}. A mapping or detailed plan is not implementation evidence. Future plan paths are reserved until authored.\n']
    for e in board['epics']:
        chunks.append(f'## {e["id"]} — {e["name"]}\nExit: {e["exit"]}\n')
        for t in board['tasks']:
            if t.get('epic')!=e['id']: continue
            chunks.append(render_task(t,root))
    unassigned=[task for task in board['tasks'] if task.get('epic') is None]
    if unassigned:
        chunks.append('## Historical tasks without an epic assignment\n\nThese records retain their supplied metadata; no epic or acceptance is inferred.\n')
        chunks.extend(render_task(task,root) for task in unassigned)
    chunks.append('## Separate maintenance\n')
    for t in board['maintenance']:
        chunks.append(f'### {t["id"]} — {t["title"]}\nStatus: {t["status"]}. Exact target: `{t["authorized_target"]}`.\n\n{t["boundary"]}\n\nDoes not block product tasks. Plan: `{t["plan_path"]}`.\n')
    return '\n'.join(chunks)


def main() -> None:
    root=Path(__file__).resolve().parents[1]
    board=json.loads((root/'backlog.json').read_text(encoding='utf-8'))
    (root/'05_TASK_BACKLOG.md').write_text(render_backlog(board,root),encoding='utf-8',newline='\n')
    print('Updated 05_TASK_BACKLOG.md from backlog.json')

if __name__=='__main__': main()
