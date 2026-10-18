import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { runLayout } from './measure-a4d';

const layout = (root: string, variants: string | null) => ({
  variants, run: join(root, 'measurements/completed-v1'), input: join(root, 'inputs/completed-v1'),
  modelRoot: join(root, 'learner/one-arm-v1'), heldOut: join(root, 'heldout/completed-v1'),
});

test('without --variants every path is the A4d run, unchanged', () => {
  assert.deepEqual(runLayout(['node', 'measure-a4d.ts', '--check']),
    layout('E:/BhuAayam-data/task-data/a4d', null));
});

test('--variants passes the file and moves every new output under vt1', () => {
  const file = 'E:/BhuAayam-data/task-data/va2/variant-examples.jsonl';
  assert.deepEqual(runLayout(['node', 'measure-a4d.ts', '--variants', file]),
    layout('E:/BhuAayam-data/task-data/vt1', file));
});

test('--variants without a file is refused', () => {
  assert.throws(() => runLayout(['node', 'measure-a4d.ts', '--variants']), /A4D_VARIANTS_PATH_REQUIRED/);
  assert.throws(() => runLayout(['node', 'measure-a4d.ts', '--variants', '--check']), /A4D_VARIANTS_PATH_REQUIRED/);
});
