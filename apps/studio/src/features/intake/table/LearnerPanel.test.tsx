import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf-agent/ui/f2b/responses.json';
import { LearnerPanel } from './LearnerPanel';
import type { ChunkMapping, Metrics } from './types';

const metrics = (controls.files[0]!.chunk.payload.mapping as ChunkMapping).metrics;

it('marks the teacher fields of an older chunk with no teacher call as fallback, in its own cell', () => {
  const old: Metrics = { ...metrics, unansweredFields: undefined, teacherCalls: 0, teacherFields: 3 };
  const html = renderToStaticMarkup(<LearnerPanel chunks={[old]} />);
  expect(html).toContain('>3 fallback</td>');
  expect(html).toContain('Open questions: not read yet');
  expect(html).not.toContain('ul-help');
});
