import React from 'react';
import { cx } from '../../lib/utils';

const Button = ({ variant = 'primary', size = 'md', className = '', ...props }) => (
  <button
    className={cx(
      "ui-btn",
      variant === 'primary' && "ui-btn-primary",
      variant === 'secondary' && "ui-btn-secondary",
      variant === 'ghost' && "ui-btn-ghost",
      variant === 'destructive' && "ui-btn-destructive",
      size === 'sm' && "px-3 py-1.5 text-xs",
      size === 'md' && "px-4 py-2",
      size === 'lg' && "px-5 py-2.5 text-base",
      className
    )}
    {...props}
  />
);

export default Button;
