import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceStatedRecordSchema } from '@ulpin/contracts';
import { ProjectLocationSchema, verticalLocator,
  type ProjectLocation } from '../../../../../contracts/src/usp/project-identity';
import { UspPropertyCardFactSchema } from '../../../../../contracts/src/usp/property-card';
import { fingerprint } from '../../cases/domain';
import { generatePropertyCard } from './card-service';
import { verifyPropertyCard } from './card-verification';
import { planId, withCardStore } from './card-verification.test-fixture';
import { cardLinkLines, FACT_STATE_LEAD, inWords, levelOrdinalSentence, locationSentence,
  printedFact } from './card-wording';

const locator = { structureKind: 'S', structureNumber: 1, levels: ['G'], spaceKind: 'R', spaceNumber: 1 };
const source = { sourceId: '00000000-0000-4000-8000-000000000002', revision: 1, locator: 'CSV row 1' };
// Rows as the projection wrote them before these words, for a stored card that keeps them.
const EARLIER_FACTS = [
  { key: 'vertical_locator', label: 'Recorded location', state: 'available', value: 'NO-ANCHOR / ?01 / L? / ?001',
    reasonCode: null },
  { key: 'source_space_label', label: 'Space label (source literal)', state: 'available',
    value: 'UNIT-3B; officer-entered, not a boundary', reasonCode: null },
  { key: 'rights', label: 'Rights / title / issuance', state: 'not_assessed',
    value: 'No ownership, title, legality or official issuance determination', reasonCode: 'rights_not_assessed' },
].map(fact => UspPropertyCardFactSchema.parse(fact));

test('a locator with a known level and known kinds prints them as the record states them', () => {
  const known = ProjectLocationSchema.parse({ anchorState: 'not_supplied', parcels: [], locator });
  const twoLevels = ProjectLocationSchema.parse({ ...known, locator: { ...locator, levels: ['F07', 'L?'] } });

  assert.equal(locationSentence(known),
    'No parcel anchor supplied. Structure 1, kind S; level G; space 1, kind R. (Locator: NO-ANCHOR / S01 / G / R001)');
  assert.match(locationSentence(twoLevels), /; levels F07 and not recorded; .*\(Locator: NO-ANCHOR \/ S01 \/ F07-L\? /);
});

test('a number beside an unknown kind prints as the record states it, and the formal locator ends the row', () => {
  const stored = ProjectLocationSchema.parse({ anchorState: 'not_supplied', parcels: [],
    locator: { structureKind: '?', structureNumber: 1, levels: ['L?'], spaceKind: '?', spaceNumber: 1 } });

  assert.equal(locationSentence(stored), 'No parcel anchor supplied. Structure 1, kind not recorded; '
    + 'level not recorded; space 1, kind not recorded. (Locator: NO-ANCHOR / ?01 / L? / ?001)');
  assert(locationSentence(stored).endsWith(` (Locator: ${verticalLocator(stored)})`));
});

test('a locator without numbers prints two "number not recorded" clauses and no digit before the formal locator',
  () => {
    // The contract still requires both numbers; they become optional beside an unknown kind, hence the cast.
    const bare = { anchorState: 'not_supplied', parcels: [],
      locator: { structureKind: '?', levels: ['L?'], spaceKind: '?' } } as unknown as ProjectLocation;
    const [words, formal] = locationSentence(bare).split(' (Locator: ');

    assert.equal(words, 'No parcel anchor supplied. Structure number not recorded, kind not recorded; '
      + 'level not recorded; space number not recorded, kind not recorded.');
    assert.doesNotMatch(words, /\d|undefined/);
    assert.equal(formal, `${verticalLocator(bare)})`);
  });

test('a record that holds an anchor says so and says that the locator of this row leaves it out', () => {
  const parcel = { literalValue: 'CONTROL-PARCEL', role: 'primary', source, issuer: { state: 'unknown' },
    validity: { state: 'unknown' }, reviewState: 'supplied_unreviewed' };
  const supplied = ProjectLocationSchema.parse({ anchorState: 'supplied_unreviewed', parcels: [parcel], locator });

  assert.equal(locationSentence(supplied), 'Parcel anchor supplied, not reviewed. Structure 1, kind S; level G; '
    + 'space 1, kind R. (Locator, anchor left out: NO-ANCHOR / S01 / G / R001)');
});

test('every stored fact state has its printed word, and no fact prints a stored word as a value', () => {
  const states = UspPropertyCardFactSchema.unwrap().shape.state.options;
  const fact = (state: string, value: string | null) => UspPropertyCardFactSchema.parse({ key: 'k', label: 'Row',
    state, value, reasonCode: state === 'available' ? null : 'row_not_recorded' });

  assert.deepEqual(Object.keys(FACT_STATE_LEAD).sort(), [...states].sort());
  assert.equal(printedFact(fact('available', 'TOWER 3')), 'TOWER 3');
  assert.equal(printedFact(fact('unavailable', 'Not recorded for this space')),
    'Unavailable: Not recorded for this space');
  assert.equal(printedFact(fact('not_assessed', 'No determination')), 'Not assessed: No determination');
  assert.equal(printedFact(fact('unavailable', null)), 'Unavailable: reason code row_not_recorded');
  assert.equal(inWords('cancelled_error'), 'cancelled error');
});

test('the floor clause is written only for a floor segment, and the QR address is the encoded string in parts',
  () => {
    const url = 'http://127.0.0.1:3194/api/v1/usp/property-cards/6a997624-6c8d-40a9-8215-8a671a74dc1c/revisions/1';
    const { caption, address } = cardLinkLines(url);

    assert.equal(levelOrdinalSentence(null), 'Not recorded; the floor caption is only a literal');
    assert.match(levelOrdinalSentence('F001'), /\. F001 in the registry identifier is a record sequence, not a floor/);
    assert.equal(address.join(''), url);
    assert.deepEqual(address.map(part => part.length <= 48), [true, true, true]);
    assert.deepEqual(caption, ['Opens this card revision as a PDF,', 'only on the machine that made it:']);
  });

test('a source-stated record holds an actor and no role: a new field there must reach the label wording', () => {
  const decision = SourceStatedRecordSchema.shape.sourceOnly.shape.decision;

  assert.deepEqual(Object.keys(decision.shape).sort(), ['actor', 'reason', 'time']);
  assert.equal(SourceStatedRecordSchema.shape.sourceOnly.shape.transcription.value, 'officer_entered');
});

test('a card made before this change still verifies consistent: its stored words are compared with nothing',
  () => withCardStore(async (store, ctx) => {
    const guard = { mode: 'create', requestKey: 'card-create' };
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const made = await generatePropertyCard(ctx, { planId, planVersion: 1, cardId: null, expiresAt, guard }, store.io);
    store.alter(1, row => {
      const { cardSha256: _, ...body } = row.body;
      const earlier = { ...body, facts: EARLIER_FACTS };
      return { ...row, body: { ...earlier, cardSha256: fingerprint(earlier) } };
    });
    const { report } = await verifyPropertyCard(ctx, { cardId: made.cardId, revision: 1 }, store.io);

    assert.notDeepEqual(made.facts, EARLIER_FACTS);
    assert.equal(report.result, 'consistent');
    assert.deepEqual(report.checks.map(check => check.state), Array(6).fill('pass'));
  }));
