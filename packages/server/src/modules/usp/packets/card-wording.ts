import { verticalLocator, type ProjectLocation } from '../../../../../contracts/src/usp/project-identity';
import type { PropertyCard, PropertyCardFact } from '../../../../../contracts/src/usp/property-card';

/**
 * Every sentence of a property card that is not read from a record. The projection and both renderers take their
 * words from here, so a card says the same thing in either profile. The words apply to cards made from now on: a
 * stored card keeps the words of its own body and bytes, and no read or verification compares them with these.
 */

type Heading = Pick<PropertyCard, 'revision' | 'scope'>;
type Footer = Pick<PropertyCard, 'cardId' | 'revision' | 'planId' | 'planVersion' | 'packetId' | 'packetSha256'
  | 'evidenceEntrySha256' | 'omissions' | 'snapshotCapturedAt' | 'expiresAt'>;

/** What leads the value of a fact in each stored state. Total over the state enum: a new state does not compile
 * without its word, and card-wording.test.ts compares these keys with the published enum. */
export const FACT_STATE_LEAD: Record<PropertyCardFact['state'], string> = {
  available: '',
  unavailable: 'Unavailable: ',
  not_assessed: 'Not assessed: ',
};

const ANCHOR_SENTENCE: Record<ProjectLocation['anchorState'], string> = {
  not_supplied: 'No parcel anchor supplied.',
  supplied_unreviewed: 'Parcel anchor supplied, not reviewed.',
  reviewed_partial: 'Parcel anchor reviewed in part.',
  reviewed_complete: 'Parcel anchor reviewed.',
  conflicting: 'Parcel anchor in conflict.',
  withdrawn: 'Parcel anchor withdrawn.',
};

/** A source-stated record holds the subject that recorded it and no role, so the label row names no officer. */
export const SOURCE_LABEL_NOTE = 'entered by the recording operator from the cited source region; not a boundary';

/** A stored enum word in plain words: its underscores become spaces. It adds no meaning the record lacks. */
export function inWords(stored: string) {
  return stored.replace(/_/g, ' ');
}

/** A fact as the card prints it: the state in words, then the stored value. A fact stored without a value prints
 * its reason code, named as a code. */
export function printedFact(fact: PropertyCardFact) {
  return `${FACT_STATE_LEAD[fact.state]}${fact.value ?? `reason code ${fact.reasonCode}`}`;
}

/** Whether the record holds a parcel anchor, in words. */
export function anchorSentence(state: ProjectLocation['anchorState']) {
  return ANCHOR_SENTENCE[state];
}

function kindClause(kind: string) {
  return kind === '?' ? 'kind not recorded' : `kind ${kind}`;
}

/** A structure or a space by its number, then its kind. A number the locator holds is printed as the record
 * states it, with no word on where it came from. A locator may hold no number beside an unknown kind; the clause
 * then says that the number is not recorded, so the structure and the space are still named. */
function numberedClause(part: 'Structure' | 'space', number: number | undefined, kind: string) {
  const numbered = number === undefined ? `${part} number not recorded` : `${part} ${number}`;
  return `${numbered}, ${kindClause(kind)}`;
}

function levelClause(levels: readonly string[]) {
  const stated = levels.map(level => (level === 'L?' ? 'not recorded' : level));
  return `${levels.length > 1 ? 'levels' : 'level'} ${stated.join(' and ')}`;
}

/**
 * The recorded location in words, one clause for each field of the locator, with the formal locator kept at the
 * end as verticalLocator returns it. The card leaves parcels out of this row (they have a row of their own), so
 * the formal locator always starts with NO-ANCHOR; when the record does hold an anchor, the row says that it is
 * left out.
 */
export function locationSentence(location: ProjectLocation) {
  const { structureKind, structureNumber, levels, spaceKind, spaceNumber } = location.locator;
  const formal = verticalLocator({ ...location, anchorState: 'not_supplied', parcels: [] });
  const locator = location.anchorState === 'not_supplied' ? 'Locator' : 'Locator, anchor left out';
  return `${anchorSentence(location.anchorState)} ${numberedClause('Structure', structureNumber, structureKind)}; `
    + `${levelClause(levels)}; ${numberedClause('space', spaceNumber, spaceKind)}. (${locator}: ${formal})`;
}

/** Why a source-stated unit has no level ordinal. The floor segment of its registry identifier counts the floor
 * records of the building, and the row says so when the card prints such a segment. */
export function levelOrdinalSentence(floorSegment: string | null) {
  const sentence = 'Not recorded; the floor caption is only a literal';
  if (!floorSegment) return sentence;
  return `${sentence}. ${floorSegment} in the registry identifier is a record sequence, not a floor number`;
}

export function cardHeading(card: Heading) {
  return {
    title: 'Property card',
    revision: `PRIVATE - Exact card revision ${card.revision} - ${card.scope.stage} snapshot`,
    disclaimer: 'Application summary. No official ULPIN issuance, title or legal approval is implied.',
  };
}

export function cardFooterLines(card: Footer) {
  return [
    `Card: ${card.cardId} / ${card.revision}`,
    `Plan: ${card.planId} / ${card.planVersion}`,
    `Packet: ${card.packetId}`,
    `Included entries: ${card.evidenceEntrySha256.length}; optional omissions: ${card.omissions.length}`,
    `Snapshot captured: ${card.snapshotCapturedAt}`,
    `Card expires: ${card.expiresAt}`,
    'Packet SHA-256 (byte consistency):',
    card.packetSha256,
    'Snapshot facts are fixed; current record revisions may differ.',
    'The detail packet remains separately authorized.',
  ];
}

/**
 * The lines under the QR: what it opens, then the exact string it encodes, cut before and after the card id so
 * each part fits the width of the QR. The address is a loopback address, so only the machine that made the card
 * answers there.
 */
export function cardLinkLines(resolverUrl: string) {
  const parts = /^(.+\/property-cards\/)([^/]+)(\/revisions\/.+)$/.exec(resolverUrl);
  return {
    caption: ['Opens this card revision as a PDF,', 'only on the machine that made it:'],
    address: parts ? parts.slice(1) : [resolverUrl],
  };
}
