import React, { memo } from 'react';
import { cx } from '../../lib/utils';

const SubTabBtn = memo(function SubTabBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={cx("ui-subtab", active ? "ui-subtab-active" : "ui-subtab-inactive")}
      aria-pressed={active}
    >
      {icon}
      <span className="text-[10px] font-bold mt-0.5 uppercase text-center leading-tight min-h-[1.25rem] flex items-center justify-center">{label}</span>
    </button>
  );
});

export default SubTabBtn;
