import type { CSSProperties } from 'react';
import { Badge } from './Badge';
import { DataTable } from './DataTable';
import { EvidenceChip, type EvidenceChipProps } from './EvidenceChip';

export interface ShareRow {
  unit: string;
  /** Proposed 3D ULPIN, shortened with an ellipsis: "P3-7Q4M…-R4". */
  code: string;
  /** Carpet area in m², 2 decimals. */
  carpet: number;
  /** Undivided share of the parent parcel in %, 2 decimals. */
  share: number;
}

export interface ShareLedgerProps {
  /** Building name for the title. */
  building: string;
  /** Basis the Deed of Declaration uses: "value" or "area". */
  basis: 'value' | 'area';
  rows: ShareRow[];
  /** Units not listed ("52 more units"). */
  moreUnits?: number;
  /** Units in the declaration. */
  totalUnits: number;
  /** Sum of all declared shares in %. Anything other than 100 is flagged with the exact difference. */
  total: number;
  /** The declaration source. */
  evidence?: EvidenceChipProps;
  style?: CSSProperties;
}

const f2 = (n: number) => n.toFixed(2);

/**
 * The undivided-share table for one building from the Deed of Declaration, with a total that is flagged unless it is exactly 100 %.
 */
export function ShareLedger({ building, basis, rows, moreUnits, totalUnits, total, evidence, style }: ShareLedgerProps) {
  const ok = Math.abs(total - 100) < 0.005;
  return (
    <div className="ul-panel" style={{ maxWidth: 640, ...style }}>
      <div className="ul-panel__head">
        <h3 className="ul-panel__title">Undivided shares · {building}</h3>
        <Badge icon={null}>Basis: {basis}</Badge>
      </div>
      <DataTable<ShareRow>
        columns={[
          { header: 'Unit', cell: (r) => r.unit },
          { header: '3D ULPIN', cell: (r) => r.code, mono: true },
          { header: 'Carpet m²', cell: (r) => f2(r.carpet), numeric: true },
          { header: 'Share %', cell: (r) => f2(r.share), numeric: true },
        ]}
        rows={rows}
        more={moreUnits ? `${moreUnits} more units` : undefined}
        footer={[`Total of ${totalUnits} units`, f2(total)]}
      />
      <div className="ul-panel__foot" style={{ background: 'var(--surface)' }}>
        {ok ? (
          <Badge tone="success" icon="check-circle">
            Shares total 100 %
          </Badge>
        ) : (
          <Badge tone="danger" icon="warning-octagon">
            Shares total {f2(total)} %, expected 100 %
          </Badge>
        )}
        {evidence && <EvidenceChip {...evidence} />}
      </div>
    </div>
  );
}
