import React from 'react';
import { cx } from '../../lib/utils';

const Card = ({ className = '', ...props }) => (
  <div className={cx("ui-card", className)} {...props} />
);

export default Card;
