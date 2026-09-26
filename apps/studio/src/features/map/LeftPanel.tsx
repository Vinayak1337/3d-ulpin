import type { ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import type { BuildingLedger } from '@ulpin/api-client/draft';
import { Button, EvidenceChip, StatusBadge, type StatusWord } from '@ulpin/ui';
import type { AreaContext, BuildingRegister } from '../../api/queries';
import type { BuildingModel } from '../../model/building';
import { effectiveColour, type ColourBy, type LeftPanel as Panel, type Selection } from '../../state/selection';
import { useOpenEvidence } from '../evidence/EvidenceContext';
import { parseLocator } from '../evidence/refs';
import { RIGHTS_LABEL, RIGHTS_TOKEN, ledgerSpace } from './ledger';
import styles from './MapWorkspace.module.css';

const TITLES: Record<Exclude<Panel, null>, string> = { layers: 'Layers', spaces: 'Spaces', sources: 'Sources', checks: 'Checks' };
const CHECK_STATUS: Record<BuildingLedger['checks'][number]['state'], StatusWord | 'Blocking' | 'Passed'> = {
  blocking: 'Blocking', needs_review: 'Needs review', not_assessed: 'Not assessed', passed: 'Passed',
};

export function LeftPanel({ panel, selection, context, register, model, ledger, onClose, onColour, onSelectLevel, onSelectSpace, onOpenFinding }: {
  panel: Exclude<Panel, null>; selection: Selection; context: AreaContext; register: BuildingRegister | undefined; model: BuildingModel | null;
  ledger: BuildingLedger | null | undefined; onClose: () => void; onColour: (c: ColourBy) => void; onSelectLevel: (id: string) => void;
  onSelectSpace: (id: string, levelId: string) => void; onOpenFinding: (id: string) => void;
}) {
  let body: ReactNode = null;
  if (panel === 'layers') body = <LayersBody selection={selection} context={context} onColour={onColour} />;
  if (panel === 'spaces') body = <SpacesBody selection={selection} model={model} ledger={ledger} onSelectLevel={onSelectLevel} onSelectSpace={onSelectSpace} />;
  if (panel === 'sources') body = <SourcesBody register={register} ledger={ledger} />;
  if (panel === 'checks') body = <ChecksBody register={register} ledger={ledger} onOpenFinding={onOpenFinding} />;
  return (
    <aside className={`ul-panel ${styles.leftPanel}`} aria-label={TITLES[panel]}>
      <header className="ul-panel__head">
        <h2 className="ul-panel__title">{TITLES[panel]}</h2>
        <Button variant="ghost" icon={X} iconOnly aria-label={`Close ${TITLES[panel].toLowerCase()}`} onClick={onClose} />
      </header>
      <div className={styles.leftBody}>{body}</div>
    </aside>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}><h3 className="ul-group-label">{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

function LayersBody({ selection, context, onColour }: { selection: Selection; context: AreaContext; onColour: (c: ColourBy) => void }) {
  const count = (kind: string, water?: boolean) => context.features.filter((f) => f.kind === kind && (water === undefined || ((f.properties as Record<string, unknown>)?.land_cover === 'water') === water)).length;
  const base = [
    ['Parcels', count('parcel')], ['Buildings', count('building')], ['Roads', count('road')],
    ['Public land', count('public_land', false)], ['Water', count('public_land', true)], ['Utilities', count('utility')],
  ].filter(([, n]) => n) as [string, number][];
  const colour = effectiveColour(selection);
  const options: { value: Exclude<ColourBy, 'auto'>; label: string; note?: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'rights', label: 'Rights', note: selection.mode === 'level' ? undefined : 'shown on a floor' },
    { value: 'utilities', label: 'Utilities', note: count('utility') ? (selection.mode === 'underground' ? undefined : 'shown underground') : 'no survey' },
  ];
  return (
    <>
      <Section title="Base">
        <ul className={styles.plainList}>{base.map(([label, n]) => <li key={label}><span>{label}</span><span className="ul-num ul-muted">{n}</span></li>)}</ul>
      </Section>
      <Section title="Colour by" aside={<span className="ul-caption">one at a time</span>}>
        <div role="radiogroup" aria-label="Colour by" className={styles.radios}>
          {options.map((option) => (
            <label key={option.value} className={styles.radio}>
              <input type="radio" name="colour-by" checked={colour === option.value} onChange={() => onColour(option.value)} />
              <span>{option.label}{option.note ? <span className="ul-muted"> · {option.note}</span> : null}</span>
            </label>
          ))}
        </div>
      </Section>
    </>
  );
}

function SpacesBody({ selection, model, ledger, onSelectLevel, onSelectSpace }: {
  selection: Selection; model: BuildingModel | null; ledger: BuildingLedger | null | undefined;
  onSelectLevel: (id: string) => void; onSelectSpace: (id: string, levelId: string) => void;
}) {
  if (!model) return <p className="ul-help">Select a building to list its floors and spaces.</p>;
  if (!model.levels.length) return <p className="ul-help">No floors are recorded for this building.</p>;
  const level = model.levels.find((l) => l.id === selection.levelId);
  const units = model.spaces.filter((s) => s.use === 'apartment').length;
  if (!level) {
    return (
      <Section title={`${model.levels.length} levels`} aside={units ? <span className="ul-caption">{units} units</span> : null}>
        <div className={styles.pickList}>
          {model.levels.map((l) => (
            <button key={l.id} type="button" onClick={() => onSelectLevel(l.id)}>
              <span>{l.label}</span><span className="ul-muted">{model.spaces.filter((s) => s.levelId === l.id && !s.parentId).length} spaces</span>
            </button>
          ))}
        </div>
      </Section>
    );
  }
  const spaces = model.spaces.filter((s) => s.levelId === level.id && !s.parentId);
  return (
    <>
      <Section title={`${level.label} · ${spaces.length} spaces`} aside={units ? <span className="ul-caption">{units} units in building</span> : null}>
        <div className={styles.pickList}>
          {spaces.map((s) => {
            const rights = ledgerSpace(ledger, s.id)?.rights ?? 'unknown';
            return (
              <button key={s.id} type="button" aria-current={s.id === selection.spaceId} onClick={() => onSelectSpace(s.id, level.id)}>
                <span className={styles.swatchSmall} style={{ background: `var(${RIGHTS_TOKEN[rights]})` }} />
                <span className={styles.grow}>{s.name}</span>
                <span className="ul-muted">{RIGHTS_LABEL[rights].split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Other floors"><p className="ul-help">Pick a level on the rail to list its spaces.</p></Section>
    </>
  );
}

function SourcesBody({ register, ledger }: { register: BuildingRegister | undefined; ledger: BuildingLedger | null | undefined }) {
  const openEvidence = useOpenEvidence();
  if (!register) return <p className="ul-help">Select a building to list the sources behind its record.</p>;
  const items = ledger?.sources ?? register.sources.map((s) => ({ sourceId: s.id, kind: 'document' as const, name: s.name, file: s.name, summary: '' }));
  return (
    <Section title="Evidence" aside={<span className="ul-caption">{items.length}</span>}>
      <div className={styles.chipColumn}>
        {items.map((s) => (
          <EvidenceChip key={s.sourceId} kind={s.kind} source={s.name} locator={s.summary || undefined}
            onOpen={() => openEvidence({ sourceId: s.sourceId, label: s.name, locator: parseLocator({ locator: s.summary }) })} />
        ))}
      </div>
    </Section>
  );
}

function ChecksBody({ register, ledger, onOpenFinding }: { register: BuildingRegister | undefined; ledger: BuildingLedger | null | undefined; onOpenFinding: (id: string) => void }) {
  if (!register) return <p className="ul-help">Select a building to see its checks.</p>;
  if (!ledger?.checks.length) {
    return <Section title="Checks"><StatusBadge status="Not assessed" /><p className="ul-help">No checks have run on this building yet. This is not a pass.</p></Section>;
  }
  return (
    <Section title={`${register.property.name} · r${ledger.revision}`} aside={<span className="ul-caption">{ledger.checkMethod}</span>}>
      <div className={styles.checkList}>
        {ledger.checks.map((c) => (
          <button key={c.name} type="button" disabled={!c.findingId} data-state={c.state} onClick={() => c.findingId && onOpenFinding(c.findingId)}>
            <span className={styles.checkText}><b>{c.name}</b>{c.detail ? <span className="ul-muted">{c.detail}</span> : null}</span>
            <CheckBadge state={c.state} />
          </button>
        ))}
      </div>
    </Section>
  );
}

export function CheckBadge({ state }: { state: BuildingLedger['checks'][number]['state'] }) {
  const word = CHECK_STATUS[state];
  if (word === 'Blocking') return <span className="ul-badge ul-badge--danger">Blocking</span>;
  if (word === 'Passed') return <span className="ul-badge ul-badge--success">Passed</span>;
  return <StatusBadge status={word} />;
}
