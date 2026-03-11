import React, { forwardRef } from 'react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const Input = forwardRef(function Input({ className = '', variant, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        styles.input,
        variant === 'uppercase' && 'uppercase text-lg tracking-widest font-mono',
        className
      )}
      {...props}
    />
  );
});

export default Input;
