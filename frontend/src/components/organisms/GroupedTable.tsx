import { Fragment, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** Hidden on narrow screens (the row's main cell should carry what matters). */
  hideOnMobile?: boolean;
}

/**
 * A table whose rows are grouped under header rows ("Ciencia ficción · 4"). Groups appear in the
 * order their first row appears, so the caller decides the order by sorting. Without `groupOf`
 * it is a plain table.
 */
export function GroupedTable<T>({
  rows,
  columns,
  rowKey,
  groupOf,
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  groupOf?: (row: T) => string;
  rowClassName?: (row: T) => string;
}) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = groupOf ? groupOf(row) : '';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const hide = (c: Column<T>) => (c.hideOnMobile ? 'hidden md:table-cell' : '');

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-medium/70 bg-white shadow-soft dark:border-white/10 dark:bg-[var(--surface)]">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-medium/70 bg-gray-light/70 text-left text-xs font-bold uppercase tracking-wide text-gray-dark dark:border-white/10 dark:bg-white/5">
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2.5 ${hide(c)} ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups].map(([group, items]) => (
            <Fragment key={group || '_'}>
              {groupOf && (
                <tr className="bg-primary/5 dark:bg-white/[0.03]">
                  <td colSpan={columns.length} className="px-3 py-2 font-display text-sm font-extrabold text-ink dark:text-white">
                    {group} <span className="ml-1 text-xs font-semibold text-gray-dark">· {items.length}</span>
                  </td>
                </tr>
              )}
              {items.map((row) => (
                <tr key={rowKey(row)} className={`border-t border-gray-medium/50 align-top transition-colors hover:bg-gray-light/60 dark:border-white/5 dark:hover:bg-white/[0.04] ${rowClassName?.(row) ?? ''}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2.5 ${hide(c)} ${c.className ?? ''}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
