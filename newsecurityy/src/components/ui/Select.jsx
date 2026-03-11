import React, { forwardRef } from 'react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const Select = forwardRef(function Select({ className = '', children, ...props }, ref) {
  return (
    <select ref={ref} className={cx(styles.input, className)} {...props}>
      {children}
    </select>
  );
});

export default Select;
