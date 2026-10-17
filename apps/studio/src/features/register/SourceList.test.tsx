import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReadingStatementsContext } from './ReadingNote';
import { readingStatements } from './registerState';
import { SourceList, type ListedSource } from './SourceList';

const STATEMENT = 'Read by an earlier version of the document reader';
const listed = (sourceId: string): ListedSource => (
  { sourceId, kind: 'document', name: `${sourceId}.pdf`, file: `${sourceId}.pdf`, summary: 'p. 1' }
);

/** The markup of each listed source, in order. */
function rows(statements: ReturnType<typeof readingStatements>): string[] {
  const html = renderToStaticMarkup(
    <ReadingStatementsContext.Provider value={statements}>
      <SourceList sources={[listed('stated'), listed('silent')]} retained={new Map()} onOpen={() => {}} />
    </ReadingStatementsContext.Provider>,
  );
  return html.split('</li>').slice(0, 2);
}

describe('SourceList', () => {
  it('states a reading that is not current beside its source and adds nothing to a neighbour without one', () => {
    const [stated, silent] = rows(readingStatements([
      { id: 'stated', documentResult: { current: false, reasons: ['reader_changed'] } },
      { id: 'silent' },
    ]));
    expect(stated).toContain(`<span class="ul-caption">${STATEMENT}</span>`);
    expect(silent).toContain('silent.pdf');
    expect(silent).not.toContain(STATEMENT);
    // The neighbour's row is the one it has when the server states nothing about any source.
    expect(silent).toBe(rows(new Map())[1]);
  });
});
