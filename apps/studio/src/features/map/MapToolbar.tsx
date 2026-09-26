import { ArrowCounterClockwise, Cursor, Stack, Shovel } from '@phosphor-icons/react';
import { Icon, SegmentedControl } from '@ulpin/ui';
import type { Selection } from '../../state/selection';
import styles from './MapWorkspace.module.css';

/**
 * Floating tools, one row (GOAL override 3): Layers, then Select and Underground, then view controls.
 * Measure and Section appear when their engine tools exist; tools that cannot run are not shown.
 */
export function MapToolbar({ selection, onLayers, onSelectTool, onUnderground, onView, onRender, onReset }: {
  selection: Selection; onLayers: () => void; onSelectTool: () => void; onUnderground: () => void;
  onView: (view: Selection['view']) => void; onRender: (render: Selection['render']) => void; onReset: () => void;
}) {
  const underground = selection.mode === 'underground';
  return (
    <div className={styles.toolbar}>
      <div className="ul-maptools" role="toolbar" aria-label="Map tools">
        <button type="button" className="ul-tool" aria-pressed={selection.panel === 'layers'} aria-label="Layers" title="Layers" onClick={onLayers}>
          <Icon icon={Stack} />
        </button>
        <span className="ul-tool-sep" />
        <button type="button" className="ul-tool" aria-pressed={!underground} aria-label="Select" title="Select" onClick={onSelectTool}>
          <Icon icon={Cursor} />
        </button>
        <button
          type="button"
          className="ul-tool"
          aria-pressed={underground}
          aria-label="Underground"
          title={selection.buildingId ? 'Underground' : 'Underground: select a building first'}
          disabled={!selection.buildingId}
          onClick={onUnderground}
        >
          <Icon icon={Shovel} />
        </button>
      </div>
      <div className={`ul-maptools ${styles.viewTools}`} role="toolbar" aria-label="View">
        <SegmentedControl label="View" value={selection.view} onChange={onView} options={[{ value: '3d', label: '3D' }, { value: '2d', label: '2D' }]} />
        <SegmentedControl
          label="Render"
          value={selection.mode === 'findings' ? 'volumes' : selection.render}
          onChange={onRender}
          options={[{ value: 'model', label: 'Model' }, { value: 'volumes', label: 'Volumes' }]}
        />
        <button type="button" className="ul-tool" aria-label="Reset camera" title="Reset camera" onClick={onReset}>
          <Icon icon={ArrowCounterClockwise} />
        </button>
      </div>
    </div>
  );
}
