import { describe, expect, it } from 'vitest';
import { EvidenceChip } from './EvidenceChip';

const props = { source: 'fixture', locator: 'p.2', onOpen: () => undefined };

describe('EvidenceChip button name', () => {
  it('takes an optional accessible name without changing the chip content or styling', () => {
    const unnamed = EvidenceChip(props);
    const named = EvidenceChip({ ...props, accessibleName: 'Open cited source fixture at p.2' });
    expect(named.type).toBe('button');
    expect(named.props['aria-label']).toBe('Open cited source fixture at p.2');
    expect(named.props.className).toBe(unnamed.props.className);
    expect(named.props.title).toBe(unnamed.props.title);
    expect(named.props.children).toEqual(unnamed.props.children);
    expect(named.props.onClick).toBe(props.onOpen);
  });

  it('leaves other buttons named by their existing visible text', () => {
    const chip = EvidenceChip(props);
    expect(chip.props['aria-label']).toBeUndefined();
    expect(chip.props.title).toBe('Open evidence: fixture · p.2');
  });

  it('does not add a button name to a static chip', () => {
    const chip = EvidenceChip({ source: props.source, accessibleName: 'Not a button' });
    expect(chip.type).toBe('span');
    expect(chip.props['aria-label']).toBeUndefined();
  });
});
