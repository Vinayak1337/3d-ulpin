import { useId, useRef, useState } from 'react';
import { Button } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import { stateLayerCrs } from './batch-queries';
import { createLayerCrsCommand, layerCrsWords, type LayerCrsEntry, type LayerCrsState } from './layer-crs-command';
import styles from './Batch.module.css';

/** CR1. Each layer of the item whose file states no coordinate system: the officer's answer, or a form to give it. */
export function LayerCrsAnswers({ caseId, item, refresh }: { caseId: string; item: IntakeItem; refresh: () => void }) {
  return <div className={styles.stack}>
    {item.layerCrs?.map(entry => entry.answer
      ? <p key={entry.layer}>{entry.layer}: {entry.answer.crs}, stated by the officer</p>
      : <LayerCrsForm key={entry.layer} caseId={caseId} itemId={item.itemId} entry={entry} refresh={refresh} />)}
  </div>;
}

function LayerCrsForm({ caseId, itemId, entry, refresh }: {
  caseId: string; itemId: string; entry: LayerCrsEntry; refresh: () => void;
}) {
  const [code, setCode] = useState('');
  const [state, setState] = useState<LayerCrsState>({ busy: false, uncertain: false, error: '' });
  const current = useRef(refresh);
  current.current = refresh;
  const command = useRef<ReturnType<typeof createLayerCrsCommand> | null>(null);
  command.current ??= createLayerCrsCommand(entry.layer, body => stateLayerCrs(caseId, itemId, body), setState,
    () => current.current());
  const id = useId();
  return <form className={styles.answer} onSubmit={event => {
    event.preventDefault();
    void command.current?.(code);
  }}>
    <label className="ul-field" htmlFor={id}>
      <span className="ul-label">Coordinate system of {entry.layer}</span>
      <input id={id} className="ul-input" value={code} placeholder="EPSG:32643" autoComplete="off"
        aria-invalid={state.error ? true : undefined} aria-describedby={`${id}-help`}
        onChange={event => setCode(event.target.value)} />
      <span id={`${id}-help`} className="ul-help">
        The file states none. Give the EPSG code its coordinates are in.
      </span>
    </label>
    <Button type="submit" variant="soft" disabled={state.busy}
      aria-label={`${layerCrsWords(state)}: ${entry.layer}`}>{layerCrsWords(state)}</Button>
    {state.error ? <p role="alert" className="ul-error">{state.error}</p> : null}
    {state.uncertain ? <p className="ul-help">The outcome is not known. The same answer is sent again.</p> : null}
  </form>;
}
