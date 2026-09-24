import type { MouseEventHandler, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

export interface EvidenceChipProps {
  /** Document or dataset name, shown bold: "Sanctioned plan", "unit_inventory.xlsx", "Estimated". */
  source?: string;
  /** Page, row, clause or feature, then revision: "p.3 · r2", "row 41", "cl.2". */
  locator?: ReactNode;
  /** `linked` (solid), `estimated` (dashed outline, derived from the source) or `missing` (amber; doubles as a Request evidence action). */
  state?: 'linked' | 'estimated' | 'missing';
  /** What kind of source: a document page, a table row, a map feature. Sets the icon. */
  kind?: 'document' | 'table' | 'feature';
  /** Override the icon. */
  icon?: IconName;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}

const KIND_ICON: Record<NonNullable<EvidenceChipProps['kind']>, IconName> = {
  document: 'file-text',
  table: 'list-checks',
  feature: 'map-trifold',
};

/**
 * A compact link from a value to its exact source (document, locator, revision). Pair one with every sourced value.
 */
export function EvidenceChip({ source, locator, state = 'linked', kind = 'document', icon, href, onClick }: EvidenceChipProps) {
  const ic = icon ?? (state === 'missing' ? 'warning' : state === 'estimated' ? 'ruler' : KIND_ICON[kind]);
  const cls = cx('ul-evid', state === 'estimated' && 'ul-evid--estimated', state === 'missing' && 'ul-evid--missing');
  const body = (
    <>
      <Icon name={ic} />
      {state === 'missing' && !source ? (
        (locator ?? 'Needs evidence')
      ) : (
        <>
          {source && <b>{source}</b>} {locator}
        </>
      )}
    </>
  );
  if (href || onClick) {
    return (
      <a className={cls} href={href ?? '#'} onClick={onClick}>
        {body}
      </a>
    );
  }
  return <span className={cls}>{body}</span>;
}
