import React, { memo } from 'react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const Dropdown = memo(function Dropdown({ isOpen, items, onSelect, renderItem, emptyText = 'Bulunamadı.', className = '' }) {
  if (!isOpen || !Array.isArray(items)) return null;

  return (
    <div className={cx(styles.dropdown, className)}>
      {items.length > 0 ? (
        items.map((item, idx) => (
          <div
            key={item.key ?? item.id ?? idx}
            className={styles.dropdownItem}
            onClick={() => onSelect(item, idx)}
          >
            {renderItem ? renderItem(item, idx) : String(item.label ?? item)}
          </div>
        ))
      ) : (
        <div className="p-3 text-slate-500 text-xs italic text-center">{emptyText}</div>
      )}
    </div>
  );
});

export default Dropdown;
