import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { theme } from "./theme";
import { EmptyState } from "./EmptyState";
import { Icon, type IconName } from "./Icon";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  width?: number | string;
  align?: "left" | "center" | "right";
  sticky?: boolean;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  dense?: boolean;
  emptyText?: string;
  emptyIcon?: IconName;
  maxHeight?: string;
  style?: CSSProperties;
  /** When provided, the first column gets an expand chevron and an extra row renders the returned node. */
  expandable?: (row: T) => ReactNode;
}

/** Dense data table: light-gray bold headers, clean row borders, optional sticky first column. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  dense = false,
  emptyText = "No records found.",
  emptyIcon = "search",
  maxHeight,
  style,
  expandable,
}: DataTableProps<T>) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const cellPad = dense ? "0.45rem 0.75rem" : "0.6rem 1rem";
  const headerPad = dense ? "0.5rem 0.75rem" : "0.65rem 1rem";

  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon} description={emptyText} />;
  }

  return (
    <div style={{ overflowX: "auto", maxHeight, overflowY: maxHeight ? "auto" : undefined, ...style }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: theme.fontSize.base }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  position: col.sticky ? "sticky" : undefined,
                  left: col.sticky ? 0 : undefined,
                  zIndex: col.sticky ? 2 : undefined,
                  background: theme.surface.subtle,
                  padding: headerPad,
                  textAlign: col.align ?? "left",
                  fontSize: theme.fontSize.sm,
                  fontWeight: theme.fontWeight.semibold,
                  color: theme.text.secondary,
                  letterSpacing: "0.02em",
                  borderBottom: `1px solid ${theme.surface.border}`,
                  whiteSpace: "nowrap",
                  width: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const isExpanded = expandable ? expandedKeys.has(key) : false;
            return (
              <Fragment key={key}>
                <tr
                  style={{ transition: "background-color 150ms ease" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  {expandable ? (
                    <td
                      style={{
                        padding: cellPad,
                        borderBottom: `1px solid ${theme.surface.border}`,
                        width: 32,
                      }}
                    >
                      <button
                        onClick={() =>
                          setExpandedKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Collapse row" : "Expand row"}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 24,
                          borderRadius: theme.radius.sm,
                          border: "none",
                          background: "transparent",
                          color: theme.text.muted,
                          cursor: "pointer",
                        }}
                      >
                        <Icon name="chevron-right" size={14} style={{ transform: isExpanded ? "rotate(90deg)" : undefined }} />
                      </button>
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        position: col.sticky ? "sticky" : undefined,
                        left: col.sticky ? 0 : undefined,
                        zIndex: col.sticky ? 1 : undefined,
                        background: col.sticky ? theme.surface.card : undefined,
                        padding: cellPad,
                        textAlign: col.align ?? "left",
                        color: theme.text.secondary,
                        borderBottom: `1px solid ${theme.surface.border}`,
                        whiteSpace: "nowrap",
                        width: col.width,
                      }}
                    >
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
                {expandable && isExpanded ? (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      style={{
                        padding: cellPad,
                        background: theme.surface.subtle,
                        borderBottom: `1px solid ${theme.surface.border}`,
                      }}
                    >
                      {expandable(row)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface MatrixGridProps {
  headers: ReactNode[];
  rows: ReactNode[][];
  rowKey: (row: ReactNode[], index: number) => string;
  stickyColumns?: number;
  emptyText?: string;
  emptyIcon?: IconName;
  maxHeight?: string;
  style?: CSSProperties;
}

/** Matrix grid for dense shift/date views: horizontal scroll, sticky identity columns. */
export function MatrixGrid({
  headers,
  rows,
  rowKey,
  stickyColumns = 1,
  emptyText = "No data for this view.",
  emptyIcon = "calendar",
  maxHeight,
  style,
}: MatrixGridProps) {
  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon} description={emptyText} />;
  }

  return (
    <div style={{ overflowX: "auto", maxHeight, overflowY: maxHeight ? "auto" : undefined, ...style }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: theme.fontSize.base }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  position: i < stickyColumns ? "sticky" : undefined,
                  left: i < stickyColumns ? 0 : undefined,
                  zIndex: i < stickyColumns ? 2 : undefined,
                  background: theme.surface.subtle,
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  fontSize: theme.fontSize.sm,
                  fontWeight: theme.fontWeight.semibold,
                  color: theme.text.secondary,
                  letterSpacing: "0.02em",
                  borderBottom: `1px solid ${theme.surface.border}`,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={rowKey(row, ri)}
              style={{ transition: "background-color 150ms ease" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.02)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    position: ci < stickyColumns ? "sticky" : undefined,
                    left: ci < stickyColumns ? 0 : undefined,
                    zIndex: ci < stickyColumns ? 1 : undefined,
                    background: ci < stickyColumns ? theme.surface.card : undefined,
                    padding: "0.45rem 0.75rem",
                    color: theme.text.secondary,
                    borderBottom: `1px solid ${theme.surface.border}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
