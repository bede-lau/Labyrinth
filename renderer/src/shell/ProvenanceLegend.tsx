import { useId, useState } from 'react';
import { STATUS_META, StatusPill, type StatusKind } from '../design';

/**
 * Groups of states the views use, in reading order. They cover every provenance kind and every
 * verification outcome of contracts/common.schema.json (App.test.tsx reads the enums from the schema);
 * `live` is the one kind that is described in words below instead of being drawn.
 */
const GROUPS: { title: string; kinds: StatusKind[] }[] = [
  { title: 'Where a number comes from', kinds: ['replay', 'archive', 'derived', 'prd-reported', 'rehearsal', 'model'] },
  { title: 'How far it is checked', kinds: ['passed', 'unverified', 'blocked', 'mismatch', 'failed', 'not-applicable'] },
];

/**
 * Global legend: every provenance and verification state, as pill + meaning (never colour alone).
 * A disclosure under every view (the owner's redesign keeps the page chrome short): its heading and toggle are
 * always on the page, the pills open on request (the APG disclosure pattern: a button with aria-expanded).
 */
export function ProvenanceLegend() {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="shell-legend" aria-labelledby="shell-legend-title">
      <h2 id="shell-legend-title" className="shell-legend__title">
        <button
          type="button"
          className="shell-legend__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <svg className="shell-legend__chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
          Provenance legend
        </button>
      </h2>
      <div id={bodyId} className="shell-legend__body" hidden={!open}>
        <p className="shell-legend__lede">
          Dashed outlines mean the value is not backed by data in this repo. Gray in plots and scenes means unsampled or
          context, never data. None of these views shows live GX output, so no LIVE pill is drawn here: while the live API
          reports a Modal session, the bar under the header says so and offers Terminate, and it becomes a danger alert
          whenever GPUs may still be billing.
        </p>
        <div className="shell-legend__groups">
          {GROUPS.map((g) => (
            <div key={g.title} className="shell-legend__group">
              <h3 className="shell-legend__group-title">{g.title}</h3>
              <dl className="shell-legend__list">
                {g.kinds.map((k) => (
                  <div key={k} className="shell-legend__item">
                    <dt>
                      <StatusPill status={k} />
                    </dt>
                    <dd>{STATUS_META[k].description}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
