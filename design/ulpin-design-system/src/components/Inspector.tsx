import type { CSSProperties, ReactNode } from 'react';
import { Badge, type StatusWord } from './Badge';
import { Button, type ButtonProps } from './Button';
import { DescriptionList, type DescriptionItem } from './DescriptionList';
import { Tabs } from './Tabs';
import { UlpinCode } from './UlpinCode';

export interface InspectorAction extends Pick<ButtonProps, 'icon' | 'onClick' | 'disabled'> {
  label: string;
}

export interface InspectorProps {
  /** Name of the one selected thing: "Flat 704", "Lake View Residence". */
  title: string;
  /** Status word shown as a Badge. */
  status?: StatusWord;
  /** Proposed 3D ULPIN, if assigned. */
  code?: string;
  /** Display-only location line, or the Parcel ULPIN line for a building. */
  location?: string;
  /** Tabs: Overview · Rights · Evidence · Checks · History. */
  tabs?: string[];
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  /** Facts for the active tab; each value may carry EvidenceChips. Use `children` for anything richer. */
  facts?: DescriptionItem[];
  children?: ReactNode;
  /** The next step in the workflow (one primary). */
  primaryAction?: InspectorAction;
  /** One secondary action. */
  secondaryAction?: InspectorAction;
  /** 360px by default; 400px when an evidence preview is open. */
  wide?: boolean;
  style?: CSSProperties;
}

/**
 * The single right-hand panel for the current selection: identity header, tabs, facts with evidence, and one next action.
 */
export function Inspector({
  title,
  status,
  code,
  location,
  tabs = ['Overview', 'Rights', 'Evidence', 'Checks', 'History'],
  activeTab,
  onTabChange,
  facts,
  children,
  primaryAction,
  secondaryAction,
  wide,
  style,
}: InspectorProps) {
  return (
    <aside className="ul-panel" style={{ width: wide ? 400 : 360, ...style }}>
      <div className="ul-panel__head" style={{ display: 'grid', gap: 8, justifyContent: 'stretch' }}>
        <div className="ul-row" style={{ justifyContent: 'space-between' }}>
          <h3 className="ul-panel__title">{title}</h3>
          {status && <Badge status={status} />}
        </div>
        {code ? (
          <UlpinCode code={code} location={location} labelled={false} copyable={false} />
        ) : (
          location && <span className="ul-help ul-mono">{location}</span>
        )}
      </div>
      {tabs.length > 0 && <Tabs tabs={tabs} value={activeTab} onChange={onTabChange} />}
      <div className="ul-panel__body">
        {facts && <DescriptionList items={facts} />}
        {children}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="ul-panel__foot">
          {primaryAction && (
            <Button variant="primary" icon={primaryAction.icon} onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button icon={secondaryAction.icon} onClick={secondaryAction.onClick} disabled={secondaryAction.disabled}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
