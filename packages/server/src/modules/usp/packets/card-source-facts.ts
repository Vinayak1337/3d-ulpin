import { SourceStatedRecordSchema } from '@ulpin/contracts';
import type { TargetPin } from '@ulpin/contracts/usp';
import { UspPropertyCardFactSchema, type PropertyCardFact } from '../../../../../contracts/src/usp/property-card';
import { conflict } from '../../../infrastructure/errors';
import { levelOrdinalSentence, SOURCE_LABEL_NOTE } from './card-wording';

type Member = { pin: TargetPin };
type Captured = (pin: TargetPin) => Promise<{ body: Record<string, any> }>;
const fact = (key: string, label: string, state: PropertyCardFact['state'], value: string | null,
  reasonCode: string | null) => UspPropertyCardFactSchema.parse({ key, label, state, value, reasonCode });
const available = (key: string, label: string, value: string) => fact(key, label, 'available', value, null);
const unavailable = (key: string, label: string, value: string, reasonCode: string) =>
  fact(key, label, 'unavailable', value, reasonCode);

async function parentBody(members: readonly Member[], captured: Captured, id: string) {
  const pin = members.map(member => member.pin).find(item => item.ref.namespace === 'registry_record'
    && item.ref.id === id);
  if (!pin) conflict('The recorded parent is not in the exact card snapshot.');
  return (await captured(pin!)).body;
}

/** The segment the floor record adds to the registry identifier this card prints, or null when it adds none. */
function floorSegment(target: Record<string, any>, floor: { identifier: string }) {
  const segment = floor.identifier.split(':').at(-1) ?? '';
  const printed = typeof target.identifier === 'string' && target.identifier.startsWith(`${floor.identifier}:`);
  return printed && /^F\d+$/.test(segment) ? segment : null;
}

/** Literals recorded for one source-only space, read only from the exact snapshot. */
export async function sourceStatedCardFacts(members: readonly Member[], captured: Captured,
  target: Record<string, any>): Promise<PropertyCardFact[]> {
  const space = SourceStatedRecordSchema.parse({ ...target.body, revision: target.revision });
  const floorRow = await parentBody(members, captured, space.sourceOnly.parentId);
  const floor = SourceStatedRecordSchema.parse({ ...floorRow.body, revision: floorRow.revision });
  const building = await parentBody(members, captured, space.sourceOnly.buildingId);
  if (space.kind !== 'space' || floor.kind !== 'floor' || floor.sourceOnly.buildingId !== space.sourceOnly.buildingId
    || building.kind !== 'building' || typeof building.body?.name !== 'string') {
    conflict('The recorded source-only hierarchy is unavailable.');
  }
  const evidence = space.sourceOnly.evidence;
  return [
    available('source_space_label', 'Space label (source literal)', `${space.name}; ${SOURCE_LABEL_NOTE}`),
    available('source_floor_label', 'Floor label (source literal)', `${floor.name}; a caption, not a level ordinal`),
    available('source_building', 'Building (recorded name)', building.body.name),
    available('source_citation', 'Source citation', `page ${evidence.page}; region pt [${evidence.region.join(', ')}]; `
      + `source ${evidence.sourceId} revision ${evidence.sourceRevision}; sha256 ${evidence.sourceSha256}`),
    unavailable('level_ordinal', 'Level ordinal', levelOrdinalSentence(floorSegment(target, floor)),
      'level_ordinal_not_recorded'),
    unavailable('use', 'Use / classification', 'Not recorded for this space', 'use_not_recorded'),
  ];
}
