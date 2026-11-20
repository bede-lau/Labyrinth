import { useEffect, useId, useRef, useState } from 'react';
import { trimNumber } from '../format';
import { STATUS_META, VERIFICATION_STATUS, provenanceStatus } from '../status';
import type { Provenance } from '../types';
import { Icon } from './Icon';
import { StatusPill } from './StatusPill';
import { Unit } from './Unit';
import './components.css';

export interface ProvenanceBadgeProps {
  provenance: Provenance;
  /** What the provenance is for, used in the accessible name: "stella bean trace". */
  subject?: string;
  /**
   * Pass `true` ONLY from the live-status path, when `/api/live/status` reports mode "live" right
   * now (`isLive(state)` in `lib/liveStatus.ts`). Without it a record of kind `live` — which is
   * what an artifact or a saved run carries — is drawn as "Recorded run" with the replay
   * treatment, never as LIVE. The flag does nothing for any other kind. Default `false`.
   */
  live?: boolean;
  defaultOpen?: boolean;
  /** Which edge of the badge the detail card aligns to. Default 'end' (badges sit at a panel's right). */
  align?: 'start' | 'end';
  className?: string;
}

const shortHash = (sha: string) => (sha === 'n/a' ? 'n/a' : `${sha.slice(0, 10)}…`);
/** Only absolute http(s) addresses become links. */
const isWebUrl = (url: string) => /^https?:\/\/\S/i.test(url);

/**
 * Compact provenance: kind + verification outcome. Click (or Enter/Space) to expand the record the
 * PRD requires with every result — solver revision, units, coverage, runtime, verification, sources.
 * Escape closes it and returns focus to the badge. A click outside closes it and leaves focus where
 * the click landed.
 */
export function ProvenanceBadge({
  provenance,
  subject,
  live = false,
  defaultOpen = false,
  align = 'end',
  className,
}: ProvenanceBadgeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const kindMeta = provenanceStatus(provenance.kind, live);
  const outcomeStatus = VERIFICATION_STATUS[provenance.verification.outcome];
  const outcomeMeta = STATUS_META[outcomeStatus];
  const { tStart, tEnd } = provenance.coverage;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const name = `Provenance${subject ? ` of ${subject}` : ''}: ${kindMeta.label}, ${outcomeMeta.label}`;

  return (
    <div
      ref={rootRef}
      className={['lab-prov', `lab-prov--${align}`, className].filter(Boolean).join(' ')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="lab-prov__toggle"
        aria-expanded={open}
        aria-controls={`${id}-detail`}
        aria-label={name}
        onClick={() => setOpen((o) => !o)}
      >
        <StatusPill status={kindMeta.status}>{kindMeta.label}</StatusPill>
        <StatusPill status={outcomeStatus} />
        <Icon name="chevron" size={12} className="lab-prov__chev" />
      </button>
      <div
        id={`${id}-detail`}
        className="lab-prov__detail"
        role="region"
        aria-label={`${name} — details`}
        hidden={!open}
      >
        <p className="lab-prov__lede">
          <strong>{kindMeta.label}.</strong> {kindMeta.description}
        </p>
        <dl className="lab-prov__list">
          <dt>Solver revision</dt>
          <dd className="lab-mono">{provenance.solverRevision}</dd>
          <dt>Units</dt>
          <dd>
            <Unit unit={provenance.units} />
          </dd>
          <dt>Coverage</dt>
          <dd>
            {provenance.coverage.description}
            {tStart != null && tEnd != null && (
              <span className="lab-prov__range lab-num">
                {' '}
                (t {trimNumber(tStart)}–{trimNumber(tEnd)})
              </span>
            )}
          </dd>
          <dt>Runtime</dt>
          <dd className="lab-num">{provenance.runtime}</dd>
          <dt>Verification</dt>
          <dd>
            <span className="lab-prov__outcome" data-status={outcomeStatus}>
              <Icon name={outcomeMeta.icon} size={12} />
              {outcomeMeta.label}
            </span>{' '}
            {provenance.verification.details}
          </dd>
          <dt>Sources</dt>
          <dd>
            {provenance.sources.length === 0 ? (
              <span className="lab-prov__none">None recorded</span>
            ) : (
              <ul className="lab-prov__sources">
                {provenance.sources.map((s, i) => (
                  <li key={`${i}|${s.url}|${s.sha256}`}>
                    {isWebUrl(s.url) ? (
                      <a href={s.url} target="_blank" rel="noreferrer noopener">
                        {s.label}
                        <Icon name="external" size={11} />
                        <span className="lab-visually-hidden"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      // A repository file ("PRD.md") or anything else that is not a web address: named,
                      // never linked (a relative href would open the app shell, a scheme could run code).
                      <span className="lab-prov__source-text">{s.label}</span>
                    )}
                    {!isWebUrl(s.url) && s.url && s.url !== s.label && s.url !== s.path && (
                      <span className="lab-prov__ref lab-mono">{s.url}</span>
                    )}
                    <span className="lab-prov__hash lab-mono" title={`sha256 ${s.sha256}`}>
                      sha256 {shortHash(s.sha256)}
                    </span>
                    {s.path && <span className="lab-prov__path lab-mono">{s.path}</span>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </div>
    </div>
  );
}
