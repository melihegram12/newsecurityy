import React from 'react';
import { cx } from '../../lib/utils';

const TableHeadCell = ({ icon, label, sortKey, sortState, onSort, align = "left" }) => {
  const sortable = !!sortKey && typeof onSort === 'function';
  const aligned = align === "right" ? "justify-end" : "";

  return (
    <th className={cx("p-3 font-bold", align === "right" && "text-right")}>
      {sortable ? (
        <button type="button" onClick={() => onSort(sortKey)} className="ui-th-btn">
          {icon}
          {label}
          {sortState?.key === sortKey && (
            <span className="ml-1 text-slate-400">{sortState?.dir === 'asc' ? '\u25B2' : '\u25BC'}</span>
          )}
        </button>
      ) : (
        <div className={cx("flex items-center gap-2", aligned)}>
          {icon}
          {label}
        </div>
      )}
    </th>
  );
};

export default TableHeadCell;
