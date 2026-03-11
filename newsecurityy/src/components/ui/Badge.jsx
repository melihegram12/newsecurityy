import React from 'react';
import { cx } from '../../lib/utils';
import { styles } from '../../lib/tokens';

const VARIANT_CLASSES = {
  default: 'bg-zinc-700 text-zinc-300',
  blue:    'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  green:   'bg-green-500/20 text-green-400 border border-green-500/30',
  red:     'bg-red-500/20 text-red-400 border border-red-500/30',
  orange:  'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  amber:   'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  purple:  'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  yellow:  'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  cyan:    'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
};

const Badge = ({ variant = 'default', className = '', children, ...props }) => (
  <span className={cx(styles.badge, VARIANT_CLASSES[variant] || VARIANT_CLASSES.default, className)} {...props}>
    {children}
  </span>
);

export default Badge;
