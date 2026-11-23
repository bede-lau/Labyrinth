// H7, H9–H16: the Heat & field view in jsdom. WebGL and Plotly do not exist here: the two adapters are replaced by
// recorders, and what the view hands them (and every DOM read-out around them) is checked against values computed
// independently from the committed artifact.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatNumber, heatColor, themes, trimNumber } from '../../design';
import { deltaE2000, hexToLab } from '../../design/color';
import { declared, parseCss, rulesFor } from '../../design/cssRules';
import { CHART_INTERVAL_MS, FrameTicker, UI_INTERVAL_MS } from './playback';
import { rgbToHex } from './scene';
import { App } from '../../shell/App';
import { EquationPanel } from './EquationPanel';
import { FieldChart } from './FieldChart';
import type { HeatSceneProps } from './HeatScene';
import { HORIZON_S, HeatFieldContent, HeatFieldView } from './HeatFieldView';
import { modelFor, spunUpState } from './model';
import { Simulation } from './sim';
import type { PlotlyChartProps } from './PlotlyChart';
import type { HeatfieldArtifact } from './types';

const rec = vi.hoisted(() => ({ scene: [] as unknown[], chart: [] as unknown[] }));
vi.mock('./HeatScene', () => ({
  HeatScene: (p: HeatSceneProps) => {
    rec.scene.push(p);
    return (
      <div data-testid="scene" role="img" aria-label={p.label}>
        {p.overlay}
      </div>
    );
  },
}));
vi.mock('./PlotlyChart', () => ({
  PlotlyChart: (p: PlotlyChartProps) => {
    rec.chart.push(p);
    return (
      <figure data-testid="chart" aria-label={p.ariaLabel}>
        <figcaption>{p.summary}</figcaption>
      </figure>
    );
  },
}));

const PATH = resolve(__dirname, '../../../../artifacts/heatfield.json');
const RAW = readFileSync(PATH, 'utf8');
const ART = JSON.parse(RAW) as HeatfieldArtifact;
const model = modelFor(ART);
const start = spunUpState(model);
const P = model.params;
const OFF = [0, 0, 0, 0];
const IDS = ['D1', 'D2', 'D3', 'D4'];
const coldOff = ART.model.golden.scenarios[0]!.checkpoints.find((c) => c.step === 3000)!;

const lastScene = () => rec.scene[rec.scene.length - 1] as HeatSceneProps;
const lastChart = () => rec.chart[rec.chart.length - 1] as PlotlyChartProps;
/** The read-out row whose key is `k` ("Temperature", "|B|", …). */
const readOutRow = (box: HTMLElement, k: string) =>
  [...box.querySelectorAll<HTMLElement>('.hf-readout__row')].find((r) => r.querySelector('.hf-readout__k')?.textContent === k)!;
/** MODEL.md, independently of model.ts: g(x, σ), wrap(x) and the coil envelope h_k at plane j, θ index i. */
const gauss = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));
const wrapAngle = (x: number) => x - 2 * Math.PI * Math.floor(x / (2 * Math.PI) + 0.5);
const envelope = (k: number, j: number, i: number) =>
  gauss(wrapAngle((2 * Math.PI * j) / 72 - ART.diverters.items[k]!.phi), P.sigmaCoilPhi) *
  gauss(wrapAngle((2 * Math.PI * i) / 48 - ART.diverters.thetaCentre), P.sigmaCoilTheta);
const panel = (name: string | RegExp) => screen.getByRole('region', { name });
const modelTime = () => screen.getByTestId('model-time');
const divRow = (id: string) => document.querySelector<HTMLElement>(`.hf-div__table tr[data-diverter="${id}"]`)!;
const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((td) => td.textContent ?? '');

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    matches: reduce && q.includes('reduced-motion'),
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** A hand-driven requestAnimationFrame: `run(now)` calls every queued frame once at time `now` (ms). */
function installRaf() {
  let next = 1;
  const queue = new Map<number, (now: number) => void>();
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    queue.set(next, cb);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  return {
    pending: () => queue.size,
    run(now: number) {
      const cbs = [...queue.values()];
      queue.clear();
      act(() => cbs.forEach((cb) => cb(now)));
    },
  };
}

const renderContent = (autoPlay = false) => render(<HeatFieldContent art={ART} autoPlay={autoPlay} />);

beforeEach(() => {
  rec.scene.length = 0;
  rec.chart.length = 0;
  stubMatchMedia(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------- H7

test('the retired heat route opens the W7-X model', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  history.replaceState(null, '', '#/heat');
  render(<App pollMs={60_000} />);
  await waitFor(() => expect(location.hash).toBe('#/locate'));
  expect(screen.getByRole('main')).toHaveAccessibleName('W7-X Model');
  expect(screen.queryByRole('link', {name: /Heat & field/})).toBeNull();
});

test('H7 a broken or missing artifact shows an error panel naming artifacts/heatfield.json and the problem', async () => {
  const bad = structuredClone(ART);
  bad.surfaces[8]!.B.pop();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bad), { status: 200 })));
  const a = render(<HeatFieldView />);
  expect(await screen.findByRole('heading', { name: 'Could not load artifacts/heatfield.json' })).toBeInTheDocument();
  expect(screen.getByText('artifacts/heatfield.json: surfaces[8].B has 3455 values, expected nTheta × nPhi = 48 × 72 = 3456')).toBeInTheDocument();
  expect(rec.scene).toHaveLength(0);
  a.unmount();

  const noDiv = structuredClone(ART);
  noDiv.diverters.items = noDiv.diverters.items.slice(0, 3);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(noDiv), { status: 200 })));
  const b = render(<HeatFieldView />);
  expect(await screen.findByText('artifacts/heatfield.json: expected exactly four diverters D1–D4, found 3')).toBeInTheDocument();
  b.unmount();

  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  render(<HeatFieldView />);
  expect(await screen.findByRole('heading', { name: 'Could not load artifacts/heatfield.json' })).toBeInTheDocument();
  expect(screen.getByText('/artifacts/heatfield.json: HTTP 404')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------------------------- H9

test('H9 the scene starts from the spun-up state, colours by temperature or |B| with labelled colour bars, and toggles field lines and arrows', async () => {
  const user = userEvent.setup();
  renderContent();
  let s = lastScene();
  // The view's t = 0 is the state after parameters.spinup with every coil off.
  expect(s.sim.state.n).toBe(Math.round(P.spinup / P.dt));
  expect(Array.from(s.sim.state.T)).toEqual(Array.from(start.T));
  expect(s.sim.coils).toEqual(OFF);
  expect([s.colorBy, s.showLines, s.showArrows]).toEqual(['temperature', true, false]);
  // Fixed temperature range: the coldest start value rounded down to 0.05 keV, to T_ped.
  expect(s.ranges.lcfsT[1]).toBe(P.Tped);
  expect(formatNumber(s.ranges.lcfsT[0], 2)).toBe('0.65');

  const scene = panel('W7-X last closed flux surface: model temperature and |B|');
  const tempBar = within(scene).getByRole('img', { name: /^Colour bar: Temperature in keV from 0\.65 \(coldest end in yellow\) to 1\.00 \(hottest end in red\)/ });
  expect(tempBar).toHaveAccessibleName(/anything colder takes the coldest colour/);
  const tempHead = tempBar.closest('.hf-colorbar')!;
  expect(tempHead).toHaveTextContent('Temperature (keV)');
  expect(tempHead.querySelector('[data-status="model"]')).not.toBeNull();

  await user.click(within(scene).getByRole('radio', { name: '|B| (VMEC)' }));
  s = lastScene();
  expect(s.colorBy).toBe('field');
  const [lo, hi] = s.ranges.B;
  const fieldBar = within(scene).getByRole('img', {
    name: new RegExp(`^Colour bar: \\|B\\| in T from ${formatNumber(lo, 2)} \\(weakest end in green\\) to ${formatNumber(hi, 2)} \\(strongest end in dark blue\\)`),
  });
  expect(fieldBar.closest('.hf-colorbar')!.querySelector('[data-status="derived"]')).toHaveTextContent('Derived (VMEC)');
  // The |B| range covers every surface and coil state, so no colour clamps.
  expect(lo).toBeLessThan(Math.min(...ART.surfaces[8]!.B));
  expect(hi).toBeGreaterThan(Math.max(...ART.surfaces[8]!.B));

  await user.click(screen.getByRole('checkbox', { name: 'Magnetic field lines' }));
  expect(lastScene().showLines).toBe(false);
  await user.click(screen.getByRole('checkbox', { name: 'Heat-flow arrows' }));
  expect(lastScene().showArrows).toBe(true);
  expect(within(scene).getByRole('list', { name: 'Scene key' })).toHaveTextContent('Heat flow (model), length ∝ √magnitude');
  // The text summary (also the WebGL fallback) carries the numbers.
  const summary = screen.getByTestId('scene-summary');
  expect(lastScene().describedBy).toBe(summary.id);
  expect(summary).toHaveTextContent(`mean ${formatNumber(coldOff.meanT, 3)} keV`);
  expect(summary).toHaveTextContent('Diverter plates D1, D2, D3, D4 at φ 0°, 90°, 180°, 270°, θ 90° ± 20°');
});

// ---------------------------------------------------------------------------------------------- H10

test('H10 hovering the 3D surface or a cross-section cell shows temperature (keV, model), |B| (T) and the angles', () => {
  renderContent();
  const cell = 18 * 48 + 12; // φ 90°, θ 90°: the D2 footprint
  act(() => lastScene().onHover!({ cell, x: 40, y: 50 }));
  const box = screen.getByTestId('scene-readout');
  expect(box).toHaveTextContent(`Temperature ${formatNumber(start.T[cell]!, 3)} keV`);
  expect(box).toHaveTextContent(`|B| ${formatNumber(ART.surfaces[8]!.B[cell]!, 3)} T`);
  expect(box).toHaveTextContent('Angles φ 90° · θ 90°');
  expect(box.querySelector('[data-status="model"]')).not.toBeNull();
  expect(box.querySelector('[data-status="derived"]')).toHaveTextContent('Derived (VMEC)');
  // Every coil off: |B| is the VMEC value alone, so its row carries no model pill.
  expect(readOutRow(box, '|B|').querySelector('[data-status="model"]')).toBeNull();
  expect(box).not.toHaveTextContent('coil perturbation');
  // Linked to the |B| chart: a pointer marker at the hovered φ.
  expect(lastChart().layout.shapes?.find((x) => x.name === 'pointer')?.x0).toBe(90);
  act(() => lastScene().onHover!(null));
  expect(screen.queryByTestId('scene-readout')).toBeNull();
  expect(lastChart().layout.shapes?.some((x) => x.name === 'pointer')).toBe(false);

  // Cross-section cell between ρ 0.875 and 1, θ 90°–97.5° at φ 0: the mean of its four nodes from MODEL.md's formulas.
  const path = document.querySelector('[data-cell="7:12"]')!;
  fireEvent.pointerMove(path, { clientX: 100, clientY: 80 });
  const sbox = screen.getByTestId('slice-readout');
  const Txs = (m: number, i: number) => {
    const rho = ART.surfaces[m]!.rho;
    const core = P.Tped + (P.Tcore0 - P.Tped) * (1 - rho * rho) ** 2;
    const w = Math.max(0, (rho - P.rhoBlend) / (1 - P.rhoBlend)) ** 2;
    return core + w * (start.T[i]! - P.Tped);
  };
  const meanT = (Txs(7, 12) + Txs(7, 13) + Txs(8, 12) + Txs(8, 13)) / 4;
  const B = (m: number, i: number) => ART.surfaces[m]!.B[i]!;
  const meanB = (B(7, 12) + B(7, 13) + B(8, 12) + B(8, 13)) / 4;
  expect(sbox).toHaveTextContent(`Temperature ${formatNumber(meanT, 3)} keV`);
  expect(sbox).toHaveTextContent(`|B| ${formatNumber(meanB, 3)} T`);
  expect(sbox).toHaveTextContent('Where φ 0° · θ 94° · ρ 0.875–1.000');
  fireEvent.pointerLeave(path.parentElement!);
  expect(screen.queryByTestId('slice-readout')).toBeNull();

  // Without a mouse: the slice summary names the lowest and highest values and where they are.
  const table = screen.getByTestId('slice-summary');
  let tMin = Infinity;
  for (let i = 0; i < 48; i++) tMin = Math.min(tMin, start.T[i]!);
  const tRow = within(table).getByRole('row', { name: /^Temperature \(keV\)/ });
  expect(tRow).toHaveTextContent(`${formatNumber(tMin, 3)} at ρ 1.000`);
  expect(tRow).toHaveTextContent(`${formatNumber(P.Tcore0, 3)} at axis`);
});

test('H10 H16 with a field adjustment on, |B| in the read-outs, the slice summary and the text summary is VMEC plus the model coil perturbation, and says so', async () => {
  const user = userEvent.setup();
  renderContent();
  await user.click(screen.getByRole('button', { name: 'Field adjustment D2' }));
  // The view's t = 0 is t_abs = spinup, where cos(2πf·t) = 1: the D2 coil drives at full amplitude.
  const a = Math.cos(2 * Math.PI * P.sweepFrequency * model.time(start.n));
  expect(a).toBeCloseTo(1, 9);
  const cell = 18 * 48 + 12; // φ 90°, θ 90°: the centre of the D2 coil
  const Bs = ART.surfaces[8]!.B[cell]!;
  const Bp = Bs * (1 + P.epsilon * (a * envelope(1, 18, 12)));
  expect(formatNumber(Bp, 3)).not.toBe(formatNumber(Bs, 3)); // the perturbation shows at the printed precision

  act(() => lastScene().onHover!({ cell, x: 40, y: 50 }));
  const box = screen.getByTestId('scene-readout');
  expect(box).toHaveTextContent(`|B| ${formatNumber(Bp, 3)} T`);
  const bRow = readOutRow(box, '|B|');
  expect(bRow.querySelector('[data-status="derived"]')).toHaveTextContent('Derived (VMEC)');
  expect(bRow.querySelector('[data-status="model"]')).toHaveTextContent('Model (coil perturbation)');
  expect(readOutRow(box, 'Temperature').querySelector('[data-status="model"]')).toHaveTextContent('Model');

  // The slice at D2 (φ 90°): B_xs = B_m·(1 + ρ_m²·ε·Σ a_k h_k), the cell value the mean of its four nodes.
  await user.click(screen.getByRole('button', { name: 'Go to D2' }));
  fireEvent.pointerMove(document.querySelector('[data-cell="7:12"]')!, { clientX: 100, clientY: 80 });
  const Bxs = (m: number, i: number) => {
    const rho = ART.surfaces[m]!.rho;
    return ART.surfaces[m]!.B[18 * 48 + i]! * (1 + rho * rho * P.epsilon * (a * envelope(1, 18, i)));
  };
  const meanB = (Bxs(7, 12) + Bxs(7, 13) + Bxs(8, 12) + Bxs(8, 13)) / 4;
  const sbox = screen.getByTestId('slice-readout');
  expect(sbox).toHaveTextContent(`|B| ${formatNumber(meanB, 3)} T`);
  expect(readOutRow(sbox, '|B|').querySelector('[data-status="model"]')).toHaveTextContent('Model (coil perturbation)');
  expect(readOutRow(sbox, '|B|').querySelector('[data-status="derived"]')).toHaveTextContent('Derived (VMEC)');

  const bSummary = () => within(screen.getByTestId('slice-summary')).getByRole('row', { name: /^\|B\| \(T\)/ });
  expect(bSummary().querySelector('[data-status="model"]')).toHaveTextContent('Model (coil perturbation)');
  expect(screen.getByTestId('scene-summary')).toHaveTextContent('|B| (VMEC with the illustrative coil perturbation of D2 (model)) runs from');
  const lcfsB = screen.getByTestId('lcfs-table').querySelectorAll('thead th')[2]!;
  expect(lcfsB).toHaveTextContent(/^\|B\| \(T\)/);
  expect(lcfsB.querySelector('[data-status="model"]')).toHaveTextContent('Model (coil perturbation)');

  // Every adjustment off: |B| is the VMEC value again and no |B| label claims a perturbation.
  await user.click(screen.getByRole('button', { name: 'All adjustments off' }));
  act(() => lastScene().onHover!({ cell, x: 40, y: 50 }));
  const off = screen.getByTestId('scene-readout');
  expect(off).toHaveTextContent(`|B| ${formatNumber(Bs, 3)} T`);
  expect(readOutRow(off, '|B|').querySelector('[data-status="model"]')).toBeNull();
  expect(bSummary().querySelector('[data-status="model"]')).toBeNull();
  expect(screen.getByTestId('scene-summary')).toHaveTextContent('|B| (VMEC) runs from');
  expect(screen.queryByTestId('field-status')).toBeNull();
});

test('H10 without a mouse: the slice is one focusable group whose arrow keys move a cursor over the cells and show and announce the same read-out', async () => {
  const user = userEvent.setup();
  renderContent();
  const group = screen.getByRole('group', { name: 'Cross-section cells at φ 0°' });
  expect(group).toHaveAccessibleDescription(/← → step along θ, ↑ ↓ step outward and inward across the flux surfaces/);
  const announcer = screen.getByTestId('slice-announcer');
  expect(announcer).toHaveAttribute('aria-live', 'polite');
  expect(announcer).toHaveTextContent('');

  // Reached with Tab right after the Go to buttons; it starts on the outermost ring at the strike-line θ.
  screen.getByRole('button', { name: 'Go to D4' }).focus();
  await user.tab();
  expect(group).toHaveFocus();
  const Txs = (m: number, i: number) => {
    const rho = ART.surfaces[m]!.rho;
    const core = P.Tped + (P.Tcore0 - P.Tped) * (1 - rho * rho) ** 2;
    const w = Math.max(0, (rho - P.rhoBlend) / (1 - P.rhoBlend)) ** 2;
    return core + w * (start.T[i]! - P.Tped);
  };
  const cellT = (m: number, i: number) => (Txs(m, i) + Txs(m, (i + 1) % 48) + Txs(m + 1, i) + Txs(m + 1, (i + 1) % 48)) / 4;
  const B = (m: number, i: number) => ART.surfaces[m]!.B[i % 48]!;
  const cellB = (m: number, i: number) => (B(m, i) + B(m, i + 1) + B(m + 1, i) + B(m + 1, i + 1)) / 4;
  const rho = (m: number) => formatNumber(ART.surfaces[m]!.rho, 3);
  const expectCell = (m: number, i: number, thetaDeg: string) => {
    const box = screen.getByTestId('slice-readout');
    expect(box).toHaveTextContent(`Temperature ${formatNumber(cellT(m, i), 3)} keV`);
    expect(box).toHaveTextContent(`|B| ${formatNumber(cellB(m, i), 3)} T`);
    expect(box).toHaveTextContent(`Where φ 0° · θ ${thetaDeg} · ρ ${rho(m)}–${rho(m + 1)}`);
    expect(readOutRow(box, 'Temperature').querySelector('[data-status="model"]')).not.toBeNull();
    expect(screen.getByTestId('slice-cursor')).toHaveAttribute('data-cell', `${m}:${i}`);
    expect(announcer).toHaveTextContent(
      `Temperature ${formatNumber(cellT(m, i), 3)} keV (model), |B| ${formatNumber(cellB(m, i), 3)} T (VMEC), at φ 0°, θ ${thetaDeg}, ρ ${rho(m)}–${rho(m + 1)}.`,
    );
  };
  expectCell(7, 12, '94°'); // the same cell and numbers as the pointer read-out above

  await user.keyboard('{ArrowRight}');
  expectCell(7, 13, '101°');
  await user.keyboard('{ArrowDown}');
  expectCell(6, 13, '101°');
  await user.keyboard('{Home}');
  expectCell(0, 13, '101°');
  await user.keyboard('{ArrowDown}'); // already the innermost ring
  expectCell(0, 13, '101°');
  await user.keyboard('{End}');
  expectCell(7, 13, '101°');
  await user.keyboard('{ArrowUp}'); // already the outermost ring
  expectCell(7, 13, '101°');
  await user.keyboard('{ArrowLeft>14/}'); // wraps round θ: 13 − 14 = −1 → 47
  expectCell(7, 47, '356°');

  await user.keyboard('{Escape}');
  expect(screen.queryByTestId('slice-readout')).toBeNull();
  expect(screen.queryByTestId('slice-cursor')).toBeNull();
  await user.keyboard('{ArrowRight}'); // back from the start cell
  expectCell(7, 13, '101°');

  // Leaving the group hides the read-out and clears the announcement.
  await user.tab();
  expect(group).not.toHaveFocus();
  expect(screen.queryByTestId('slice-readout')).toBeNull();
  expect(screen.queryByTestId('slice-cursor')).toBeNull();
  expect(announcer).toHaveTextContent('');
});

test('H10 without a mouse: every θ of the LCFS at the slider angle is listed with the values the 3D read-out shows there', async () => {
  const user = userEvent.setup();
  renderContent();
  const table = () => screen.getByTestId('lcfs-table');
  const row = (i: number) => table().querySelector<HTMLElement>(`tbody tr[data-theta="${i}"]`)!;
  expect(table().querySelectorAll('tbody tr')).toHaveLength(48);
  expect(row(12).querySelector('th[scope="row"]')).toHaveTextContent('90°');
  expect(cells(row(12))).toEqual([formatNumber(start.T[12]!, 3), formatNumber(ART.surfaces[8]!.B[12]!, 3)]);
  const heads = table().querySelectorAll('thead th');
  expect(heads[1]).toHaveTextContent(/^Temperature \(keV\)/);
  expect(heads[1]!.querySelector('[data-status="model"]')).not.toBeNull();
  expect(heads[2]!.querySelector('[data-status="derived"]')).toHaveTextContent('Derived (VMEC)');
  // Reachable without a mouse: the disclosure's summary and the scrolling table are in the tab order.
  expect(table().closest('details')!.querySelector('summary')).toHaveTextContent('Every θ on the last closed flux surface at φ 0°');
  expect(table().closest('[role="region"]')).toHaveAttribute('tabindex', '0');

  // At D2 (φ 90°) the θ 90° row is the D2 strike line: the same numbers as hovering that point of the 3D surface.
  await user.click(screen.getByRole('button', { name: 'Go to D2' }));
  expect(table().closest('details')!.querySelector('summary')).toHaveTextContent('Every θ on the last closed flux surface at φ 90°');
  const cell = 18 * 48 + 12;
  expect(cells(row(12))).toEqual([formatNumber(start.T[cell]!, 3), formatNumber(ART.surfaces[8]!.B[cell]!, 3)]);
  act(() => lastScene().onHover!({ cell, x: 10, y: 10 }));
  const box = screen.getByTestId('scene-readout');
  expect(box).toHaveTextContent(`Temperature ${cells(row(12))[0]} keV`);
  expect(box).toHaveTextContent(`|B| ${cells(row(12))[1]} T`);
});

test('H8 the cross-section subtitle reads ρ_blend from the artifact, not a copy of it', () => {
  const a = renderContent();
  expect(panel('Cross-section at φ = 0° (D1)')).toHaveTextContent(`Inside ρ = ${trimNumber(P.rhoBlend)} the temperature is the model's core profile.`);
  a.unmount();
  const other = structuredClone(ART);
  other.model.parameters.rhoBlend.value = 0.6;
  render(<HeatFieldContent art={other} autoPlay={false} />);
  expect(panel('Cross-section at φ = 0° (D1)')).toHaveTextContent("Inside ρ = 0.6 the temperature is the model's core profile.");
});

// ---------------------------------------------------------------------------------------------- H11

test('H11 the toroidal-angle slider (5° steps) and Go to D1–D4 choose the slice; the plate is drawn only at a diverter angle', async () => {
  const user = userEvent.setup();
  renderContent();
  const slider = screen.getByRole('slider', { name: /^Toroidal angle φ/ });
  expect(slider).toHaveAttribute('type', 'range');
  expect(slider).toHaveAttribute('step', '5');
  expect(slider).toHaveAttribute('min', '0');
  expect(slider).toHaveAttribute('max', '355');
  expect((slider as HTMLInputElement).value).toBe('0');
  expect(slider).toHaveAttribute('aria-valuetext', '0°, diverter D1');
  expect(screen.getByRole('heading', { name: 'Cross-section at φ = 0° (D1)' })).toBeInTheDocument();
  expect(screen.getByTestId('slice-plate')).toHaveTextContent('D1');
  expect(document.querySelectorAll('.hf-xs__cells path')).toHaveLength((ART.surfaces.length - 1) * 48);
  expect(lastScene().sliceJ).toBe(0);

  // Keyboard operable: the slider is a native range input in the tab order.
  slider.focus();
  expect(slider).toHaveFocus();
  fireEvent.change(slider, { target: { value: '45' } });
  expect(screen.getByRole('heading', { name: 'Cross-section at φ = 45°' })).toBeInTheDocument();
  expect(screen.queryByTestId('slice-plate')).toBeNull();
  expect(lastScene().sliceJ).toBe(9);
  expect(lastChart().layout.shapes?.find((x) => x.name === 'cross-section slice')?.x0).toBe(45);
  expect(screen.getByTestId('slice-summary')).toHaveTextContent('Slice at φ 45°: lowest and highest values');

  await user.click(screen.getByRole('button', { name: 'Go to D3' }));
  expect(screen.getByRole('heading', { name: 'Cross-section at φ = 180° (D3)' })).toBeInTheDocument();
  expect(screen.getByTestId('slice-plate')).toHaveTextContent('D3');
  expect(screen.getByRole('button', { name: 'Go to D3' })).toHaveAttribute('aria-pressed', 'true');
  expect((slider as HTMLInputElement).value).toBe('180');

  // Coloured by temperature: the hottest cells (next to the axis, near T_0) take the red end of the heat ramp: the
  // ramp's colour at their value on the fixed slice bar (data floor … T_0; MODEL.md core profile, independently), in
  // the top half of the ramp's last segment and nearer its red end than the next stop. (Exact, so a retuned ramp
  // does not break it.)
  const fills = [...document.querySelectorAll<SVGPathElement>('.hf-xs__cells path')].map((p) => p.getAttribute('fill'));
  const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const dist = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));
  const heat = themes.light.scene.heat;
  const core = (rho: number) => P.Tped + (P.Tcore0 - P.Tped) * (1 - rho * rho) ** 2;
  const [sLo, sHi] = lastScene().ranges.sliceT;
  expect(sHi).toBe(P.Tcore0);
  const tAxis = ((core(0) + core(ART.surfaces[1]!.rho)) / 2 - sLo) / (sHi - sLo);
  expect(tAxis).toBeGreaterThan(1 - 1 / (heat.length - 1) / 2);
  const expected = rgb(rgbToHex(heatColor(tAxis, 'light')));
  const nearAxis = fills.slice(0, 48);
  for (const f of nearAxis) {
    expect(dist(rgb(f!), expected)).toBeLessThanOrEqual(1);
    expect(dist(rgb(f!), rgb(heat[heat.length - 1]!))).toBeLessThan(dist(rgb(f!), rgb(heat[heat.length - 2]!)));
  }
  // Gray is never data: no cell takes a gray token.
  const grays = [themes.light.scene.unsampled, themes.light.scene.surfaceFill, themes.light.plot.unsampled];
  expect(fills.filter((f) => grays.includes(f!))).toEqual([]);
});

test('H11 the slice temperature bar starts at the data floor, so the cold footprint under a coil-off plate shows in the slice and follows the coils (DZ-4)', async () => {
  const user = userEvent.setup();
  renderContent();
  const ranges = lastScene().ranges;
  // The bar runs from the same rounded start-state LCFS minimum as the 3D surface's bar (not T_t) to T_0 on the axis.
  let tMin = Infinity;
  for (const v of start.T) tMin = Math.min(tMin, v);
  expect(ranges.sliceT[0]).toBe(ranges.lcfsT[0]);
  expect(ranges.sliceT[0]).toBeLessThanOrEqual(tMin);
  expect(ranges.sliceT[0]).toBeGreaterThan(tMin - 0.05);
  expect(ranges.sliceT[0]).toBeGreaterThan(P.Ttarget);
  expect(ranges.sliceT[1]).toBe(P.Tcore0);
  const xsPanel = panel('Cross-section at φ = 0° (D1)');
  const bar = within(xsPanel).getByRole('img', {
    name: /^Colour bar: Temperature in keV from 0\.65 \(coldest end in yellow\) to 3\.00 \(hottest end in red\)/,
  });
  expect(bar).toHaveAccessibleName(/anything colder takes the coldest colour/);
  expect(bar).toHaveTextContent('0.65 · coldest');

  // Outer-ring cells (ρ 0.875–1) at plane j from MODEL.md's cross-section formula, independently, and their ramp position.
  const [lo, hi] = ranges.sliceT;
  const node = (T: Float64Array, j: number, m: number, i: number) => {
    const rho = ART.surfaces[m]!.rho;
    const core = P.Tped + (P.Tcore0 - P.Tped) * (1 - rho * rho) ** 2;
    const w = Math.max(0, (rho - P.rhoBlend) / (1 - P.rhoBlend)) ** 2;
    return core + w * (T[j * 48 + (i % 48)]! - P.Tped);
  };
  const cellT = (T: Float64Array, j: number, i: number) => (node(T, j, 7, i) + node(T, j, 7, i + 1) + node(T, j, 8, i) + node(T, j, 8, i + 1)) / 4;
  const ramp = (v: number) => (v - lo) / (hi - lo);
  const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const fillOf = (i: number) => rgb(document.querySelector(`[data-cell="7:${i}"]`)!.getAttribute('fill')!);
  const expectFill = (i: number, t: number) => {
    const want = rgb(rgbToHex(heatColor(t, 'light')));
    fillOf(i).forEach((v, k) => expect(Math.abs(v - want[k]!), `cell 7:${i}`).toBeLessThanOrEqual(1));
  };

  // At the start (every coil off after the spin-up) the D1 footprint sits under the plate, θ 82.5°–97.5° round the
  // strike line at 90°: low on the ramp, clearly below every outer cell 45° or more away from it.
  const under = [11, 12];
  const away = Array.from({ length: 48 }, (_, i) => i).filter((i) => i <= 5 || i >= 18);
  under.forEach((i) => expect(ramp(cellT(start.T, 0, i)), `cell 7:${i}`).toBeLessThan(0.1));
  away.forEach((i) => expect(ramp(cellT(start.T, 0, i)), `cell 7:${i}`).toBeGreaterThan(0.13));
  // On the old T_t…T_0 bar the footprint sat a quarter of the way up the ramp, beside the rest of the ring.
  expect((cellT(start.T, 0, 12) - P.Ttarget) / (P.Tcore0 - P.Ttarget)).toBeGreaterThan(0.25);
  // The slice draws exactly those positions.
  for (const i of [...under, 0, 30]) expectFill(i, ramp(cellT(start.T, 0, i)));
  const footprintFill = fillOf(12);

  // The edge strip (DZ3-3): the LCFS temperature at this φ on the 3D surface's range (ranges.lcfsT), drawn just
  // outside the LCFS. There the footprint under D1 stands at least 12 ΔE00 (the series gate) off every strip cell
  // 45° or more away from it. In the slice's own outer ring it does not: on the single linear scale from the data
  // floor to T_0 it is less than one ramp step from part of the ring (2.6 ΔE00 inboard, DZ3-3).
  const hexOf = (el: Element | null) => el!.getAttribute('fill')!;
  const strip = () => screen.getByTestId('edge-strip');
  const edgeHex = (i: number) => hexOf(strip().querySelector(`[data-edge="${i}"]`));
  const cellHex = (i: number) => hexOf(document.querySelector(`[data-cell="7:${i}"]`));
  const dE = (a: string, b: string) => deltaE2000(hexToLab(a), hexToLab(b));
  const [eLo, eHi] = ranges.lcfsT;
  const edgeT = (T: Float64Array, j: number, i: number) => (T[j * 48 + i]! + T[j * 48 + ((i + 1) % 48)]!) / 2;
  const expectEdge = (T: Float64Array, j: number, i: number) => {
    const want = rgb(rgbToHex(heatColor((edgeT(T, j, i) - eLo) / (eHi - eLo), 'light')));
    rgb(edgeHex(i)).forEach((v, k) => expect(Math.abs(v - want[k]!), `strip ${i}`).toBeLessThanOrEqual(1));
  };
  for (const i of [...under, 0, 30]) expectEdge(start.T, 0, i);
  for (const i of under) expect(Math.min(...away.map((k) => dE(edgeHex(i), edgeHex(k)))), `strip ${i}`).toBeGreaterThanOrEqual(12);
  expect(Math.min(...away.map((k) => dE(cellHex(12), cellHex(k))))).toBeLessThan(12);
  // Its colour bar says what it shows.
  expect(within(xsPanel).getByRole('img', { name: /^Colour bar: Edge \(LCFS\), same scale as the 3D view in keV from 0\.65 \(coldest end in yellow\) to 1\.00/ })).toBeInTheDocument();
  const footprintEdge = edgeHex(12);

  // Moving the slider off the diverter (φ 45°) the cold patch is gone: the same cell is warmer and drawn warmer, and
  // on the strip the change is at least 12 ΔE00.
  fireEvent.change(screen.getByRole('slider', { name: /^Toroidal angle φ/ }), { target: { value: '45' } });
  expect(ramp(cellT(start.T, 9, 12))).toBeGreaterThan(ramp(cellT(start.T, 0, 12)) + 0.05);
  expectFill(12, ramp(cellT(start.T, 9, 12)));
  expect(fillOf(12)).not.toEqual(footprintFill);
  expectEdge(start.T, 9, 12);
  expect(dE(edgeHex(12), footprintEdge)).toBeGreaterThanOrEqual(12);

  // The D1 field adjustment on for 0.5 s: the strike line is at θ_d + A_s (107°) and the coldest outer cell has
  // moved with it, from θ 82.5°–97.5° to 105°–112.5°, in the drawn colours too.
  await user.click(screen.getByRole('button', { name: 'Go to D1' }));
  await user.click(screen.getByRole('button', { name: 'Field adjustment D1' }));
  for (let k = 0; k < 5; k++) await user.click(screen.getByRole('button', { name: 'Advance 0.1 s' }));
  const swept = model.advance(start, [1, 0, 0, 0], 500).T;
  const ring = Array.from({ length: 48 }, (_, i) => cellT(swept, 0, i));
  const coldest = ring.indexOf(Math.min(...ring));
  expect(coldest).toBe(14);
  expect(ramp(ring[coldest]!)).toBeLessThan(0.1);
  // The cell the footprint left is now clearly warmer than the one it moved to.
  expect(ramp(ring[11]!)).toBeGreaterThan(ramp(ring[14]!) + 0.03);
  for (const i of [11, 12, 14]) expectFill(i, ramp(ring[i]!));
  // On the strip the move is plain to see: the cell it left and the cell it moved to are 12 ΔE00 or more apart, and the
  // cell it moved to has changed by as much since the start.
  for (const i of [11, 12, 14]) expectEdge(swept, 0, i);
  const stripStart14 = rgbToHex(heatColor((edgeT(start.T, 0, 14) - eLo) / (eHi - eLo), 'light'));
  expect(dE(edgeHex(11), edgeHex(14))).toBeGreaterThanOrEqual(12);
  expect(dE(edgeHex(14), stripStart14)).toBeGreaterThanOrEqual(12);

  // Coloured by |B| the slice is |B| everywhere: no temperature strip, no edge bar.
  await user.click(screen.getByRole('radio', { name: '|B| (VMEC)' }));
  expect(screen.queryByTestId('edge-strip')).toBeNull();
  expect(within(panel(/^Cross-section at φ/)).queryByRole('img', { name: /^Colour bar: Edge/ })).toBeNull();
});

test('H11 the cross-section cells and the edge strip are stroked in their own colour, so no hairline seams show between them (DZ3-4)', () => {
  renderContent();
  const paths = [...document.querySelectorAll<SVGPathElement>('.hf-xs__cells path, .hf-xs__edge path[data-edge]')];
  expect(paths.length).toBe((ART.surfaces.length - 1) * 48 + 48);
  for (const p of paths) expect(p.getAttribute('stroke'), p.getAttribute('d')!).toBe(p.getAttribute('fill'));
  // The stylesheet lets that stroke show (no `stroke: none`), thin and round-joined.
  const css = parseCss(readFileSync(resolve(__dirname, 'heatfield.css'), 'utf8'));
  for (const sel of ['.hf-xs__cells path', '.hf-xs__edge path']) {
    const rules = rulesFor(css, sel, null);
    expect(rules.some((r) => r.decl.stroke !== undefined), sel).toBe(false);
    const width = parseFloat(declared(css, sel, 'stroke-width') ?? '0');
    expect(width, sel).toBeGreaterThanOrEqual(0.5);
    expect(width, sel).toBeLessThanOrEqual(0.75);
    expect(declared(css, sel, 'stroke-linejoin'), sel).toBe('round');
  }
  // The strip is a temperature fill, outlined like the LCFS (DESIGN.md §7).
  expect(declared(css, '.hf-xs__edge .hf-xs__edge-outline', 'stroke')).toBe('var(--lab-scene-boundary)');
  expect(parseFloat(declared(css, '.hf-xs__edge .hf-xs__edge-outline', 'stroke-width')!)).toBeGreaterThanOrEqual(1.5);
});

// ---------------------------------------------------------------------------------------------- H12

test('H12 diverter table: peak tile °C, peak heat flux MW/m², status against the limit in words and icon, field-adjustment toggles', async () => {
  const user = userEvent.setup();
  renderContent();
  expect(screen.getByRole('table', { name: /Peak tile temperature, peak heat flux and status against the 1200 °C illustrative tile limit/ })).toBeInTheDocument();
  IDS.forEach((id, k) => {
    const row = divRow(id);
    const [tile, flux, status] = cells(row);
    expect(tile).toBe(formatNumber(coldOff.peakTileC[k]!, 0));
    expect(flux).toBe(formatNumber(coldOff.peakHeatFlux[k]!, 2));
    const over = coldOff.peakTileC[k]! > P.tileLimit;
    expect(status).toBe(over ? 'Above limit' : 'Below limit');
    expect(row.querySelector('.hf-limit svg')).toHaveAttribute('data-icon', over ? 'alert' : 'check');
  });
  // The regime the model was tuned for: D1 and D4 above, D2 and D3 below.
  expect(IDS.map((id) => divRow(id).dataset.over)).toEqual(['true', 'false', 'false', 'true']);
  expect(screen.getByTestId('diverter-verdict')).toHaveTextContent('D1, D4 are above the illustrative 1200 °C tile limit.');

  const t1 = screen.getByRole('button', { name: 'Field adjustment D1' });
  expect(t1).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'All adjustments off' })).toBeDisabled();
  await user.click(t1);
  expect(t1).toHaveAttribute('aria-pressed', 'true');
  expect(lastScene().sim.coils).toEqual([1, 0, 0, 0]);
  // It takes effect at the current model time: the strike line moves by A_s·cos(2πft) and the heat flux changes now.
  const on = model.diagnostics(start, [1, 0, 0, 0]);
  const strike = ((model.thetaD + P.sweepAmplitude * Math.cos(2 * Math.PI * P.sweepFrequency * model.time(start.n))) * 180) / Math.PI;
  expect(divRow('D1')).toHaveTextContent(`θs ${formatNumber(strike, 1)}°`);
  expect(divRow('D2')).toHaveTextContent('θs 90.0°');
  expect(cells(divRow('D1'))[1]).toBe(formatNumber(on.peakHeatFlux[0]!, 2));
  expect(cells(divRow('D1'))[1]).not.toBe(formatNumber(coldOff.peakHeatFlux[0]!, 2));
  await user.click(screen.getByRole('button', { name: 'Advance 0.1 s' }));
  const after = model.diagnostics(model.advance(start, [1, 0, 0, 0], 100), [1, 0, 0, 0]);
  IDS.forEach((id, k) => expect(cells(divRow(id))[0]).toBe(formatNumber(after.peakTileC[k]!, 0)));

  await user.click(screen.getByRole('button', { name: 'Field adjustment D3' }));
  expect(lastScene().sim.coils).toEqual([1, 0, 1, 0]);
  await user.click(screen.getByRole('button', { name: 'All adjustments off' }));
  IDS.forEach((id) => expect(screen.getByRole('button', { name: `Field adjustment ${id}` })).toHaveAttribute('aria-pressed', 'false'));
  expect(lastScene().sim.coils).toEqual(OFF);
});

// ---------------------------------------------------------------------------------------------- H13

test('H13 play, pause, reset and speed: model time runs only while playing, and pausing freezes every display', async () => {
  const user = userEvent.setup();
  const raf = installRaf();
  renderContent(false);
  expect(modelTime()).toHaveTextContent('Model time t = 0.000 s');
  expect(modelTime()).toHaveTextContent('after a 3.0 s spin-up with every coil off · paused');
  expect(raf.pending()).toBe(0);

  await user.click(screen.getByRole('button', { name: 'Play' }));
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  const frames = (from: number, to: number) => {
    for (let now = from; now <= to; now += 20) raf.run(now); // 50 frames per second
  };
  raf.run(1000);
  frames(1020, 1100); // 100 ms at 1×: 0.1 s of model time
  expect(modelTime()).toHaveTextContent('t = 0.100 s');
  expect(lastScene().sim.state.n).toBe(start.n + 100);

  await user.click(screen.getByRole('radio', { name: '2 times model speed' }));
  frames(1120, 1200); // 100 ms at 2×: 0.2 s more
  expect(modelTime()).toHaveTextContent('t = 0.300 s');
  // A long stall never runs away: at most 60 steps in one frame.
  raf.run(9000);
  expect(lastScene().sim.state.n).toBe(start.n + 360);

  await user.click(screen.getByRole('button', { name: 'Pause' }));
  expect(raf.pending()).toBe(0);
  const frozen = {
    time: modelTime().textContent,
    table: cells(divRow('D1')).join('|'),
    chart: JSON.stringify(lastChart().data),
    n: lastScene().sim.state.n,
  };
  raf.run(20_000);
  expect(modelTime().textContent).toBe(frozen.time);
  expect(cells(divRow('D1')).join('|')).toBe(frozen.table);
  expect(JSON.stringify(lastChart().data)).toBe(frozen.chart);
  expect(lastScene().sim.state.n).toBe(frozen.n);
  expect(frozen.time).toContain('t = 0.360 s');

  await user.click(screen.getByRole('button', { name: 'Reset to start' }));
  expect(modelTime()).toHaveTextContent('t = 0.000 s');
  IDS.forEach((id, k) => expect(cells(divRow(id))[0]).toBe(formatNumber(coldOff.peakTileC[k]!, 0)));
});

test('H13 no autoplay under prefers-reduced-motion; otherwise the view plays from the start', () => {
  const raf = installRaf();
  stubMatchMedia(true);
  const a = render(<HeatFieldContent art={ART} />);
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  expect(modelTime()).toHaveTextContent('paused');
  expect(raf.pending()).toBe(0);
  a.unmount();

  stubMatchMedia(false);
  render(<HeatFieldContent art={ART} />);
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  expect(modelTime()).toHaveTextContent('playing');
  expect(raf.pending()).toBe(1);
});

// ---------------------------------------------------------------------------------------------- H14

test('H14 |B| against φ at the strike-line θ, redrawn as the coils sweep; diverter, slice and pointer markers; Freeze snapshot keeps a dashed copy', async () => {
  const user = userEvent.setup();
  renderContent();
  const iD = Math.round(ART.diverters.thetaCentre / ((2 * Math.PI) / 48)); // 12: θ = 90°
  let c = lastChart();
  expect(c.data.map((d) => d.name)).toEqual(['|B| now']);
  expect(c.summary).toContain('at t = 0.00 s');
  const now = c.data[0] as { x: number[]; y: number[]; line: { color: string; dash: string } };
  expect(now.x).toEqual(Array.from({ length: 73 }, (_, j) => j * 5));
  expect(now.y).toEqual(Array.from({ length: 73 }, (_, j) => ART.surfaces[8]!.B[(j % 72) * 48 + iD]));
  expect(now.line.color).toBe(themes.light.scene.field[8]); // dark blue = strongest, the field ramp's end
  const shapes = c.layout.shapes ?? [];
  IDS.forEach((id, k) => expect(shapes.find((s) => s.name === `diverter ${id}`)?.x0).toBeCloseTo(90 * k, 3));
  expect(shapes.find((s) => s.name === 'cross-section slice')?.x0).toBe(0);
  expect(c.layout.xaxis.title?.text).toBe('Toroidal angle φ (°)');
  expect(c.layout.yaxis.title?.text).toBe('|B| at θ = 90° (T)');
  expect(c.ariaLabel).toMatch(/^Line chart: \|B\| in tesla on the last closed flux surface at θ = 90°/);

  await user.click(screen.getByRole('button', { name: 'Freeze snapshot' }));
  c = lastChart();
  expect(c.data.map((d) => d.name)).toEqual(['Snapshot at t = 0.00 s', '|B| now']);
  const snap = c.data[0] as { y: number[]; line: { dash: string } };
  expect(snap.line.dash).toBe('dash');
  expect(snap.y).toEqual(now.y);

  // The D2 coil on, 0.1 s later: the curve moves near φ = 90°, the snapshot does not.
  await user.click(screen.getByRole('button', { name: 'Field adjustment D2' }));
  await user.click(screen.getByRole('button', { name: 'Advance 0.1 s' }));
  c = lastChart();
  expect(c.data.map((d) => d.name)).toEqual(['Snapshot at t = 0.00 s', '|B| now']);
  expect(c.summary).toContain('at t = 0.10 s');
  const moved = c.data[1] as { y: number[] };
  const B = model.field([0, 1, 0, 0], start.n + 100);
  expect(moved.y[18]).toBe(B[18 * 48 + iD]);
  expect(moved.y[18]).not.toBe(snap.y[18]);
  expect((c.data[0] as { y: number[] }).y).toEqual(snap.y);
  expect(screen.getByTestId('chart')).toHaveTextContent('A frozen snapshot from t = 0.00 s is drawn dashed for comparison.');

  await user.click(screen.getByRole('button', { name: 'Clear snapshot' }));
  expect(lastChart().data.map((d) => d.name)).toEqual(['|B| now']);
  expect(screen.getByRole('button', { name: 'Clear snapshot' })).toBeDisabled();
});

test('H14 while playing, the |B| curve is redrawn on every frame of a 60 Hz display, not only at the 10 Hz refresh, so the coil sweep is drawn as a sweep', async () => {
  const user = userEvent.setup();
  const raf = installRaf();
  renderContent(false);
  const frameMs = 1000 / 60;
  expect(CHART_INTERVAL_MS).toBeLessThan(frameMs);
  expect(UI_INTERVAL_MS).toBeGreaterThan(frameMs);
  const iD = 12;
  await user.click(screen.getByRole('button', { name: 'Field adjustment D2' }));
  await user.click(screen.getByRole('radio', { name: '2 times model speed' }));
  await user.click(screen.getByRole('button', { name: 'Play' }));
  raf.run(1000);
  // One coil sweep period (1/f of model time) at the fastest speed, in 60 Hz frames.
  const nFrames = Math.floor(1000 / P.sweepFrequency / 2 / frameMs);
  const drawn: string[] = [];
  const layout = lastChart().layout;
  for (let f = 1; f <= nFrames; f++) {
    raf.run(1000 + f * frameMs);
    const n = lastScene().sim.state.n;
    const c = lastChart();
    const now = c.data[c.data.length - 1] as { name: string; y: number[] };
    // The curve drawn is the model's |B| at this very step, with the D2 perturbation …
    expect(c.summary).toContain(`at t = ${formatNumber((n - start.n) * P.dt, 2)} s`);
    expect(now.y[18]).toBe(model.field([0, 1, 0, 0], n)[18 * 48 + iD]);
    drawn.push(JSON.stringify(now.y));
    // … under the same layout object and legend name: per frame only the traces change, so Plotly keeps the user's
    // zoom and pan (one uirevision) and the legend does not re-lay out (HF3-1).
    expect(c.layout).toBe(layout);
    expect(c.layout.uirevision).toBe('hf-field');
    expect(now.name).toBe('|B| now');
    // … while the rest of the view keeps its 10 Hz refresh (the model-time read-out has not moved yet).
    if (f === 1) {
      expect(n).toBeGreaterThan(start.n);
      expect(modelTime()).toHaveTextContent('t = 0.000 s');
    }
  }
  // A new curve on every frame: at least a dozen drawings per sweep period (the 10 Hz refresh gave 2.5 at 2×).
  expect(nFrames).toBeGreaterThanOrEqual(12);
  expect(new Set(drawn).size).toBe(nFrames);

  // Freeze snapshot keeps exactly the curve on screen at that moment, not the last 10 Hz refresh.
  const shown = (lastChart().data[0] as { y: number[] }).y;
  await user.click(screen.getByRole('button', { name: 'Freeze snapshot' }));
  await user.click(screen.getByRole('button', { name: 'Pause' }));
  const snap = lastChart().data.find((d) => String(d.name).startsWith('Snapshot')) as { y: number[] };
  expect(snap.y).toEqual(shown);
});

// ---------------------------------------------------------------------------------------------- H15

test('H15 one switch predicts and adjusts the field; switching off releases the coils', async () => {
  const user = userEvent.setup();
  renderContent();
  const control = screen.getByRole('switch', { name: 'Control loop' });
  expect(control).not.toBeChecked();
  await user.click(control);
  // Every coil is off when the loop is switched on, so the forecast with the coils as they are is the all-off one.
  // While any diverter is predicted hot, every coil goes on (not just the hot diverters' own).
  const predicted = model.diagnostics(model.advance(start, OFF, Math.round(HORIZON_S / P.dt)), OFF).peakTileC;
  expect(predicted.some(t => t > P.tileLimit)).toBe(true);
  expect(predicted.some(t => t <= P.tileLimit)).toBe(true); // a mixed case: the old rule switched on only some coils
  const expected = IDS.map(() => 'true');
  const coils = () => IDS.map(id => screen.getByRole('button', { name: 'Field adjustment ' + id }).getAttribute('aria-pressed'));
  await waitFor(() => expect(coils()).toEqual(expected));
  await user.click(control);
  expect(control).not.toBeChecked();
  expect(coils()).toEqual(OFF.map(() => 'false'));
});

// ---------------------------------------------------------------------------------------------- H16

test('H16 the equation, the parameter table and the honesty notes are shown; every panel of model numbers carries the Model status', () => {
  renderContent();
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  expect(screen.getByRole('note', { name: /Illustrative model — not a W7-X simulation/ })).toHaveTextContent(norm(ART.model.summary));
  expect(screen.getByRole('note', { name: /Schematic diverter positions/ })).toHaveTextContent(norm(ART.diverters.note));
  expect(screen.getByRole('switch', { name: 'Control loop' })).toBeInTheDocument();

  // The governing equation as written in the artifact (subscripts typeset, the plain text kept as its name), and
  // every other equation behind the disclosure.
  const unsub = (s: string) => norm(s).replace(/_/g, '');
  const governing = screen.getByTestId('governing-equation');
  expect(governing).toHaveTextContent(unsub(ART.model.equations[0]!.text));
  expect(governing.querySelector('.hf-eq__math')).toHaveAttribute('aria-label', `Equation: ${ART.model.equations[0]!.text}`);
  for (const e of ART.model.equations.slice(1)) {
    const dt = [...document.querySelectorAll('dt.hf-eq__math')].find((d) => d.getAttribute('aria-label') === e.text)!;
    expect(dt, e.id).toBeDefined();
    expect(dt.textContent).toBe(e.text.replace(/_/g, ''));
  }
  // Parameter table: symbol, value, unit and meaning of all 23 parameters, from the artifact.
  const params = screen.getByRole('table', { name: /Parameters as written in artifacts\/heatfield.json/ });
  const rows = within(params).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(23);
  for (const [name, p] of Object.entries(ART.model.parameters)) {
    const row = params.querySelector<HTMLElement>(`tr[data-parameter="${name}"]`)!;
    expect(row.querySelector('th')!.textContent).toBe(p.symbol.replace('_', ''));
    expect(cells(row)).toEqual([trimNumber(p.value), p.unit, p.description]);
  }
  expect(params.querySelector('tr[data-parameter="tileGain"] td')).toHaveTextContent('165');
  expect(screen.getByText(norm(ART.model.limitations))).toBeInTheDocument();

  // Model status on every panel that shows model numbers; geometry and |B| say Derived (VMEC).
  for (const name of [
    'W7-X last closed flux surface: model temperature and |B|',
    'Cross-section at φ = 0° (D1)',
    'Diverters D1–D4',
    '|B| against toroidal angle at the strike line',
    'Control loop: heat map → predict → adjust field → new heat map',
    'The equation used to predict heat movement',
  ]) {
    expect(panel(name).querySelector('.lab-panel__header [data-status="model"]'), name).not.toBeNull();
  }
  // The two provenance badges of the 3D panel say which record covers what, visibly (DZ-8), and their accessible
  // names start with those words (label in name).
  const temps = screen.getByRole('button', { name: 'Temperatures — provenance of temperatures, heat fluxes and tile temperatures: Model, Not applicable' });
  const geo = screen.getByRole('button', { name: 'Geometry and |B| — provenance of geometry and |B|: Derived, Not applicable' });
  expect(temps.querySelector('.lab-prov__caption')).toHaveTextContent(/^Temperatures$/);
  expect(geo.querySelector('.lab-prov__caption')).toHaveTextContent(/^Geometry and \|B\|$/);
  const header = panel('W7-X last closed flux surface: model temperature and |B|').querySelector('.lab-panel__header')!;
  expect(header).toContainElement(temps);
  expect(header).toContainElement(geo);
  expect(panel('Cross-section at φ = 0° (D1)').querySelector('[data-status="derived"]')).toHaveTextContent('Derived (VMEC)');
  // Nothing here is replayed or live.
  expect(document.querySelector('[data-status="live"], [data-status="replay"]')).toBeNull();
});

test('H16 the equations and notes typeset every X_abc as a subscript, and the governing equation’s label is not repeated under it (DZ3-5)', () => {
  renderContent();
  const governing = screen.getByTestId('governing-equation');
  const math = governing.querySelector('.hf-eq__math')!;
  // No raw underscore in any equation, meaning or colour-bar note on screen; the subscripts are <sub> elements.
  for (const el of document.querySelectorAll('.hf-eq__math, .hf-eq__meaning, .hf-eq__list dd, .hf-colorbar__note')) {
    expect(el.textContent, el.className).not.toContain('_');
  }
  expect([...math.querySelectorAll('sub')].map((s) => s.textContent)).toEqual(['∥', '⊥', 'ped', 'E', 'k', 'k', 't', 'div']);
  const field = [...document.querySelectorAll('dt.hf-eq__math')].find((d) => d.getAttribute('aria-label')?.startsWith('B = '))!;
  expect([...field.querySelectorAll('sub')].map((s) => s.textContent)).toEqual(['VMEC', 'k', 'k', 'k', 'k', 'k', 'k', 'k', 'cφ', 'd', 'cθ']);
  const strike = [...document.querySelectorAll('dt.hf-eq__math')].find((d) => d.getAttribute('aria-label')?.startsWith('θ_s,k'))!;
  expect(strike.querySelector('sub')).toHaveTextContent(/^s,k$/);
  // The colour-bar notes: T_ped and T_0.
  const notes = [...document.querySelectorAll('.hf-colorbar__note')];
  expect(notes.some((n) => [...n.querySelectorAll('sub')].some((s) => s.textContent === 'ped'))).toBe(true);
  expect(notes.some((n) => [...n.querySelectorAll('sub')].some((s) => s.textContent === '0'))).toBe(true);
  // The label is said once: the meaning under the equation starts with its own words.
  const label = 'Governing equation (used to predict how the heat moves)';
  expect(ART.model.equations[0]!.meaning.startsWith(label)).toBe(true);
  expect(governing.textContent!.split(label)).toHaveLength(2);
  expect(governing.querySelector('.hf-eq__meaning')).toHaveTextContent(/^The LCFS temperature T diffuses along the field line/);
});

test('H16 the stability line says ≤ 1 only when the computed number is at most 1; above 1 it says so and warns (HF3-5)', () => {
  const stable = render(<EquationPanel art={ART} stability={0.7355} />);
  expect(screen.getByTestId('stability')).toHaveTextContent('= 0.7355 ≤ 1, computed here from the artifact.');
  expect(screen.queryByRole('note', { name: /Explicit step unstable/ })).toBeNull();
  stable.unmount();

  render(<EquationPanel art={ART} stability={1.2} />);
  const line = screen.getByTestId('stability');
  expect(line).toHaveTextContent('= 1.2000 > 1, computed here from the artifact: the explicit step is unstable.');
  expect(line).not.toHaveTextContent('≤ 1');
  const warn = screen.getByRole('note', { name: /Explicit step unstable: T may leave \[Tt, Tped\]/ });
  expect(warn).toHaveAttribute('data-tone', 'warn');
  expect(warn).toHaveTextContent('1.2000');
  // Outside the collapsed disclosure, so it is seen without opening it.
  expect(warn.closest('details')).toBeNull();
});

test('H16 an artifact whose explicit step is unstable is flagged at the top of the view (HF3-5)', () => {
  // A doubled step (and no spin-up, so the unstable step has no time to blow the state up before the view draws it).
  const fast = structuredClone(ART);
  fast.model.parameters.dt.value = ART.model.parameters.dt.value * 2;
  fast.model.parameters.spinup.value = 0;
  const k = modelFor(fast).stabilityNumber();
  expect(k).toBeGreaterThan(1);
  render(<HeatFieldContent art={fast} autoPlay={false} />);
  const notes = screen.getAllByRole('note', { name: /Explicit step unstable/ });
  expect(notes.length).toBeGreaterThanOrEqual(1);
  expect(notes[0]).toHaveTextContent(formatNumber(k, 4));
  expect(screen.getByTestId('stability')).toHaveTextContent(`= ${formatNumber(k, 4)} > 1`);
});

test('H9 the scene key draws field lines as the |B| ramp, and the arrow and the slice as drawn in 3D: a text-coloured core on a scene-ground halo (DZ3-1, DZ3-2)', async () => {
  const user = userEvent.setup();
  renderContent();
  const key = screen.getByRole('list', { name: 'Scene key' });
  const line = key.querySelector<HTMLElement>('.hf-swatch--line')!;
  expect(line.style.background).toContain('var(--lab-field-0)');
  expect(line.style.background).toContain('var(--lab-field-8)');
  await user.click(screen.getByRole('checkbox', { name: 'Heat-flow arrows' }));
  for (const kind of ['arrow', 'slice']) {
    const sw = key.querySelector<HTMLElement>(`[data-mark="${kind}"]`)!;
    expect(sw, kind).not.toBeNull();
    expect(sw.querySelector('.hf-mark__halo')).not.toBeNull();
    expect(sw.querySelector('.hf-mark__core')).not.toBeNull();
    // Over the surface's own ramp, where the halo is what keeps the mark readable.
    expect(sw.style.background).toContain('var(--lab-heat-0)');
  }
  expect(key).toHaveTextContent('Cross-section slice at φ 0°, labelled “Slice φ 0°”');
  const css = parseCss(readFileSync(resolve(__dirname, 'heatfield.css'), 'utf8'));
  expect(declared(css, '.hf-mark__core', 'stroke')).toBe('var(--lab-color-text)');
  expect(declared(css, '.hf-mark__halo', 'stroke')).toBe('var(--lab-scene-background)');
  expect(declared(css, '.hf-mark__head', 'fill')).toBe('var(--lab-color-text)');
  expect(screen.getByTestId('scene-summary')).toHaveTextContent('labelled “Slice φ 0°”, marks the cross-section at φ 0°');
});

test('DZ3-9 layout inside a Panel follows the Panel body (@container), not the viewport: only the page grid uses @media', () => {
  const css = parseCss(readFileSync(resolve(__dirname, 'heatfield.css'), 'utf8'));
  const media = css.filter((r) => r.at.some((a) => /^@media\b.*(max|min)-width/.test(a)));
  expect(media.flatMap((r) => r.selectors)).toEqual(['.hf-layout']);
  for (const [sel, prop, value] of [
    ['.hf-scene__canvas', 'height', '340px'],
    ['.hf-keys', 'grid-template-columns', 'minmax(0, 1fr)'],
    ['.hf-loop__steps', 'grid-template-columns', 'repeat(2, minmax(0, 1fr))'],
  ] as const) {
    const narrow = rulesFor(css, sel, /^@container \(max-width: \d+px\)$/);
    expect(narrow.map((r) => r.decl[prop]), sel).toEqual([value]);
  }
});

test('H14 the |B| chart leaves no listener behind: unmounted, a chart tick redraws nothing (HF3-3)', () => {
  const ticks = new FrameTicker();
  const sim = new Simulation(model, start);
  const view = render(
    <FieldChart sim={sim} iStrike={12} yRange={[2, 3]} snapshot={null} sliceDeg={0} hoverDeg={null} diverters={[]} theme="light" ticks={ticks} />,
  );
  expect(ticks.size).toBe(1);
  const n = rec.chart.length;
  sim.advance(10);
  act(() => ticks.emit());
  expect(rec.chart.length).toBe(n + 1);
  view.unmount();
  expect(ticks.size).toBe(0);
  act(() => ticks.emit());
  expect(rec.chart.length).toBe(n + 1);
});

test('H14 on a phone the |B| chart takes the narrow layout: five φ ticks and the legend under the plot (DZ3-6)', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    media: q,
    matches: q === '(max-width: 640px)' || q.includes('reduced-motion'),
    addEventListener() {},
    removeEventListener() {},
  }));
  renderContent();
  expect(lastChart().layout.xaxis.tickvals).toEqual([0, 90, 180, 270, 360]);
  expect(lastChart().layout.legend.yref).toBe('container');
});
