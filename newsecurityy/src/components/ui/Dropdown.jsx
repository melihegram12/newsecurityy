import React, { memo } from 'react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const Dropdown = memo(function Dropdown({ isOpen, items, onSelect, renderItem, emptyText = 'Bulunamadı.', className = '' }) {
  if (!isOpen || !Array.isArray(items)) return null;

  const handleOptionKeyDown = (event, item, idx) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(item, idx);
    }
  };

  return (
    <div className={cx(styles.dropdown, className)} role="listbox">
      {items.length > 0 ? (
        items.map((item, idx) => (
          <button
            type="button"
            key={item.key ?? item.id ?? idx}
            className={styles.dropdownItem}
            onClick={() => onSelect(item, idx)}
            onKeyDown={(event) => handleOptionKeyDown(event, item, idx)}
            role="option"
            aria-selected="false"
          >
            {renderItem ? renderItem(item, idx) : String(item.label ?? item)}
          </button>
        ))
      ) : (
        <div className="p-3 text-muted-foreground text-xs text-center" role="status">{emptyText}</div>
      )}
    </div>
  );
});

export default Dropdown;
