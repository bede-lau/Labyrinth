import type { ReactNode } from 'react';
import { STATUS_META } from '../status';
import type { StatusKind } from '../tokens';
import { Icon } from './Icon';
import './components.css';

export interface StatusPillProps {
  status: StatusKind;
  /** Override the visible text (keep it a synonym of the status: "LIVE · GPU 0", "Replay · $0"). */
  children?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compact state label: colour + icon + text. `live` is the only solid-filled pill in the system
 * and carries a pulsing dot (static under reduced motion) — render it ONLY from
 * `/api/live/status` mode === "live", never for replayed data.
 */
export function StatusPill({ status, children, size = 'sm', className }: StatusPillProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={['lab-pill', `lab-pill--${size}`, className].filter(Boolean).join(' ')}
      data-status={status}
      title={meta.description}
    >
      {status === 'live' ? (
        <span className="lab-pill__dot" aria-hidden="true" />
      ) : (
        <Icon name={meta.icon} size={size === 'md' ? 14 : 12} className="lab-pill__icon" />
      )}
      <span className="lab-pill__text">{children ?? meta.label}</span>
    </span>
  );
}
