import { useEffect, useState } from 'react';
import type { Simulation } from '../heatfield/sim';
import { largestFlows, powerTransfer, type PowerTransfer } from '../heatfield/transfer';

/** Flows smaller than this are not drawn or listed (MW): below the panel's printed precision. */
const MIN_MW = 0.005;
/** Diagram size (SVG user units). */
const SIZE = 220;
const C = SIZE / 2;
const RING = 78;

/** Where divertor k sits on the top-view ring: its toroidal angle φ_k, φ = 0 to the right, counter-clockwise. */
const at = (phi: number, r = RING): [number, number] => [C + r * Math.cos(phi), C - r * Math.sin(phi)];

/** An arc round the ring from φ_a to φ_b the short way, just inside the ring (where the plasma edge is). */
function arcPath(a: number, b: number): string {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const r = RING - 16;
  const [x0, y0] = at(a + 0.12 * Math.sign(d), r);
  const [x1, y1] = at(b - 0.12 * Math.sign(d), r);
  // SVG's y points down, so a counter-clockwise turn on screen is sweep flag 0.
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 ${d > 0 ? 0 : 1} ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

const mw = (v: number) => v.toFixed(2);
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(2);

/**
 * Power moved between the divertors by the field coils (D-039), live from the model: each divertor's power share, its
 * change from the coil-free split, and who sends to whom. A top view of the torus: arrows run round the plasma edge,
 * which is where the power actually goes; heat never jumps from one plate to another.
 */
export function PowerFlow({ sim }: { sim: Simulation }) {
  const model = sim.model;
  const n = model.nDiverters;
  const [t, setT] = useState<PowerTransfer>(() => powerTransfer(model, sim.state.n, sim.coils));
  useEffect(() => {
    let key = '';
    const update = () => {
      const next = powerTransfer(model, sim.state.n, sim.coils);
      // Re-render only when a printed number changes.
      const k = Array.from(next.shares, mw).join(',') + '|' + Array.from(next.delta, mw).join(',');
      if (k !== key) {
        key = k;
        setT(next);
      }
    };
    update();
    return sim.subscribe(update);
  }, [sim, model]);
  const flows = largestFlows(t, MIN_MW);
  const widest = flows.length ? flows[0]![2] : 1;
  const total = t.shares.reduce((a, b) => a + b, 0);
  return (
    <figure className="geo-flow" aria-labelledby="geo-flow-title">
      <figcaption id="geo-flow-title">
        Power between divertors <span>model · MW</span>
      </figcaption>
      <div className="geo-flow__body">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="geo-flow__ring" role="img"
          aria-label={`Top view of the torus with divertors ${Array.from({ length: n }, (_, k) => 'D' + (k + 1)).join(', ')}. ` +
            (flows.length ? `Arrows round the plasma edge: ${flows.map(([a, b, v]) => `D${a + 1} to D${b + 1}, ${mw(v)} MW`).join('; ')}.` : 'No power is being moved: every coil is off.')}>
          <defs>
            <marker id="geo-flow-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 Z" className="geo-flow__head" />
            </marker>
          </defs>
          <circle cx={C} cy={C} r={RING - 16} className="geo-flow__edge" />
          {flows.map(([a, b, v]) => (
            <path key={a + '-' + b} d={arcPath(model.phiK[a]!, model.phiK[b]!)} className="geo-flow__arrow"
              style={{ strokeWidth: (1.5 + 5 * (v / widest)).toFixed(2) }} markerEnd="url(#geo-flow-head)" data-from={a} data-to={b} />
          ))}
          {Array.from({ length: n }, (_, k) => {
            const [x, y] = at(model.phiK[k]!);
            const d = t.delta[k]!;
            return (
              <g key={k} className="geo-flow__node" data-change={d < -MIN_MW ? 'loss' : d > MIN_MW ? 'gain' : 'none'}>
                <circle cx={x} cy={y} r={15} />
                <text x={x} y={y + 4} textAnchor="middle">D{k + 1}</text>
              </g>
            );
          })}
          <text x={C} y={C - 4} textAnchor="middle" className="geo-flow__centre">{mw(t.moved)} MW</text>
          <text x={C} y={C + 12} textAnchor="middle" className="geo-flow__centre geo-flow__centre--small">moved</text>
        </svg>
        <table className="geo-flow__table lab-num">
          <thead>
            <tr><th scope="col">Divertor</th><th scope="col">Power</th><th scope="col">Change</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, k) => (
              <tr key={k} data-testid={'flow-row-' + k}>
                <th scope="row">D{k + 1}</th>
                <td>{mw(t.shares[k]!)}</td>
                <td>{signed(t.delta[k]!)}</td>
              </tr>
            ))}
            <tr><th scope="row">Total</th><td>{mw(total)}</td><td>{signed(t.delta.reduce((a, b) => a + b, 0))}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="geo-flow__note">
        Change is against the same heating with every coil off. A coil's field shifts its divertor's island (η in MODEL.md), and the
        power it sheds is taken up by the others through the plasma edge (the share formula of MODEL.md v6), so the changes sum to
        zero. The receivers here follow the model's illustrative coil response, not traced W7-X field lines.
      </p>
    </figure>
  );
}
