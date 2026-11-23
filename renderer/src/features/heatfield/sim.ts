// The view's running model: one state, the coil switches the user set, and listeners (the 3D scene redraws
// on every change; React refreshes at ~10 Hz). Pure TypeScript; the playback loop lives in usePlayback.
import { controlRamp, type AppliedControls, type RampSpec } from './controlRamp';
import type { HeatTransfer } from './loadBalance';
import { cloneState, type Diagnostics, type HeatModel, type ModelState } from './model';

export class Simulation {
  readonly model: HeatModel;
  /** The spun-up starting state (the view's t = 0). */
  readonly start: ModelState;
  private st: ModelState;
  private applied: AppliedControls;
  private target: AppliedControls;
  private ramp?: (step: number) => AppliedControls;
  private rampSpec?: RampSpec;
  private endStep = 0;
  controlTime = 0;
  get transfers() { return this.applied.transfers; }
  get commandedCoils() { return this.target.coils; }
  get commandedTransfers() { return this.target.transfers; }
  /** What is applied at the current solver step (mid-ramp it lies between the old and the commanded controls). */
  get appliedControls(): AppliedControls { return this.applied; }
  /** What was last commanded: the controls the model is heading for. */
  get commandedControls(): AppliedControls { return this.target; }
  /** The cross-fade still running toward the commanded controls, if any. */
  get ongoingRamp(): RampSpec | undefined { return this.rampSpec; }
  /** Solver steps one change of controls takes to apply in full. */
  get responseSteps(): number { return Math.round(this.responseSeconds / this.model.params.dt); }
  private listeners = new Set<() => void>();
  private fieldCache: { n: number; key: string; B: Float64Array } | null = null;
  /** Bumped on every change, so derived values can be cached by it. */
  version = 0;

  constructor(model: HeatModel, start: ModelState, private readonly responseSeconds = 0) {
    this.model = model;
    this.start = cloneState(start);
    this.st = cloneState(start);
    this.applied = this.target = {coils: Array<number>(model.nDiverters).fill(0), transfers: []};
  }

  get state(): ModelState {
    return this.st;
  }

  /** Applied coil amplitudes at the current solver step. */
  get coils(): readonly number[] {
    return this.applied.coils;
  }

  /** Model time since the spun-up start (s). */
  get time(): number {
    return (this.st.n - this.start.n) * this.model.params.dt;
  }

  /** Model time since the initial condition (s): the coil phase runs on this clock. */
  get absoluteTime(): number {
    return this.model.time(this.st.n);
  }

  advance(steps: number): void {
    if (steps <= 0) return;
    this.st = this.model.advance(this.st, this.coils, steps, this.transfers, this.ramp);
    if (this.ramp) {
      this.applied = this.ramp(this.st.n);
      if (this.st.n >= this.endStep) this.ramp = this.rampSpec = undefined;
    }
    this.changed();
  }

  /** Switch the field adjustment (control coil) of diverter k; takes effect at the current model time. */
  setCoil(k: number, on: boolean): void {
    if (Boolean(this.target.coils[k]) === on) return;
    this.setCoils(this.target.coils.map((v, i) => i === k ? Number(on) : v), this.target.transfers);
  }

  setCoils(coils: readonly number[], transfers: readonly HeatTransfer[] = []): void {
    const levels = coils.map(Number);
    const previous = this.target.transfers;
    if (levels.every((v,i) => v === this.target.coils[i]) && transfers.length === previous.length &&
        transfers.every((r,i) => r.from === previous[i]!.from && r.to === previous[i]!.to && r.fraction === previous[i]!.fraction)) return;
    this.target = {coils: levels, transfers: transfers.map(r => ({...r}))};
    this.controlTime = this.time;
    const steps = Math.round(this.responseSeconds / this.model.params.dt);
    if (steps > 0) {
      this.endStep = this.st.n + steps;
      this.rampSpec = {start: this.applied, end: this.target, first: this.st.n, steps};
      this.ramp = controlRamp(this.applied, this.target, this.st.n, steps);
    } else {
      this.ramp = this.rampSpec = undefined;
      this.applied = this.target;
    }
    this.changed();
  }

  /** Back to the spun-up start with every coil off. */
  reset(): void {
    this.st = cloneState(this.start);
    this.applied = this.target = {coils: this.coils.map(() => 0), transfers: []};
    this.ramp = this.rampSpec = undefined;
    this.controlTime = 0;
    this.changed();
  }

  /** |B| on the LCFS now (T), with the coil perturbation of the current coils (cached per state and coils). */
  field(): Float64Array {
    const key = this.coils.join(',');
    const fc = this.fieldCache;
    if (fc && fc.n === this.st.n && fc.key === key) return fc.B;
    const B = this.model.field(this.coils, this.st.n);
    this.fieldCache = { n: this.st.n, key, B };
    return B;
  }

  peakTileC(k: number): number {
    const n = this.model.nTheta;
    return Math.max(...this.st.tiles.subarray(k*n, (k+1)*n));
  }

  diagnostics(): Diagnostics {
    return this.model.diagnostics(this.st, this.coils, this.transfers);
  }

  /** Run a copy of the current state `steps` ahead with `coils` (default: unchanged); the running state is untouched. */
  predict(steps: number, coils?: readonly number[]): Diagnostics {
    const ongoing = !coils || coils === this.coils;
    const controls = ongoing ? this.applied : {coils, transfers: []};
    const ramp = ongoing ? this.ramp : undefined;
    const ahead = this.model.advance(this.st, controls.coils, steps, controls.transfers, ramp);
    const end = ramp?.(ahead.n) ?? controls;
    return this.model.diagnostics(ahead, end.coils, end.transfers);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Listeners subscribed now (a component that unmounts must leave none behind). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
