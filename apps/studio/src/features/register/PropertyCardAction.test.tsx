import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import capturedConfirmation from '../../../../../docs/evidence/gf1/e3b/confirmation.json';
import type { Confirmation, Target } from '../intake/run/model';
import { PropertyCardAction, UNIT_BLOCKED, cardOffer, type CardOffer } from './PropertyCardAction';

// Captured from the run of 11 October (E3B): a building the batch recorded, carded and verified.
const carded = (capturedConfirmation as Confirmation).progress[0]! as Target;
// REH13 act 1 (docs/evidence/runtime/reh13/act1.json on task/reh13-rehearsal): the cited card 93fd4362 revision 1
// pins record a69cdab3 revision 2 through the evidence confirmation, while the target's record stays revision 1.
const cited: Target = { ...carded, artefacts: { ...carded.artefacts,
  record: { id: 'a69cdab3-1b02-4dc1-b5aa-a11e3632d36a', revision: 1 },
  card: { id: '93fd4362-041b-4708-b45c-b72b179a2277', revision: 1 },
  evidence: { confirmationIds: ['753777ea-97d0-45ad-b8a9-13fb0b971301'],
    record: { id: 'a69cdab3-1b02-4dc1-b5aa-a11e3632d36a', revision: 2 } } } };
// The same building recorded with its package and never carded.
const recorded: Target = { ...carded, stage: 3, readiness: 'recorded', confirmationId: null,
  reason: 'Recorded with its package; not listed for a card.', artefacts: { record: carded.artefacts.record } };

const shown = (offer: CardOffer) => renderToStaticMarkup(<MemoryRouter>
  <PropertyCardAction offer={offer} buildingName="1084419" onOpenUnit={() => {}} />
</MemoryRouter>);
/** The words a reader sees: the markup without its tags and React's text separators. */
const words = (markup: string) => markup.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');

describe('the record page Property Card', () => {
  it('a building with a card shows that card, its revision and the record revision it cites; no blocked line', () => {
    const offer = cardOffer({ unitSelected: false, unitCode: null, registryCard: false, target: cited });
    expect(offer).toMatchObject({ kind: 'building', recordRevision: 2,
      card: { id: '93fd4362-041b-4708-b45c-b72b179a2277', revision: 1 } });
    const markup = shown(offer);
    expect(words(markup)).toContain('Card 93fd4362 · revision 1 · cites record revision 2');
    expect(markup).toContain('title="93fd4362-041b-4708-b45c-b72b179a2277"');
    expect(markup).toMatch(/<button[^>]*>.*Property Card<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled/);
    expect(markup).not.toContain(UNIT_BLOCKED);
  });

  it('a card made with no confirmed evidence cites the revision its target records', () => {
    const offer = cardOffer({ unitSelected: false, unitCode: null, registryCard: false, target: carded });
    expect(offer).toMatchObject({ kind: 'building', recordRevision: 1, card: carded.artefacts.card });
    expect(words(shown(offer))).toContain(`Card ${carded.artefacts.card!.id.slice(0, 8)} · revision 1 · cites record revision 1`);
  });

  it('a building with no card and no unit code keeps the blocked line and a disabled button', () => {
    for (const target of [recorded, null, undefined]) {
      const offer = cardOffer({ unitSelected: false, unitCode: null, registryCard: false, target });
      expect(offer).toEqual({ kind: 'blocked', words: UNIT_BLOCKED });
      const markup = shown(offer);
      expect(markup).toContain('Select a unit with a proposed code');
      expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Property Card<\/button>/);
      expect(markup).not.toContain('cites record revision');
    }
  });

  it('a selected unit keeps its own card flow: blocked without a code, open with a code or a listed card', () => {
    expect(cardOffer({ unitSelected: true, unitCode: null, registryCard: false, target: cited }))
      .toEqual({ kind: 'blocked', words: 'Assign a proposed code first' });
    expect(cardOffer({ unitSelected: true, unitCode: 'code', registryCard: false, target: null })).toEqual({ kind: 'unit' });
    expect(cardOffer({ unitSelected: true, unitCode: null, registryCard: true, target: null })).toEqual({ kind: 'unit' });
  });
});
