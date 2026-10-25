import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CandidateCard } from './model';
import { PlanLocalPanel } from './PlanLocalPanel';

const room = (id: string, x: number): CandidateCard => ({
  id, title: `Room ${id}`, frame: 'panel-1', levelLiteral: 'FIXTURE FLOOR PLAN',
  polygons: [[[[x, 0], [x + 3, 0], [x + 3, 4], [x, 4], [x, 0]]]],
} as CandidateCard);

describe('PlanLocalPanel', () => {
  const markup = renderToStaticMarkup(
    <PlanLocalPanel cards={[room('a', 0), room('b', 3)]} selectedId="a" onSelect={() => undefined} />,
  );

  it('shows beside its title that the rooms are in plan metres and not on the map', () => {
    expect(markup).toContain('Plan metres, not on the map');
  });

  it('names the room count and plan metres to a screen reader', () => {
    expect(markup).toContain('aria-label="2 room candidates of FIXTURE FLOOR PLAN, in plan metres"');
  });
});
