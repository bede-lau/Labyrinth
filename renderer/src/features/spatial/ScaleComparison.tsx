import { Menu } from '@base-ui/react/menu';
import { useId, useState } from 'react';
import { useViewActive } from '../../lib/viewActive';
import { Icon } from '../../design';
import { useArtifact } from '../../lib/artifacts';
import type { BudgetArtifact } from '../budget/model';

const NODES = 32;
const GPUS_PER_NODE = 4;
const HOURS = 48;
const RATES = [1, 2, 3, 4] as const;
const price = (value: number) => `$${value.toFixed(2)}`;

export function ScaleComparison() {
  const active = useViewActive();
  const budget = useArtifact<BudgetArtifact>('budget');
  const slot = budget.status === 'ready' ? budget.data.guardPlan?.slotEstimateUsd : undefined;
  const [rate, setRate] = useState(2);
  const rateLabelId = useId();
  const rateValueId = useId();
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
        <div className="sp-rate">
          <span id={rateLabelId}>Assumed $/GPU-hour</span>
          <Menu.Root key={String(active)} modal={false}>
            <Menu.Trigger className="sp-rate__trigger" aria-labelledby={`${rateLabelId} ${rateValueId}`}>
              <span id={rateValueId}>{price(rate)}</span>
              <Icon name="chevron" size={14} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className="sp-rate__positioner" align="end" sideOffset={5}>
                <Menu.Popup className="sp-rate__menu" aria-labelledby={rateLabelId}>
                  <Menu.RadioGroup value={String(rate)} onValueChange={value => setRate(Number(value))}>
                    {RATES.map(option => (
                      <Menu.RadioItem className="sp-rate__item" key={option} value={String(option)} closeOnClick>
                        {price(option)}
                        <Menu.RadioItemIndicator className="sp-rate__check">
                          <Icon name="check" size={14} />
                        </Menu.RadioItemIndicator>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
    </div>
  </section>;
}
