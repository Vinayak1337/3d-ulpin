import { Fragment, useId, useState, type ReactNode } from 'react';
import {
  Buildings, Info, MapTrifold, Shovel, SlidersHorizontal, Stack, WarningOctagon, type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { Button, Icon, formatCount, type LegendItem } from '@ulpin/ui';
import type { ColourBy } from '../../state/selection';
import type { SpaceModel } from '../../model/building';
import styles from './MapSidebar.module.css';

type Colour = Exclude<ColourBy, 'auto'>;
export type ViewKey = 'area' | 'building' | 'level' | 'findings' | 'underground';
/** One key of the active Colour by: an entry may carry its status icon beside its word, and the key a note. */
export interface KeySection { title: string; items: (LegendItem & { icon?: PhosphorIcon })[]; note?: string }

export interface LayerSwitch {
  key: string;
  label: string;
  hint?: string;
  /** A failure to report, shown under the row at all times. */
  warning?: string;
  count?: number;
  checked: boolean;
  disabled?: boolean;
}

export interface SidebarView {
  key: ViewKey;
  label: string;
  /** The thing this view is on (area, building, floor name), shown muted. */
  detail?: string | null;
  badge?: ReactNode;
  disabled?: boolean;
}

const ICONS: Record<ViewKey, PhosphorIcon> = { area: MapTrifold, building: Buildings, level: Stack, findings: WarningOctagon, underground: Shovel };

function LayerRow({ layer, onLayer }: { layer: LayerSwitch; onLayer: (key: string, on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const hintId = useId();
  let icon = MapTrifold;
  if (layer.key === 'look') icon = SlidersHorizontal;
  else if (layer.key.startsWith('surface:') || layer.key === 'overlay:lidar') icon = Stack;
  return <div>
    <div className={styles.layerRow}>
      <Icon icon={icon} size={20} />
      <span className={styles.layerName} title={layer.label}>{layer.label}</span>
      <span className="ul-num ul-muted">{layer.count !== undefined ? formatCount(layer.count) : null}</span>
      <button type="button" role="switch" className="ul-toggle" aria-label={layer.label}
        aria-checked={layer.checked} disabled={layer.disabled} onClick={() => onLayer(layer.key, !layer.checked)} />
      {layer.hint ? <Button variant="ghost" icon={Info} iconOnly aria-label={`About ${layer.label}`}
        title={`About ${layer.label}`} aria-expanded={open} aria-controls={hintId}
        onClick={() => setOpen(!open)} /> : null}
    </div>
    {layer.warning ? <p className={styles.note}>{layer.warning}</p> : null}
    {open && layer.hint ? <p id={hintId} className={styles.note}>{layer.hint}</p> : null}
  </div>;
}

/**
 * The map's left navigation: which view the canvas shows, what it is coloured by (with its key), and on a
 * floor its spaces as a list. Facts about the selection live only in the inspector on the right.
 */
export function MapSidebar({
  views, active, onView, colour, colourOptions, onColour, keySections, layers, onLayer, floor, spaces,
  rightsColour, selectedSpaceId, onSelectSpace, planCheck, viewFooter, undrawn,
}: {
  planCheck?: ReactNode;
  /** The buildings without a recorded footprint, listed under every section. */
  undrawn?: ReactNode;
  /** Shown under the View list only (area actions). */
  viewFooter?: ReactNode;
  views: SidebarView[]; active: ViewKey; onView: (key: ViewKey) => void;
  colour: Colour; colourOptions: { value: Colour; label: string; disabled?: boolean }[]; onColour: (c: Colour) => void;
  keySections: KeySection[];
  layers: LayerSwitch[]; onLayer: (key: string, on: boolean) => void;
  floor: string | null; spaces: SpaceModel[]; rightsColour: (id: string) => string | null; selectedSpaceId: string | null; onSelectSpace: (s: SpaceModel) => void;
}) {
  const [section, setSection] = useState<'view' | 'layers' | 'colour' | 'check'>('layers');
  return (
    <nav className={styles.sidebar} aria-label="Map">
      <div className={styles.sections} role="group" aria-label="Map tool sections">
        {(['view', 'layers', 'colour', ...(planCheck ? ['check' as const] : [])] as const).map((key) => (
          <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)}>
            {key === 'view' ? 'View' : key === 'layers' ? 'Layers' : key === 'colour' ? 'Colour' : 'Check'}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {section === 'check' ? planCheck : null}
        {section === 'view' ? <ul className={styles.views}>
          {views.map((v) => (
            <li key={v.key}>
              <button type="button" className={styles.view} aria-current={v.key === active ? 'page' : undefined} disabled={v.disabled} onClick={() => onView(v.key)}>
                <Icon icon={ICONS[v.key]} size={20} />
                <span className={styles.viewText}>
                  <span>{v.label}</span>
                  {v.detail ? <span className={styles.detail}>{v.detail}</span> : null}
                </span>
                {v.badge}
              </button>
            </li>
          ))}
        </ul> : null}
        {section === 'view' ? viewFooter : null}

        {section === 'colour' ? <section className={styles.group} aria-label="Colour by">
          <div role="radiogroup" aria-label="Colour by" className={styles.segments}>
            {colourOptions.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={colour === o.value} disabled={o.disabled} onClick={() => onColour(o.value)}>{o.label}</button>
            ))}
        </div>
        {keySections.map((section) => <Fragment key={section.title}>
          <ul className={styles.key} aria-label={section.title}>
            {section.items.map((item) => (
              <li key={item.label}>
                {item.color || item.hatch
                  ? <span className={`${styles.swatch}${item.hatch ? ' ul-hatch' : ''}`} style={{ backgroundColor: item.color }} />
                  : <span />}
                <span className={styles.keyLabel}>{item.icon ? <Icon icon={item.icon} size={16} className={`ul-ico--sm ${styles.keyIcon}`} /> : null}{item.label}</span>
                {item.count !== undefined ? <span className="ul-num ul-muted">{item.count}</span> : null}
              </li>
            ))}
          </ul>
          {section.note ? <p className={styles.note}>{section.note}</p> : null}
        </Fragment>)}
      </section> : null}

      {section === 'layers' && layers.length ? (
        <section className={styles.group} aria-label="Layers">
          <div className={styles.layers}>
            {layers.map((layer) => <LayerRow key={layer.key} layer={layer} onLayer={onLayer} />)}
          </div>
        </section>
      ) : null}

      {section === 'view' && floor && spaces.length ? (
        <section className={`${styles.group} ${styles.fill}`} aria-label={`Spaces on ${floor}`}>
          <h2 className={styles.heading}>Spaces on {floor}</h2>
          <ul className={styles.spaces}>
            {spaces.map((s) => {
              const c = rightsColour(s.id);
              return (
                <li key={s.id}>
                  <button type="button" aria-current={s.id === selectedSpaceId || undefined} onClick={() => onSelectSpace(s)}>
                    <span className={styles.swatch} style={c ? { background: c } : undefined} />
                    {s.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
        {undrawn}
      </div>
    </nav>
  );
}
