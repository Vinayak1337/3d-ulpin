import type { ReactNode } from 'react';

export interface DataColumn<Row> {
  /** Header text, sentence case. Units in the header: "Carpet m²". */
  header: string;
  /** Cell content for a row. */
  cell: (row: Row) => ReactNode;
  /** Right-align (numbers). */
  numeric?: boolean;
  /** Mono face (codes, hashes). */
  mono?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataColumn<Row>[];
  rows: Row[];
  /** Muted full-width row after the data, e.g. "52 more units". */
  more?: ReactNode;
  /** Totals row: one node per column (use `null` to leave a cell empty), or a [label, value] pair spanning the columns. */
  footer?: ReactNode[];
  /** Hide the header row (arithmetic tables). */
  hideHeader?: boolean;
}

/**
 * A dense Studio table: 13px cells, `surface-subtle` header, hairline rows, bold totals footer.
 */
export function DataTable<Row>({ columns, rows, more, footer, hideHeader }: DataTableProps<Row>) {
  const cls = (c: DataColumn<Row>) => [c.numeric && 'ul-r', c.mono && 'ul-mono'].filter(Boolean).join(' ') || undefined;
  return (
    <table className="ul-table">
      {!hideHeader && (
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={c.numeric ? 'ul-r' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c.header} className={cls(c)}>
                {c.cell(r)}
              </td>
            ))}
          </tr>
        ))}
        {more && (
          <tr>
            <td colSpan={columns.length} className="ul-muted">
              {more}
            </td>
          </tr>
        )}
      </tbody>
      {footer && (
        <tfoot>
          <tr>
            {footer.length === 2 && columns.length > 2 ? (
              <>
                <td colSpan={columns.length - 1}>{footer[0]}</td>
                <td className={columns[columns.length - 1].numeric ? 'ul-r' : undefined}>{footer[1]}</td>
              </>
            ) : (
              footer.map((f, i) => (
                <td key={i} className={columns[i]?.numeric ? 'ul-r' : undefined}>
                  {f}
                </td>
              ))
            )}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
