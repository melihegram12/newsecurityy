import React, { forwardRef } from 'react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const Textarea = forwardRef(function Textarea({ className = '', rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(styles.input, 'resize-none', className)}
      rows={rows}
      style={{ backgroundColor: '#0f172a', color: 'white', ...props.style }}
      {...props}
    />
  );
});

export default Textarea;
