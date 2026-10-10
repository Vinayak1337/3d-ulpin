import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Cited, ReadingStatementsContext } from './ReadingNote';
import type { ReadingStatements } from './registerState';

const STATEMENT = 'Read by an earlier version of the document reader';
const CHIP = '<button type="button">plan.pdf</button>';
const STATED: ReadingStatements = new Map([['stated', STATEMENT]]);

/** The markup of one citation of a source, under what the server states about the building's readings. */
function cited(sourceId: string | null, statements: ReadingStatements = STATED): string {
  return renderToStaticMarkup(
    <ReadingStatementsContext.Provider value={statements}>
      <Cited sourceId={sourceId}><button type="button">plan.pdf</button></Cited>
    </ReadingStatementsContext.Provider>,
  );
}

describe('Cited', () => {
  it('puts what the server states about the cited source after its citation', () => {
    const html = cited('stated');
    expect(html).toContain(`${CHIP}<span class="ul-caption">${STATEMENT}</span>`);
  });

  it('leaves the citation exactly as it is when the server states nothing about its source', () => {
    expect(cited('silent')).toBe(CHIP);
    expect(cited(null)).toBe(CHIP);
    expect(cited('stated', new Map())).toBe(CHIP);
  });

  it('adds nothing outside a place that provides the statements', () => {
    expect(renderToStaticMarkup(<Cited sourceId="stated"><button type="button">plan.pdf</button></Cited>)).toBe(CHIP);
  });
});
