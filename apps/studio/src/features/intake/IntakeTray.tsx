import { Button, DataTable } from '@ulpin/ui';
import { countWords, crsWords, familyWords, formatWords, placementWords, sizeClassWords,
  stateWords } from './batch-model';
import type { IntakeItem } from './batch-model';
import styles from './Batch.module.css';

export function IntakeTray({ items, choose }: { items: IntakeItem[]; choose: (item: IntakeItem) => void }) {
  return <div className={styles.tray} tabIndex={0} role="region" aria-label="Intake tray">
    <DataTable caption="Files in this batch" rows={items} rowKey={(item) => item.itemId} columns={[
      { header: 'File', cell: (item) => item.name },
      { header: 'Contents', cell: (item) => <>
        {familyWords(item.family)} · {formatWords(item.format)}
      </> },
      { header: 'Size', numeric: true, cell: (item) => <>
        {item.sizeBytes == null ? 'Not known' : `${countWords(item.sizeBytes)} bytes`}
        {item.sizeClass ? ` · ${sizeClassWords(item.sizeClass)}` : ''}
      </> },
      { header: 'State', cell: (item) => stateWords(item.state) },
      { header: 'Features', numeric: true, cell: (item) => countWords(item.card?.counts.features) },
      { header: 'Coordinate system', cell: (item) => crsWords(item.card) },
      { header: 'Extent as stated', cell: (item) => item.card?.extent.native?.join(', ') ?? 'Not known' },
      { header: 'Placement', cell: (item) => placementWords(item.placement) },
      { header: 'Reason', cell: (item) => item.limitReason ?? 'Not known' },
      { header: 'Next step', cell: (item) => {
        if (item.placement === 'needs_answer' && item.sourceId && item.format === 'geojson') {
          return <Button variant="soft" onClick={() => choose(item)}>View layout fields</Button>;
        }
        if (item.state === 'read' && item.placement === 'on_map') return 'Package link not supplied';
        return 'No action here';
      } },
    ]} />
  </div>;
}
