import React from 'react';
import { cx } from '../../lib/utils';

const TableHeadCell = ({ icon, label, sortKey, sortState, onSort, align = "left" }) => {
  const sortable = !!sortKey && typeof onSort === 'function';
  const isActive = sortState?.key === sortKey;
  const ariaSort = sortable && isActive
    ? (sortState?.dir === 'asc' ? 'ascending' : 'descending')
    : 'none';

  return (
    <th
      className={cx("p-3 font-semibold", align === "right" && "text-right")}
      aria-sort={sortable ? ariaSort : undefined}
      scope="col"
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cx("ui-th-btn", isActive && "text-foreground")}
          aria-label={`${label} sirala`}
        >
          {icon}
          {label}
          {isActive && (
            <span className="ml-0.5 text-primary" aria-hidden="true">{sortState?.dir === 'asc' ? '\u25B2' : '\u25BC'}</span>
          )}
        </button>
      ) : (
        <div className={cx("flex items-center gap-2", align === "right" && "justify-end")}>
          {icon}
          {label}
        </div>
      )}
    </th>
  );
};

export default TableHeadCell;
