#!/usr/bin/env python3
"""Regenerate the readable backlog from its JSON source. No project or network access."""
from pathlib import Path
import json

def main() -> None:
    root=Path(__file__).resolve().parents[1]
    board=json.loads((root/'backlog.json').read_text(encoding='utf-8'))
    accepted=sum(x['status']=='Accepted' for x in board['tasks'])
    chunks=[f'# Ordered task backlog\n\nGenerated from `backlog.json`, plan version {board["plan_version"]}. Accepted execution tasks: {accepted}/{len(board["tasks"])}. A mapping or detailed plan is not implementation evidence. Future plan paths are reserved until authored.\n']
    for e in board['epics']:
        chunks.append(f'## {e["id"]} — {e["name"]}\nExit: {e["exit"]}\n')
        for t in board['tasks']:
            if t['epic']!=e['id']: continue
            chunks.append(f'''### {t['id']} — {t['title']}
**Status:** {t['status']}. **Release:** {t['release']}. **Suggested owner:** {t['suggested_owner']}.

**Dependencies:** {', '.join(t['depends_on']) or 'None; environment and authorization requirements still apply'}.

**Scope:** {t['scope']}

**Outputs:** {t['outputs']}

**Acceptance:** {t['acceptance']}

**Excluded:** {t['out_of_scope']}

**Earlier references:** {', '.join(t['legacy_refs']) or 'New explicit user/architecture requirement'}.

**Detailed plan:** `{t['detail_plan_path']}` — {'authored; inspect its status before execution' if (root/t['detail_plan_path']).is_file() else 'write just before execution'}.
''')
    chunks.append('## Separate maintenance\n')
    for t in board['maintenance']:
        chunks.append(f'### {t["id"]} — {t["title"]}\nStatus: {t["status"]}. Exact target: `{t["authorized_target"]}`.\n\n{t["boundary"]}\n\nDoes not block product tasks. Plan: `{t["plan_path"]}`.\n')
    (root/'05_TASK_BACKLOG.md').write_text('\n'.join(chunks),encoding='utf-8',newline='\n')
    print('Updated 05_TASK_BACKLOG.md from backlog.json')

if __name__=='__main__': main()
