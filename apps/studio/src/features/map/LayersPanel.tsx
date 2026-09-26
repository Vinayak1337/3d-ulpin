import { X } from '@phosphor-icons/react';
import { Button } from '@ulpin/ui';
import type { ColourBy } from '../../state/selection';
import styles from './MapWorkspace.module.css';

/**
 * Left panel = Layers only (GOAL override 2). Colour by is one at a time; modes appear only when the
 * data can answer them. A layer with no data says so.
 */
export function LayersPanel({ colourBy, onColourBy, onClose, baseLayers, canColourRights }: {
  colourBy: ColourBy; onColourBy: (value: ColourBy) => void; onClose: () => void; baseLayers: string[]; canColourRights: boolean;
}) {
  const options: { value: ColourBy; label: string; note?: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'rights', label: 'Rights', note: canColourRights ? undefined : 'open a level to colour its spaces' },
  ];
  return (
    <aside className={`ul-panel ${styles.leftPanel}`} aria-label="Layers">
      <header className="ul-panel__head">
        <h2 className="ul-panel__title">Layers</h2>
        <Button variant="ghost" icon={X} iconOnly aria-label="Close layers" onClick={onClose} />
      </header>
      <div className={styles.leftBody}>
        <section className={styles.section}>
          <h3 className="ul-group-label">Base</h3>
          <p className="ul-help">{baseLayers.length ? baseLayers.join(' · ') : 'No base layers in this area'}</p>
        </section>
        <section className={styles.section}>
          <h3 className="ul-group-label">Imagery</h3>
          <p className="ul-help">Orthophoto · No data for this area</p>
          <p className="ul-help">AI candidates · No data for this area</p>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHead}><h3 className="ul-group-label">Colour by</h3><span className="ul-caption">one at a time</span></div>
          <div role="radiogroup" aria-label="Colour by" className={styles.radios}>
            {options.map((option) => (
              <label key={option.value} className={styles.radio}>
                <input type="radio" name="colour-by" checked={colourBy === option.value} onChange={() => onColourBy(option.value)} />
                <span>{option.label}{option.note ? <span className="ul-muted"> · {option.note}</span> : null}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
