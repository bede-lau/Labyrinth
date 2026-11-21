// The owner's control loop (page 1, H15): 1 current heat map → 2 predict → 3 adjust the field → 4 new heat map → 1.
// Predict runs a copy of the current state ahead with the coils unchanged; New heat map runs the real state ahead
// with the field the user chose. Both are this reduced model (D-027 §6), labelled model.
import { useEffect, useState } from 'react';
import { StatusPill, formatNumber, formatSigned } from '../../design';
import type { Diagnostics } from './model';
import type { Simulation } from './sim';
import { LimitStatus } from './DiverterPanel';

export type LoopPhase = 1 | 2 | 3 | 4;

export const LOOP_STEPS: { phase: LoopPhase; title: string }[] = [
  { phase: 1, title: 'Current heat map' },
  { phase: 2, title: 'Predict' },
  { phase: 3, title: 'Adjust field' },
  { phase: 4, title: 'New heat map' },
];

export interface ControlLoopProps {
  sim: Simulation;
  ids: string[];
  /** Model time ahead (s) that Predict and New heat map run. */
  horizonS: number;
  limit: number;
  /** Current step count of the running model (a change discards a pending prediction). */
  n: number;
  /** Peak tile temperatures now (°C). */
  currentPeaks: number[];
  /** Called before Predict (the view pauses playback) and after the real state moved (refresh). */
  onPause: () => void;
  onRan: () => void;
}

interface Prediction {
  fromN: number;
  fromT: number;
  coils: number[];
  diag: Diagnostics;
}

const list = (ids: string[]) => (ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`);

export function ControlLoop({ sim, ids, horizonS, limit, n, currentPeaks, onPause, onRan }: ControlLoopProps) {
  const [phase, setPhase] = useState<LoopPhase>(1);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [achieved, setAchieved] = useState<{ diag: Diagnostics; coils: number[] } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const steps = Math.round(horizonS / sim.model.params.dt);
  const h = formatNumber(horizonS, 1);

  // The model moved on (playback, reset, another run) while a prediction was pending: it no longer applies.
  useEffect(() => {
    if ((phase === 2 || phase === 3) && prediction && n !== prediction.fromN) {
      setPhase(1);
      setPrediction(null);
      setAnnouncement('The model time moved on, so the prediction was discarded. Step 1 of 4: current heat map.');
    }
  }, [n, phase, prediction]);

  const predict = () => {
    onPause();
    const coils = [...sim.coils];
    const diag = sim.predict(steps, coils);
    setPrediction({ fromN: sim.state.n, fromT: sim.time, coils, diag });
    setAchieved(null);
    setPhase(2);
    const over = ids.filter((_, k) => diag.peakTileC[k]! > limit);
    setAnnouncement(
      `Step 2 of 4, predict: at t = ${formatNumber(sim.time + horizonS, 2)} s with the field unchanged, ` +
        (over.length ? `${list(over)} ${over.length === 1 ? 'is' : 'are'} predicted above the ${formatNumber(limit, 0)} °C limit.` : 'every diverter is predicted below the limit.'),
    );
  };

  const adjust = () => {
    if (!prediction) return;
    const over = prediction.diag.peakTileC.map((v) => v > limit);
    sim.setCoils(sim.coils.map((c, k) => (over[k] ? 1 : c)));
    onRan();
    setPhase(3);
    const chosen = ids.filter((_, k) => over[k]);
    setAnnouncement(
      `Step 3 of 4, adjust field: ` +
        (chosen.length ? `field adjustment switched on for ${list(chosen)}.` : 'no diverter is predicted above the limit; no adjustment is suggested.') +
        ' Change any toggle, then run the new heat map.',
    );
  };

  const runAhead = () => {
    if (!prediction) return;
    const coils = [...sim.coils];
    sim.advance(steps);
    const diag = sim.diagnostics();
    setAchieved({ diag, coils });
    setPhase(4);
    onRan();
    setAnnouncement(
      `Step 4 of 4, new heat map at t = ${formatNumber(sim.time, 2)} s: ` +
        ids.map((id, k) => `${id} ${formatNumber(diag.peakTileC[k]!, 0)} °C (predicted ${formatNumber(prediction.diag.peakTileC[k]!, 0)} °C)`).join(', ') +
        '.',
    );
  };

  const back = () => {
    setPhase(1);
    setPrediction(null);
    setAchieved(null);
    setAnnouncement('Step 1 of 4: current heat map.');
  };

  return (
    <div className="hf-loop">
      <ol className="hf-loop__steps" aria-label="Control loop steps">
        {LOOP_STEPS.map((s) => (
          <li key={s.phase} className="hf-loop__step" aria-current={s.phase === phase ? 'step' : undefined} data-done={s.phase < phase ? 'true' : 'false'}>
            <span className="hf-loop__num" aria-hidden="true">
              {s.phase}
            </span>
            <span className="hf-loop__title">{s.title}</span>
          </li>
        ))}
      </ol>

      <div className="hf-loop__body">
        {phase === 1 && (
          <>
            <p className="hf-loop__text">
              Now (t = {formatNumber(sim.time, 2)} s): peak tile temperatures{' '}
              <span className="lab-num">{ids.map((id, k) => `${id} ${formatNumber(currentPeaks[k]!, 0)} °C`).join(' · ')}</span> <StatusPill status="model" />
            </p>
            <button type="button" className="hf-btn hf-btn--primary" onClick={predict}>
              Predict {h} s ahead
            </button>
          </>
        )}
        {phase >= 2 && prediction && (
          <div className="hf-table-wrap" role="region" aria-label="Predicted and achieved peak tile temperatures" tabIndex={0}>
            <table className="hf-table">
              <caption className="hf-loop__caption">
                Peak tile temperature at t = {formatNumber(prediction.fromT + horizonS, 2)} s (°C) <StatusPill status="model" />
              </caption>
              <thead>
                <tr>
                  <th scope="col">Diverter</th>
                  <th scope="col" className="hf-num">
                    Predicted, field unchanged
                  </th>
                  {achieved && (
                    <>
                      <th scope="col" className="hf-num">
                        Achieved, adjusted field
                      </th>
                      <th scope="col" className="hf-num">
                        Δ
                      </th>
                    </>
                  )}
                  <th scope="col">{achieved ? 'Achieved vs limit' : 'Predicted vs limit'}</th>
                </tr>
              </thead>
              <tbody>
                {ids.map((id, k) => {
                  const p = prediction.diag.peakTileC[k]!;
                  const a = achieved?.diag.peakTileC[k];
                  return (
                    <tr key={id} data-diverter={id}>
                      <th scope="row">
                        {id}
                        {achieved && achieved.coils[k] ? <span className="hf-loop__adj"> · adjusted</span> : null}
                      </th>
                      <td className="hf-num lab-num" data-testid={`predicted-${id}`}>
                        {formatNumber(p, 0)}
                      </td>
                      {achieved && a !== undefined && (
                        <>
                          <td className="hf-num lab-num" data-testid={`achieved-${id}`}>
                            {formatNumber(a, 0)}
                          </td>
                          <td className="hf-num lab-num">{formatSigned(a - p, 0)}</td>
                        </>
                      )}
                      <td>
                        <LimitStatus value={a ?? p} limit={limit} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {phase === 2 && (
          <button type="button" className="hf-btn hf-btn--primary" onClick={adjust}>
            Adjust field
          </button>
        )}
        {phase === 3 && (
          <>
            <p className="hf-loop__text">
              Diverters predicted above the limit have their field adjustment switched on. Change any toggle in the diverter table, then
              run the real model {h} s ahead with that field.
            </p>
            <button type="button" className="hf-btn hf-btn--primary" onClick={runAhead}>
              New heat map: run {h} s
            </button>
          </>
        )}
        {phase === 4 && (
          <button type="button" className="hf-btn hf-btn--primary" onClick={back}>
            Back to step 1
          </button>
        )}
      </div>
      <p className="hf-small">
        The Predict step runs this reduced model; the GENE-X spatial-parallel run cannot predict here (no checkpoints, see{' '}
        <a href="#/spatial">Spatial parallelism</a>).
      </p>
      <div className="lab-visually-hidden" aria-live="polite" aria-atomic="true" data-testid="loop-announcer">
        {announcement}
      </div>
    </div>
  );
}
