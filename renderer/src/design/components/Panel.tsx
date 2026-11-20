import { useId, type ReactNode } from 'react';
import './components.css';

export interface PanelProps {
  title: ReactNode;
  /** Small uppercase context above the title ("Check transport"). */
  eyebrow?: ReactNode;
  /** One line under the title: what the panel shows, in plain words. */
  subtitle?: ReactNode;
  /** Header right side, before actions: usually a ProvenanceBadge or StatusPill. */
  status?: ReactNode;
  /** Header right side: controls such as a SegmentedControl. */
  actions?: ReactNode;
  /** Caption / source line under the body. */
  footer?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  density?: 'regular' | 'compact';
  className?: string;
  children?: ReactNode;
}

/** A titled region. The heading names the landmark (section aria-labelledby). */
export function Panel({
  title,
  eyebrow,
  subtitle,
  status,
  actions,
  footer,
  headingLevel = 2,
  density = 'regular',
  className,
  children,
}: PanelProps) {
  const id = useId();
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <section
      className={['lab-panel', `lab-panel--${density}`, className].filter(Boolean).join(' ')}
      aria-labelledby={`${id}-title`}
    >
      <header className="lab-panel__header">
        <div className="lab-panel__titles">
          {eyebrow && <p className="lab-panel__eyebrow">{eyebrow}</p>}
          <H id={`${id}-title`} className="lab-panel__title">
            {title}
          </H>
          {subtitle && <p className="lab-panel__subtitle">{subtitle}</p>}
        </div>
        {(status || actions) && (
          <div className="lab-panel__meta">
            {status}
            {actions}
          </div>
        )}
      </header>
      <div className="lab-panel__body">{children}</div>
      {footer && <footer className="lab-panel__footer">{footer}</footer>}
    </section>
  );
}
