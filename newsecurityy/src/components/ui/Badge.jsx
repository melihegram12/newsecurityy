import React from 'react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const VARIANT_CLASSES = {
  default: 'bg-secondary/70 text-secondary-foreground border border-border/60',
  blue:    'bg-sky-500/10 text-sky-300 border border-sky-500/30',
  green:   'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
  red:     'bg-red-500/10 text-red-300 border border-red-500/30',
  orange:  'bg-orange-500/10 text-orange-300 border border-orange-500/30',
  amber:   'bg-amber-500/10 text-amber-300 border border-amber-500/30',
  purple:  'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30',
  yellow:  'bg-yellow-500/10 text-yellow-300 border border-yellow-500/30',
  cyan:    'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30',
};

const Badge = ({ variant = 'default', className = '', children, ...props }) => (
  <span className={cx(styles.badge, VARIANT_CLASSES[variant] || VARIANT_CLASSES.default, className)} {...props}>
    {children}
  </span>
);

export default Badge;
