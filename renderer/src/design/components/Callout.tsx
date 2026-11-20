import { useId, type ReactNode } from 'react';
import { CALLOUT_META } from '../status';
import type { CalloutTone } from '../tokens';
import { Icon } from './Icon';
import './components.css';

export interface CalloutProps {
  tone?: CalloutTone;
  title: ReactNode;
  children?: ReactNode;
  /** Optional trailing action (link / button), e.g. "What would unblock this". */
  action?: ReactNode;
  className?: string;
}

/**
 * Inline explanation of a state that affects how to read the evidence:
 * info (context), warn (read with care), blocked (cannot be checked; says what would unblock it).
 * Static content → role="note", not an alert. The tone is spoken ("Blocked: …"), not just coloured.
 */
export function Callout({ tone = 'info', title, children, action, className }: CalloutProps) {
  const id = useId();
  const meta = CALLOUT_META[tone];
  return (
    <aside
      role="note"
      aria-labelledby={`${id}-title`}
      className={['lab-callout', `lab-callout--${tone}`, className].filter(Boolean).join(' ')}
      data-tone={tone}
    >
      <Icon name={meta.icon} size={16} className="lab-callout__icon" />
      <div className="lab-callout__content">
        <p id={`${id}-title`} className="lab-callout__title">
          <span className="lab-visually-hidden">{`${meta.spoken}:`}</span>{' '}
          {title}
        </p>
        {children && <div className="lab-callout__body">{children}</div>}
        {action && <div className="lab-callout__action">{action}</div>}
      </div>
    </aside>
  );
}
