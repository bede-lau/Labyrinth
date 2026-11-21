import { useState } from 'react';
import { useArtifact } from '../../lib/artifacts';
import type { BudgetArtifact } from '../budget/model';

const PAPER = 'https://indico.euro-fusion.org/event/1865/contributions/6553/attachments/2779/5133/GPU_EUTERPE_applications.pdf';
const HARDWARE = 'https://www.hpc.cineca.it/systems/hardware/';
const NODES = 32;
const GPUS_PER_NODE = 4;
const HOURS = 48;

export function ScaleComparison() {
  const budget = useArtifact<BudgetArtifact>('budget');
  const slot = budget.status === 'ready' ? budget.data.guardPlan?.slotEstimateUsd : undefined;
  const [rate, setRate] = useState(2);
  const capacity = NODES * GPUS_PER_NODE;
  const gpuHours = capacity * HOURS;
  return <section className="sp-scale">
    <h2>How much compute?</h2>
    <div className="sp-scale-grid">
      <div>
        <h3>Labyrinth · two W7-X tubes</h3>
        <div className="sp-chips" aria-hidden="true"><i /><i /></div>
        <strong>2 A100 GPUs</strong>
        <p>One per tube. Both run together.</p>
        <div className="sp-price">{Number.isFinite(slot) ? `$${slot!.toFixed(2)}` : '—'} <small>estimated / 15-minute slot</small></div>
      </div>
      <div>
        <h3>Published W7-X plasma simulation</h3>
        <div className="sp-node-grid" aria-hidden="true">{Array.from({ length: NODES }, (_, i) => <i key={i} />)}</div>
        <strong>{capacity} V100 GPUs available</strong>
        <p>{NODES} nodes × {GPUS_PER_NODE} GPUs · {HOURS} hours</p>
        <div className="sp-price">${(gpuHours * rate).toLocaleString('en-US')} <small>illustrative GPU rental</small></div>
        <label className="sp-rate">Assumed $/GPU-hour
          <select value={rate} onChange={e => setRate(Number(e.target.value))}>{[1, 2, 3, 4].map(r => <option key={r} value={r}>${r.toFixed(2)}</option>)}</select>
        </label>
      </div>
    </div>
    <p className="sp-foot">Whole-reactor control · GPU count and cost unmeasured.</p>
    <details><summary>Cost assumptions and sources</summary>
      <p>The larger EUTERPE plasma run used {NODES} Marconi100 nodes for {HOURS} hours. Pricing all {capacity} available GPUs gives {gpuHours.toLocaleString('en-US')} GPU-hours. The assumed rental excludes CPU, storage and networking. Actual utilization and billing were unreported.</p>
      <p>Full-resolution local stella estimate · 32 CPU cores · 14–30 days · about $3,200–$6,400 for one tube, extrapolated from three startup steps.</p>
      <a href={PAPER}>EUTERPE run</a> · <a href={HARDWARE}>Machine specifications</a> · <a href="/artifacts/budget.json">Local cost model</a>
    </details>
  </section>;
}
