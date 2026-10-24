import type { ReactNode } from "react";
import { cx } from "../../lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  dense = false,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  dense?: boolean;
}) {
  const alignClass = (align?: Column<T>["align"]) =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.025]">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cx(
                  "table-head whitespace-nowrap px-4 py-2.5",
                  alignClass(column.align),
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }, (_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`} className="border-b border-white/[0.06]">
                {columns.map((column, columnIndex) => (
                  <td key={column.key} className="px-4 py-3">
                    <div
                      className="skeleton h-4"
                      style={{ width: `${45 + ((rowIndex + columnIndex) % 4) * 12}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4">
                {empty ?? (
                  <div className="py-10 text-center text-sm text-neutral-500">
                    Nothing to show yet.
                  </div>
                )}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cx(
                  "border-b border-white/[0.06] transition-colors last:border-0",
                  onRowClick
                    ? "cursor-pointer hover:bg-white/[0.04] focus:bg-white/[0.05] focus:outline-none"
                    : "hover:bg-white/[0.035]",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      dense ? "px-4 py-2" : "px-4 py-3",
                      alignClass(column.align),
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
