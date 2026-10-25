import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PREPARE_STORES, Prepared } from './IssueCardDialog';
import type { IssueFlow } from './useIssueFlow';

// A flow before Prepare is pressed: nothing answered, nothing stored.
const before = {
  answered: {}, prepared: null, issue: { isSuccess: false, data: undefined }, found: null, stopped: null,
  failure: null, readError: null, again: false, busy: false,
} as unknown as IssueFlow;

describe('IssueCardDialog before Prepare', () => {
  it('says what Prepare stores on a first card and on a new revision', () => {
    const render = (first: boolean) =>
      renderToStaticMarkup(<Prepared flow={before} first={first} sent={null} form={null} />);
    expect(render(true)).toContain(PREPARE_STORES.first);
    expect(render(false)).toContain(PREPARE_STORES.next);
  });
});
