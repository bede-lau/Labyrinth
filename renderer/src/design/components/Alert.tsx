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
  /**
   * Whether this copy is announced (`role="alert"`, the default). One danger is announced once: when
   * the same danger is already on the page in an announcing Alert (the header's), a second copy (the
   * live panel's) passes `false`. It is drawn the same and keeps its name, as a labelled group.
   */
  announce?: boolean;
  /**
   * The denser layout of the app header's copy: tighter padding, a 16px icon and one type step down.
   * Every part is kept in the same order; the reason is still printed whole.
   */
  compact?: boolean;
  className?: string;
}

/**
 * The loud, live danger: GPUs may still be billing (DESIGN.md §5). `role="alert"`, the billing-risk
 * treatment (solid octagon icon, raspberry tint, solid outline) and a spoken "Danger:" before the title.
 * The backend's reason is printed exactly as received: never re-cased, shortened or paraphrased.
 * For anything that is not money at risk now, use a Callout.
 *
 * What is announced is the title and the reason. The body and the action change while the alert is up
 * (Terminate → "Terminating… (send again)" → "Retry terminate", a terminate answer); in an announcing
 * Alert they sit in `aria-live="off"` sub-regions, so those changes are not announced assertively again
 * (WAI-ARIA: a change takes the politeness of its nearest ancestor that sets aria-live). They stay
 * inside the alert, so it still carries its own action.
 */
export function Alert({ title, reason, children, action, announce = true, compact = false, className }: AlertProps) {
  const id = useId();
  const quiet = announce ? ({ 'aria-live': 'off' } as const) : {};
  return (
    <div
      role={announce ? 'alert' : 'group'}
      aria-labelledby={`${id}-title`}
      className={['lab-alert', compact && 'lab-alert--compact', className].filter(Boolean).join(' ')}
      data-status={ALERT_META.status}
    >
      <Icon name={ALERT_META.icon} size={compact ? 16 : 20} className="lab-alert__icon" />
      <div className="lab-alert__content">
        <p id={`${id}-title`} className="lab-alert__title">
          <span className="lab-visually-hidden">{`${ALERT_META.spoken}:`}</span> {title}
        </p>
        {reason ? <p className="lab-alert__reason">{reason}</p> : null}
        {children ? (
          <div className="lab-alert__body" {...quiet}>
            {children}
          </div>
        ) : null}
        {action ? (
          <div className="lab-alert__action" {...quiet}>
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
