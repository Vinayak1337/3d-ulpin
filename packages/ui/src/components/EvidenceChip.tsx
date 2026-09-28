import { File, FileText, Table, MapPin, Question } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Icon } from './Icon';

export type EvidenceKind = 'document' | 'table' | 'feature' | 'pointer' | 'unknown';
const ICONS: Record<EvidenceKind, PhosphorIcon> = { document: FileText, table: Table, feature: MapPin, pointer: File, unknown: Question };

/**
 * Link from a value to its exact source. Dashed = estimate; amber `missing` doubles as Request evidence.
 * Renders a button when it opens the evidence viewer, else a static chip.
 */
export function EvidenceChip({ source, locator, exact, kind = 'document', state = 'linked', onOpen }: {
  source: string; locator?: string; /** The unrounded source value, shown on hover when the locator is rounded. */ exact?: string;
  kind?: EvidenceKind; state?: 'linked' | 'estimated' | 'missing'; onOpen?: () => void;
}) {
  const className = `ul-evid${state === 'estimated' ? ' ul-evid--estimated' : state === 'missing' ? ' ul-evid--missing' : ''}`;
  const content = (
    <>
      <Icon icon={state === 'missing' ? Question : ICONS[kind]} size={16} />
      <b>{source}</b>
      {locator ? <span>{locator}</span> : null}
    </>
  );
  const title = locator ? `${source} · ${exact ?? locator}` : source;
  return onOpen ? (
    <button type="button" className={className} onClick={onOpen} title={`Open evidence: ${title}`}>{content}</button>
  ) : (
    <span className={className} title={title}>{content}</span>
  );
}
