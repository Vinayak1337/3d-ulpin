import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PropertyCard } from '@ulpin/ui';
import { DRAFT_MADE, DRAFT_ON_THIS_DEVICE } from './draft';
import { DraftCard } from './DraftCard';

const CARD = {
  title: 'Unit, Building', code: 'P3-0123456789ABCDEFGHJK-7M', location: null,
  facts: [{ label: DRAFT_MADE, value: 'a day' }],
};

describe('DraftCard', () => {
  const markup = renderToStaticMarkup(
    <DraftCard {...CARD} revision={3} hash={'ab'.repeat(32)} chain="unknown" link="http://localhost/verify/x" />,
  );

  it('carries no "Assigned": the code is labelled Draft and the day is the day the draft was made', () => {
    expect(markup).not.toContain('Assigned');
    expect(markup).toContain('3D ULPIN (proposed) · Draft');
    expect(markup).toContain(DRAFT_MADE);
  });

  it('says what it is in its first row and names the chain as the check of this browser', () => {
    expect(markup).toContain(DRAFT_ON_THIS_DEVICE);
    expect(markup).toContain('Local chain not checked');
    expect(markup).not.toContain('Chain consistent');
  });

  it('leaves a card that is given no state as it was', () => {
    const plain = renderToStaticMarkup(<PropertyCard {...CARD} revision="r3" hash="abab" chain="c" qr={null} />);
    expect(plain).toContain('3D ULPIN (proposed) · Assigned');
  });
});
