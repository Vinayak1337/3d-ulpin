import { Buildings, FileText, ListChecks, Stack, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import type { LeftPanel } from '../../state/selection';
import styles from './MapWorkspace.module.css';

const ITEMS: { value: Exclude<LeftPanel, null>; label: string; icon: PhosphorIcon }[] = [
  { value: 'layers', label: 'Layers', icon: Stack },
  { value: 'spaces', label: 'Spaces', icon: Buildings },
  { value: 'sources', label: 'Sources', icon: FileText },
  { value: 'checks', label: 'Checks', icon: ListChecks },
];

/** Left edge of the map: one rail that opens one panel at a time. The area itself is named in the header. */
export function PanelRail({ panel, onPanel, counts }: { panel: LeftPanel; onPanel: (panel: LeftPanel) => void; counts: Partial<Record<Exclude<LeftPanel, null>, number>> }) {
  return (
    <nav className={styles.panelRail} aria-label="Map panels">
      {ITEMS.map((item) => (
        <button key={item.value} type="button" className={styles.railItem} aria-pressed={panel === item.value}
          onClick={() => onPanel(panel === item.value ? null : item.value)}>
          <Icon icon={item.icon} size={20} />
          <span>{item.label}</span>
          {counts[item.value] ? <b className={styles.railCount}>{counts[item.value]}</b> : null}
        </button>
      ))}
    </nav>
  );
}
