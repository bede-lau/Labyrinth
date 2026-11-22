import { useCallback, useEffect, useRef, useState } from 'react';
import type { Simulation } from '../heatfield/sim';
import type { LoopDecision } from '../heatfield/ControlLoop';
import { useLiveStatus } from '../../lib/liveStatus';
import { openLogKernel } from './logKernel';
import type { TubeField } from './tubeResponse';

type Kernel = NonNullable<Awaited<ReturnType<typeof openLogKernel>>>;
type Result = Awaited<ReturnType<Kernel['read']>>;
interface RecordEntry {
  decision: LoopDecision;
  values: Result;
  source: 'WebGPU' | 'CPU';
}

function cpuSamples(tubes: readonly TubeField[], drive: ArrayLike<number>): Result {
  return tubes.map(({ tube, weights }) => {
    let index = 0,
      change = 0;
    weights.forEach((row, i) => {
      const v = row.reduce((sum, w, k) => sum + w * drive[k]!, 0);
      if (Math.abs(v) > Math.abs(change)) {
        index = i;
        change = v;
      }
    });
    return { index, change, field: tube.samples[index]!.bmag * (1 + change) };
  });
}

function WorkerFeed() {
  const live = useLiveStatus();
  if (live.status !== 'ready' || live.data.mode !== 'live') return null;
  return (
    <div className="calc-log__workers">
      <h4>Live Modal workers</h4>
      {live.data.workers.map((w) => (
        <div key={w.gpuIndex}>
          <strong>
            GPU {w.gpuIndex} · {w.tube}
          </strong>{' '}
          <small>{w.state}</small>
          {w.samples.slice(-3).map((s, i) => (
            <code key={i}>
              t {s.t.toFixed(2)} a/vₜₕ,ᵢ · Qᵢ {s.Q.toPrecision(4)} Q<sub>gB,i</sub>
            </code>
          ))}
        </div>
      ))}
    </div>
  );
}

function routeText(decision: Pick<LoopDecision, 'transfers' | 'coils'>) {
  return decision.transfers.map(r => `D${r.from+1} → D${r.to+1} · ${(100*r.fraction).toFixed(1)}%`).join(' / ') ||
    (decision.coils.some(Boolean) ? 'Sweep ' + decision.coils.flatMap((on,k) => on ? ['D'+(k+1)] : []).join(', ') : 'Hold');
}

function hottest(peaks: number[]) {
  const peak = Math.max(...peaks);
  return 'D'+(peaks.indexOf(peak)+1)+' · '+Math.round(peak)+' °C';
}

export function CalculationLog({ tubes, decision, sim, enabled }: {
  tubes: readonly TubeField[]; decision: LoopDecision | null; sim: Simulation; enabled: boolean;
}) {
  const [entries, setEntries] = useState<RecordEntry[]>([]);
  const runner = useRef<Kernel | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    let closed = false;
    const token = ++generation.current;
    setEntries([]);
    openLogKernel(tubes)
      .then((kernel) => {
        if (closed) kernel?.dispose();
        else runner.current = kernel;
      })
      .catch(() => {
        /* A browser without compute support uses the numerical CPU path. */
      });
    return () => {
      closed = true;
      generation.current = token + 1;
      runner.current?.dispose();
      runner.current = null;
    };
  }, [tubes]);

  const calculate = useCallback(async (drive: Float32Array<ArrayBuffer>): Promise<Pick<RecordEntry, 'source' | 'values'>> => {
    const kernel = runner.current;
    if (kernel && !busy.current) {
      busy.current = true;
      try {
        return {source: 'WebGPU', values: await kernel.read(drive)};
      } catch {
        if (runner.current === kernel) {
          runner.current = null;
          kernel.dispose();
        }
      } finally {
        busy.current = false;
      }
    }
    return {source: 'CPU', values: cpuSamples(tubes, drive)};
  }, [tubes]);

  const [live, setLive] = useState<(Pick<RecordEntry, 'values' | 'source'> & {
    time: number; peaks: number[]; action: string;
  }) | null>(null);
  useEffect(() => {
    if (!enabled) { setLive(null); return; }
    // Throttle presentation in wall time. Even at 1% speed the values follow
    // the solver while the decision history retains its actual model timestamps.
    let last = -Infinity;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sample = () => {
      timer = undefined;
      last = performance.now();
      const id = ++sequence;
      const time = sim.time;
      const peaks = Array.from(sim.coils, (_, k) => sim.peakTileC(k));
      const action = routeText({transfers: sim.commandedTransfers, coils: sim.commandedCoils});
      const drive = Float32Array.from(sim.model.drive(sim.coils, sim.absoluteTime));
      void calculate(drive).then(result => {
        if (id === sequence) setLive({time, peaks, action, ...result});
      });
    };
    sample();
    const unsubscribe = sim.subscribe(() => {
      if (timer !== undefined) return;
      const wait = 80 - (performance.now() - last);
      if (wait > 0) timer = setTimeout(sample, wait);
      else sample();
    });
    return () => { ++sequence; unsubscribe(); clearTimeout(timer); };
  }, [calculate, sim, enabled]);

  useEffect(() => {
    if (!decision) return;
    const token = generation.current;
    const append = (source: RecordEntry['source'], values: Result) => {
      if (token !== generation.current) return;
      setEntries((old) =>
        [{ decision, source, values }, ...old.filter((row) => row.decision.time !== decision.time)]
          .sort((a, b) => b.decision.time - a.decision.time)
          .slice(0, 8),
      );
    };
    void calculate(decision.drive).then(({source, values}) => append(source, values));
  }, [decision, calculate]);

  const latest = entries[0];
  const current = enabled ? live : null;
  const time = current?.time ?? latest?.decision.time;
  const peaks = current?.peaks ?? latest?.decision.peakTileC;
  const values = current?.values ?? latest?.values;
  return (
    <section className="calc-log" aria-label="Calculation log">
      <div className="calc-log__head">
        <h2>Calculation log</h2>
        {time !== undefined && <time className="calc-stamp">{time.toFixed(3)} s</time>}
      </div>
      {peaks && values ? <>
        <div className="calc-thermal">
          <small>{current ? 'Peak tile temperature' : 'Predicted peak tile temperature'}</small>
          <strong>{hottest(peaks)}</strong>
          <div className="calc-targets">{peaks.map((t,k) =>
            <div key={k} data-hot={t >= sim.model.params.tileLimit}>
              <span>D{k+1}</span><i style={{height: (24*t/Math.max(...peaks))+'px'}}/>
              <b>{Math.round(t)}°</b>
            </div>)}</div>
        </div>
        <div className="calc-route"><small>Control action</small><strong>{current ? current.action : latest ? routeText(latest.decision) : '—'}</strong></div>
        <div className="calc-fields">{values.map(({field,change,index},k) => {
          const tube = tubes[k]!.tube;
          return <div className="calc-field" key={tube.id} title={current?.source ?? latest?.source}>
            <span>{k === 0 ? 'Bean' : 'Triangular'} · |B|</span>
            <strong>{field.toFixed(5)} <small>B<sub>ref</sub></small></strong>
            <code>{tube.samples[index]!.bmag.toFixed(5)} × (1 {change < 0 ? '−' : '+'} {Math.abs(change).toPrecision(2)})</code>
          </div>;
        })}</div>
        <details><summary>Recent decisions</summary>
          <ol className="calc-timeline">{entries.map(({decision:d,values}) => <li key={d.time}>
            <div><time>{d.time.toFixed(3)} s</time><b>{hottest(d.peakTileC)}</b></div>
            <strong>{routeText(d)}</strong>
            <dl>{values.map((v,k) => <div key={k}><dt>{k === 0 ? 'Bean' : 'Triangular'}</dt>
              <dd>{v.field.toFixed(5)} B<sub>ref</sub></dd></div>)}</dl>
          </li>)}</ol>
        </details>
      </> : <p>{enabled ? 'Calculating…' : 'Control loop off'}</p>}
      <WorkerFeed />
    </section>
  );
}
