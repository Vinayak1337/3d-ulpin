import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import live from '../../../../../docs/evidence/gf5/f3d/responses.json';
import type { CardVerification } from '../../api/queries';
import { CARD_STATEMENT, Report } from './CardVerificationPage';

describe('CardVerificationPage', () => {
  it('prints the card statement under the verdict', () => {
    const markup = renderToStaticMarkup(<Report report={live.verification.data as CardVerification} />);
    expect(markup).toContain(CARD_STATEMENT);
    expect(markup.indexOf(CARD_STATEMENT)).toBeLessThan(markup.indexOf('Property card verification'));
    expect(markup).toContain('<h1 class="ul-title">Property card verification</h1>');
  });
});
