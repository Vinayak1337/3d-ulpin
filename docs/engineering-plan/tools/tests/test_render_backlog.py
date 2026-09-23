"""Sparse historical tasks must remain visible without fabricating plan fields."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('render_backlog', ROOT/'tools/render_backlog.py')
RENDERER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDERER)


class RenderBacklogTest(unittest.TestCase):
    def test_current_board_keeps_every_task_once_and_does_not_mutate_records(self):
        board = json.loads((ROOT/'backlog.json').read_text())
        before = copy.deepcopy(board)
        rendered = RENDERER.render_backlog(board, ROOT)
        ids = re.findall(r'^### (\S+) — ', rendered, re.MULTILINE)
        expected = [task['id'] for task in board['tasks']+board['maintenance']]
        self.assertCountEqual(ids, expected)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(board, before)
        self.assertIn('Historical tasks without an epic assignment', rendered)
        self.assertIn('tasks/T093_RESULT.md', rendered)
        t075 = rendered.split('### T075 — ', 1)[1].split('### ', 1)[0]
        self.assertIn('**Planning reference:** `tasks/T074_REFERENCE_REPLICATION_PLAN.md`', t075)
        self.assertIn('**Recorded sequence:** `75`', t075)

    def test_sparse_record_preserves_plan_alias_and_explicit_unknowns(self):
        task = dict(id='T999', title='Retained record', status='Planned',
                    depends_on=[], plan_path='plan.md', scope_note='Known scope')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'plan.md').write_text('Retained plan')
            rendered = RENDERER.render_task(task, root)
            self.assertIn('`plan.md` — authored', rendered)
            self.assertIn('Known scope', rendered)
            self.assertNotIn('**Acceptance:**', rendered)
            self.assertNotIn('**Release:**', rendered)
            del task['plan_path']
            self.assertIn('No path recorded', RENDERER.render_task(task, root))

    def test_unknown_epic_fails_instead_of_silently_omitting_task(self):
        board = dict(epics=[], tasks=[dict(id='T999', epic='missing')])
        with self.assertRaisesRegex(ValueError, 'Unknown epic missing for T999'):
            RENDERER.render_backlog(board, ROOT)


if __name__ == '__main__':
    unittest.main()
