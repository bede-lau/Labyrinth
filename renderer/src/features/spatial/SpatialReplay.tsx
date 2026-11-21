import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

const STAGES = [
  { id: 'compute', label: 'Both GPUs advance their three planes' },
  { id: 'exchange', label: 'Swap edge data at both boundaries' },
  { id: 'field', label: 'CPU solves the shared field' },
  { id: 'predict', label: 'Predict where heat will reach the wall' },
  { id: 'correct', label: 'Test a change to the magnetic field' },
  { id: 'update', label: 'Read the new wall heat map' },
  { id: 'repeat', label: 'Use the updated map for the next prediction' },
] as const;
type Phase = (typeof STAGES)[number]['id'];
const FIRST_CONTROL = 3;
const LAST = STAGES.length - 1;
const PHASE_MS = 2700;

/** The wall maps are qualitative sketches. Both use the same cells so the change is visible. */
function ControlDiagram({ phase }: { phase: Phase }) {
  const labelId = useId();
  const corrected = phase !== 'predict';
  const updated = phase === 'update' || phase === 'repeat';
  const original = 'M64 130 C136 181 174 30 285 73';
  const trial = 'M64 130 C139 181 187 92 285 145';
  const heat = [0.12, 0.32, 0.82, 1, 0.53, 0.19, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08];
  const nextHeat = [0.08, 0.08, 0.10, 0.13, 0.16, 0.22, 0.32, 0.44, 0.56, 0.51, 0.39, 0.22];
  return (
    <figure className="sp-control">
      <svg viewBox="0 0 370 230" role="img" aria-labelledby={labelId}>
        <title id={labelId}>{STAGES.find(step => step.id === phase)?.label}. Illustrative heat path and wall map.</title>
        <text x="26" y="24">Plasma</text><text x="256" y="24">Wall heat map</text>
        <g className="sp-flux-lines">
          {[-18, 0, 18].map(dy => <path key={dy} transform={`translate(0 ${dy})`} d={corrected ? trial : original} />)}
        </g>
        <ellipse className="sp-plasma" cx="57" cy="126" rx="25" ry="34" transform="rotate(-20 57 126)" />
        <ellipse className="sp-core" cx="57" cy="126" rx="11" ry="18" transform="rotate(-20 57 126)" />
        {corrected && <path className="sp-old-path" d={original} />}
        <path className="sp-heat-path" d={corrected ? trial : original} />
        <path className="sp-heat-pulse" d={corrected ? trial : original} pathLength="100" />
        <g transform="translate(296 38)">
          <rect className="sp-wall" x="-5" y="-5" width="38" height="163" rx="6" />
          {(updated ? nextHeat : heat).map((value, i) => <rect key={i} className="sp-wall-cell" y={i * 13} width="28" height="10" rx="2" opacity={value} />)}
        </g>
        {phase === 'repeat' && <g className="sp-feedback">
          <path d="M289 175v17q0 8-9 8H68q-11 0-11-11v-18" />
          <path d="m51 178 6-8 6 8" />
          <text x="151" y="218" textAnchor="middle">Next forecast</text>
        </g>}
        <text className="sp-map-label" x="310" y="213" textAnchor="middle">{updated ? 'Updated map' : 'Initial map'}</text>
      </svg>
      <figcaption className="sp-cycle">
        {['Predict', 'Correct', 'Update map', '↺ Repeat'].map((label, i) => (
          <span key={label} aria-current={STAGES[FIRST_CONTROL + i]?.id === phase ? 'step' : undefined}>{label}</span>
        ))}
      </figcaption>
    </figure>
  );
}

export function SpatialReplay({ recorded, children }: { recorded: boolean; children: (phase: Phase) => ReactNode }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const remaining = useRef(PHASE_MS);
  const control = index >= FIRST_CONTROL;
  const stage = STAGES[index]!;

  useEffect(() => { remaining.current = PHASE_MS; }, [index]);

  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const timer = window.setTimeout(() => {
      if (index === LAST) {
        setPlaying(false);
        setFinished(true);
      } else {
        setIndex(index + 1);
      }
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [index, playing]);

  function go(next: number) {
    setPlaying(false);
    setFinished(false);
    setIndex(next);
  }

  function toggle() {
    if (finished) {
      setIndex(0);
      setFinished(false);
    }
    setPlaying(!playing);
  }

  return (
    <div className="sp-deck" data-playing={playing} data-stage={stage.id}>
      <div className="sp-scenes" role="group" aria-label="Replay scene">
        <button type="button" aria-pressed={!control} onClick={() => go(0)}>GPU exchange</button>
        <button type="button" aria-pressed={control} onClick={() => go(FIRST_CONTROL)}>Proposed control loop</button>
      </div>
      <div className="sp-stage" key={index}>{control ? <ControlDiagram phase={stage.id} /> : children(stage.id)}</div>
      <div className="sp-cue" role="status"><span>{index + 1} / {STAGES.length}</span>{stage.label}</div>
      <div className="sp-strip" aria-hidden="true">{STAGES.map((item, i) => <i key={item.id} data-lit={i <= index} />)}</div>
      <div className="sp-transport">
        <button type="button" onClick={toggle}><span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span> {playing ? 'Pause' : finished ? 'Replay again' : 'Play replay'}</button>
        <button type="button" aria-label="Previous stage" disabled={!index} onClick={() => go(index - 1)}>←</button>
        <button type="button" aria-label="Next stage" disabled={index === LAST} onClick={() => go(index + 1)}>→</button>
      </div>
      <p className="sp-caption">{control ? 'Proposed loop · illustrative heat maps' : recorded ? 'Saved run · illustrative exchange timing' : 'Reported layout · illustrative exchange timing'} · $0 replay</p>
    </div>
  );
}
