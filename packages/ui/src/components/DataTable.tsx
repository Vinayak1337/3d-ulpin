import type { ReactNode } from 'react';

export interface Column<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
  width?: string;
}

/** Dense Studio table. Unknown cells must say Unknown (the caller decides), never blank. */
export function DataTable<Row>({ columns, rows, rowKey, more, onRowClick, selectedKey, caption }: {
  columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row) => string; more?: string;
  onRowClick?: (row: Row) => void; selectedKey?: string | null; caption?: string;
}) {
  return (
    <table className="ul-table">
      {caption ? <caption className="ul-visually-hidden">{caption}</caption> : null}
      <colgroup>{columns.map((column) => <col key={column.header} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
      <thead>
        <tr>{columns.map((column) => <th key={column.header} scope="col" className={column.numeric ? 'ul-r' : undefined}>{column.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <tr
              key={key}
              className={onRowClick ? 'ul-table__row--link' : undefined}
              aria-selected={selectedKey === undefined ? undefined : selectedKey === key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column, index) => (
                <td key={column.header} className={column.numeric ? 'ul-r ul-num' : undefined}>
                  {index === 0 && onRowClick ? (
                    <button type="button" className="ul-table__rowbtn" onClick={(event) => { event.stopPropagation(); onRowClick(row); }}>
                      {column.cell(row)}
                    </button>
                  ) : column.cell(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      {more ? <tfoot><tr><td colSpan={columns.length} className="ul-table__more">{more}</td></tr></tfoot> : null}
    </table>
  );
}
