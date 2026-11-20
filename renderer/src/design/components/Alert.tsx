import { useId, type ReactNode } from 'react';
import { ALERT_META } from '../status';
import { Icon } from './Icon';
import './components.css';

export interface AlertProps {
  /** What is wrong, in a few words: "TERMINATE FAILED — GPUs may still be billing". */
  title: ReactNode;
  /** The backend's own words (`reason` of /api/live/status or of a terminate answer), shown verbatim. */
  reason?: string;
  /** What the reader should do, in the app's words ("Check the Modal dashboard until …"). */
  children?: ReactNode;
  /** The control that acts on it: a Terminate / Retry button, or a link to the page that has one. */
  action?: ReactNode;
  className?: string;
}

/**
 * The loud, live danger: GPUs may still be billing (DESIGN.md §5). `role="alert"`, the billing-risk
 * treatment (solid octagon icon, raspberry tint, solid outline) and a spoken "Danger:" before the title.
 * The backend's reason is printed exactly as received: never re-cased, shortened or paraphrased.
 * For anything that is not money at risk now, use a Callout.
 */
export function Alert({ title, reason, children, action, className }: AlertProps) {
  const id = useId();
  return (
    <div
      role="alert"
      aria-labelledby={`${id}-title`}
      className={['lab-alert', className].filter(Boolean).join(' ')}
      data-status={ALERT_META.status}
    >
      <Icon name={ALERT_META.icon} size={20} className="lab-alert__icon" />
      <div className="lab-alert__content">
        <p id={`${id}-title`} className="lab-alert__title">
          <span className="lab-visually-hidden">{`${ALERT_META.spoken}:`}</span> {title}
        </p>
        {reason ? <p className="lab-alert__reason">{reason}</p> : null}
        {children ? <div className="lab-alert__body">{children}</div> : null}
        {action ? <div className="lab-alert__action">{action}</div> : null}
      </div>
    </div>
  );
}
