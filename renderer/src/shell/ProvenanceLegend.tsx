import { STATUS_META, StatusPill, type StatusKind } from '../design';

/** Groups of states the views use, in reading order. */
const GROUPS: { title: string; kinds: StatusKind[] }[] = [
  { title: 'Where a number comes from', kinds: ['replay', 'archive', 'derived', 'prd-reported', 'rehearsal'] },
  { title: 'How far it is checked', kinds: ['passed', 'unverified', 'blocked', 'mismatch', 'failed'] },
];

/** Global legend: every provenance and verification state, as pill + meaning (never colour alone). */
export function ProvenanceLegend() {
  return (
    <section className="shell-legend" aria-labelledby="shell-legend-title">
      <h2 id="shell-legend-title" className="shell-legend__title">
        Provenance legend
      </h2>
      <p className="shell-legend__lede">
        Dashed outlines mean the value is not backed by data in this repo. Gray in plots and scenes means unsampled or
        context, never data. The solid crimson LIVE indicator appears in the header only while the live backend
        reports GX workers running; it is never shown for replayed or rehearsed data, so it is not drawn here.
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
    </section>
  );
}
