// Status semantics: every state has colour (tokens) + icon + text. Never colour alone.
import type { CalloutTone, StatusKind } from './tokens';
import type { IconName } from './components/Icon';
import type { VerificationOutcome } from './types';

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

export const CALLOUT_META: Record<CalloutTone, { icon: IconName; spoken: string }> = {
  info: { icon: 'info', spoken: 'Note' },
  warn: { icon: 'warn', spoken: 'Warning' },
  blocked: { icon: 'blocked', spoken: 'Blocked' },
};
