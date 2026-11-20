// Status semantics: every state has colour (tokens) + icon + text. Never colour alone.
import type { CalloutTone, StatusKind } from './tokens';
import type { IconName } from './components/Icon';
import type { ProvenanceKind, VerificationOutcome } from './types';

export interface StatusMeta {
  /** Visible text. */
  label: string;
  icon: IconName;
  /** One-line meaning, used for `title` tooltips and DESIGN.md. */
  description: string;
  /** Dashed outline = "not backed by data in this repo". */
  dashed?: boolean;
}

export const STATUS_META: Record<StatusKind, StatusMeta> = {
  live: {
    label: 'Live',
    icon: 'live',
    description: 'Produced now by a GX worker. Only when /api/live/status reports mode "live".',
  },
  replay: { label: 'Replay', icon: 'replay', description: 'Saved evidence played back; $0 compute.' },
  rehearsal: {
    label: 'Rehearsal',
    icon: 'rehearsal',
    description: 'A recorded GX rehearsal run played back — not live.',
  },
  archive: { label: 'Archive', icon: 'archive', description: 'Read from a pinned upstream file (sha256).' },
  derived: { label: 'Derived', icon: 'derived', description: 'Computed by Labyrinth from archived data.' },
  'prd-reported': {
    label: 'PRD-reported',
    icon: 'quote',
    description: 'Stated in PRD.md; no underlying data in this repo.',
    dashed: true,
  },
  unverified: {
    label: 'Unverified',
    icon: 'question',
    description: 'Not checked against an independent reference.',
    dashed: true,
  },
  passed: { label: 'Verified', icon: 'check', description: 'Verification passed.' },
  failed: { label: 'Failed', icon: 'alert', description: 'The run or the verification failed.' },
  blocked: { label: 'Blocked', icon: 'blocked', description: 'Cannot be checked until a missing input is provided.' },
  mismatch: { label: 'Mismatch', icon: 'cross', description: 'Claimed and computed values differ at printed precision.' },
  'not-applicable': { label: 'Not applicable', icon: 'dash', description: 'No verification applies.' },
};

export const VERIFICATION_STATUS: Record<VerificationOutcome, StatusKind> = {
  passed: 'passed',
  failed: 'failed',
  blocked: 'blocked',
  'not-applicable': 'not-applicable',
};

/** How a provenance record is shown: the status whose colours and icon it takes, and its words. */
export interface ProvenancePresentation {
  status: StatusKind;
  label: string;
  icon: IconName;
  description: string;
}

/**
 * The status a provenance `kind` is drawn with.
 *
 * LIVE cannot be produced from provenance alone. A record of kind `live` read from an artifact or a
 * saved run says how the numbers were made, not that a worker is running now, so it is shown as
 * saved evidence ("Recorded run", the replay treatment). It takes the live treatment only when
 * `live` is true, and `live` must come from the live-status path (`/api/live/status` reporting
 * mode "live"), never from the record itself. The flag has no effect on any other kind.
 */
export function provenanceStatus(kind: ProvenanceKind, live = false): ProvenancePresentation {
  if (kind === 'live' && live !== true)
    return {
      status: 'replay',
      label: 'Recorded run',
      icon: STATUS_META.replay.icon,
      description: 'Produced by a GX worker in an earlier session and read back from a saved record. Nothing is running now.',
    };
  const meta = STATUS_META[kind];
  return { status: kind, label: meta.label, icon: meta.icon, description: meta.description };
}

export const CALLOUT_META: Record<CalloutTone, { icon: IconName; spoken: string }> = {
  info: { icon: 'info', spoken: 'Note' },
  warn: { icon: 'warn', spoken: 'Warning' },
  blocked: { icon: 'blocked', spoken: 'Blocked' },
};
