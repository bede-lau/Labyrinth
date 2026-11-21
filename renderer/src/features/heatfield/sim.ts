// The view's running model: one state, the coil switches the user set, and listeners (the 3D scene redraws
// on every change; React refreshes at ~10 Hz). Pure TypeScript; the playback loop lives in usePlayback.
import { cloneState, type Diagnostics, type HeatModel, type ModelState } from './model';

export class Simulation {
  readonly model: HeatModel;
  /** The spun-up starting state (the view's t = 0). */
  readonly start: ModelState;
  private st: ModelState;
  private c: number[];
  private listeners = new Set<() => void>();
  private fieldCache: { n: number; key: string; B: Float64Array } | null = null;
  /** Bumped on every change, so derived values can be cached by it. */
  version = 0;

  constructor(model: HeatModel, start: ModelState) {
    this.model = model;
    this.start = cloneState(start);
    this.st = cloneState(start);
    this.c = new Array<number>(model.nDiverters).fill(0);
  }

  get state(): ModelState {
    return this.st;
  }

  /** Coil switches c_k (0 or 1), D1…D4. */
  get coils(): readonly number[] {
    return this.c;
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
    this.st = this.model.advance(this.st, this.c, steps);
    this.changed();
  }

  /** Switch the field adjustment (control coil) of diverter k; takes effect at the current model time. */
  setCoil(k: number, on: boolean): void {
    if ((this.c[k] === 1) === on) return;
    this.c = this.c.map((v, i) => (i === k ? (on ? 1 : 0) : v));
    this.changed();
  }

  setCoils(coils: readonly number[]): void {
    this.c = coils.map((v) => (v ? 1 : 0));
    this.changed();
  }

  /** Back to the spun-up start with every coil off. */
  reset(): void {
    this.st = cloneState(this.start);
    this.c = this.c.map(() => 0);
    this.changed();
  }

  /** |B| on the LCFS now (T), with the coil perturbation of the current coils (cached per state and coils). */
  field(): Float64Array {
    const key = this.c.join('');
    const fc = this.fieldCache;
    if (fc && fc.n === this.st.n && fc.key === key) return fc.B;
    const B = this.model.field(this.c, this.st.n);
    this.fieldCache = { n: this.st.n, key, B };
    return B;
  }

  diagnostics(): Diagnostics {
    return this.model.diagnostics(this.st, this.c);
  }

  /** Run a copy of the current state `steps` ahead with `coils` (default: unchanged); the running state is untouched. */
  predict(steps: number, coils: readonly number[] = this.c): Diagnostics {
    const ahead = this.model.advance(this.st, coils, steps);
    return this.model.diagnostics(ahead, coils);
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
