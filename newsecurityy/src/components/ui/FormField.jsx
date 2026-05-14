import React from 'react';
import { cx } from '../../lib/utils';

const FormField = ({ label, htmlFor, helper, error, className = '', children, required }) => {
  const helperId = htmlFor ? `${htmlFor}-help` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const describedBy = [helper ? helperId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;

  const content = React.isValidElement(children)
    ? React.cloneElement(children, {
      id: children.props?.id || htmlFor,
      "aria-invalid": !!error,
      "aria-describedby": [children.props?.["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
      "aria-required": required || undefined,
    })
    : children;

  return (
    <div className={cx("space-y-1", className)}>
      {label && (
        <label className="ui-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
        </label>
      )}
      {content}
      {helper && <div id={helperId} className="ui-helper">{helper}</div>}
      {error && <div id={errorId} className="ui-error" role="alert">{error}</div>}
    </div>
  );
};

export default FormField;
