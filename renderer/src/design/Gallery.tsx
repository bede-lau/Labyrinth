// Design-system gallery (open /#gallery). A review surface for the tokens and primitives in both
// themes. All chart and scene data here is SYNTHETIC SPECIMEN data, labelled as such on the page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { simulateHex } from './color';
import { Alert } from './components/Alert';
import { Callout } from './components/Callout';
import { FixtureCheck } from './components/FixtureCheck';
import { Panel } from './components/Panel';
import { ProvenanceBadge } from './components/ProvenanceBadge';
import { SegmentedControl } from './components/SegmentedControl';
import { Stat } from './components/Stat';
import { StatusPill } from './components/StatusPill';
import { formatWindow } from './format';
import {
  axisTitle,
  forecastStyle,
  meanSegment,
  plotConfig,
  plotLayout,
  seriesStyle,
  uncertaintyBand,
  unsampledShapes,
  windowShape,
  FORECAST_LINES,
  SERIES_LABEL,
  type ForecastLine,
} from './plotTheme';
import { PALETTE_GATES, RAMP_SEPARATION_GATES, rampPairSeparation, rampSamples, seriesMinDeltaE, type RampId, type Vision } from './palette';
import { bmagColor, bmagGradientCss, fieldGradientCss, heatGradientCss, sceneTheme } from './sceneTheme';
import { STATUS_META } from './status';
import { setThemePreference, useResolvedTheme, type ThemePreference } from './theme';
import { SERIES_IDS, STATUS_KINDS, themes, typeScale, type ThemeName } from './tokens';
import type { Provenance } from './types';
import './gallery.css';

const specimenProvenance: Provenance = {
  kind: 'archive',
  solverRevision: 'stella 6f60964d',
  units: 'Q in ion gyro-Bohm units (Q_gB); t in a/v_th,i',
  coverage: { description: 'Bean tube, closed windows 200–300 and 300–400', tStart: 0, tEnd: 1900 },
  runtime: 'unknown',
  verification: { outcome: 'passed', details: 'Pinned file sha256 matches.' },
  sources: [
    {
      label: 'Public trace archive (stella benchmark h5)',
      url: 'https://github.com/stellaGK/stella/blob/6f60964da55e9c0207b2ed9912d8903440b6d68b/AUTOMATIC_TESTS/quick_benchmarks/DOI_10_1017_S0022377822000393.h5',
      sha256: '3f9a0c5e1d2b4a6c8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
    },
  ],
};

/** Deterministic pseudo-random noise so screenshots are stable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

/** A saved GX run: its provenance kind is "live", but nothing is running, so the badge must not say so. */
const recordedRunProvenance: Provenance = {
  kind: 'live',
  solverRevision: 'GX (specimen)',
  units: 'Q in ion gyro-Bohm units (Q_gB); t in a/v_th,i',
  coverage: { description: 'Bean tube, one saved run', tStart: 0, tEnd: 340 },
  runtime: 'unknown',
  verification: { outcome: 'not-applicable', details: 'Specimen record for the gallery.' },
  sources: [],
};

/** Specimen reasons in the backend's words (orchestrator.py: TERMINATE_FAILED, KILL_SWITCH_ONLY). */
const SPECIMEN_TERMINATE_FAILED =
  'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) kill switch raised, stop not confirmed: ' +
  'the spawn failed client-side (TimeoutError: rpc) after it may have reached Modal, there is no call to cancel and a worker ' +
  'that started stops only when it reads the switch. Both workers launched; streaming GX output (rehearsal).';
const SPECIMEN_CONNECTION_LOST =
  'The live API stopped answering (/api/live/status: no answer within 1500 ms). The last status, received at 14:02:11, ' +
  'reported mode "live": Both workers launched; streaming GX output (rehearsal). GPUs may still be billing.';

const LONG_NOTE =
  'Computed with the stated method and the time-weighted, edge-interpolated window mean (D-013), forecasts held at the ' +
  'right edge with no look-ahead; not tuned to the PRD value. A sample-and-hold window mean reproduces the PRD score ' +
  'but breaks the 2.55 archive fixture, so it is not used here (D-016). This specimen note is long on purpose: it shows ' +
  'the two-line clamp and the "Show full note" control.';

function specimenTrace(seed: number, level: number, tMax: number, step = 2) {
  const r = rng(seed);
  const t: number[] = [];
  const q: number[] = [];
  let ar = 0;
  for (let x = 0; x <= tMax; x += step) {
    ar = 0.92 * ar + 0.35 * r();
    const growth = 1 - Math.exp(-x / 60);
    t.push(x);
    q.push(Math.max(0, level * growth + ar * growth));
  }
  return { t, q };
}

function SpecimenChart({ theme }: { theme: ThemeName }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // @ts-ignore — plotly.js-dist-min ships no type declarations.
    import('plotly.js-dist-min')
      .then((mod: { default?: unknown }) => {
        if (cancelled || !ref.current) return;
        const Plotly = (mod.default ?? mod) as {
          react: (el: HTMLElement, data: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
        };
        const stella = specimenTrace(7, 2.55, 400);
        const gene = specimenTrace(19, 2.67, 400);
        // GX is the new run: sparser samples, drawn with its markers, as the transport view does.
        const gx = specimenTrace(31, 2.6, 340, 10);
        const line = (id: 'stella' | 'GENE' | 'GX', d: { t: number[]; q: number[] }) => {
          const s = seriesStyle(id, theme);
          const withMarkers = id === 'GX';
          return {
            type: 'scatter',
            mode: withMarkers ? 'lines+markers' : 'lines',
            x: d.t,
            y: d.q,
            name: s.name,
            line: s.line,
            ...(withMarkers ? { marker: { ...s.marker, size: 5 } } : {}),
            hovertemplate: '%{y:.2f}',
          };
        };
        const data = [
          uncertaintyBand([300, 400], [2.55, 2.55], 0.06, 'stella', theme),
          line('stella', stella),
          line('GENE', gene),
          line('GX', gx),
        ];
        const layout = plotLayout(theme, {
          height: 300,
          xaxis: { title: { text: axisTitle('Time t', 'a/v_{th,i}') }, range: [0, 420] },
          yaxis: { title: { text: axisTitle('Ion heat flux Q_i', 'Q_gB') }, range: [0, 3.6] },
          shapes: [
            // Unsampled first: the window edges that cross it are then drawn on top of the gray. Its
            // label is a second shape, drawn above the grid so no grid line cuts the word.
            ...unsampledShapes([340, 420], theme),
            windowShape([200, 300], theme, '200–300'),
            windowShape([300, 400], theme, '300–400'),
            meanSegment([300, 400], 2.55, 'stella', theme),
          ],
        });
        return Plotly.react(ref.current, data, layout, plotConfig());
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [theme]);
  // Named on the figure, not with role="img" on the element Plotly draws into: the children of an img
  // are presentational, and Plotly puts its focusable modebar buttons in there.
  return (
    <figure className="gal-figure" aria-label="Specimen chart: synthetic heat-flux traces for stella, GENE and GX with analysis windows">
      <div ref={ref} className="gal-chart" />
      {error && <Callout tone="warn" title="Chart failed to load">{error}</Callout>}
    </figure>
  );
}

/**
 * Synthetic specimen for the forecast chart's pair (DESIGN.md §6, D-026), shaped like the forecast view's data:
 * eight 50-unit windows from t = 1500, Actual a noisy window mean, Predicted the persistence forecast (the
 * previous window's Actual; the first from the window before 1500). Numbers are made up for styling review.
 */
export const FORECAST_SPECIMEN = (() => {
  const r = rng(43);
  const width = 50;
  let level = 2.22;
  let previous = 2.23;
  const windows: { window: [number, number]; predicted: number; actual: number }[] = [];
  for (let k = 0; k < 8; k++) {
    level = 2.22 + 0.55 * (level - 2.22) + 0.2 * r();
    const actual = Math.round(level * 1000) / 1000;
    const a = 1500 + k * width;
    windows.push({ window: [a, a + width], predicted: previous, actual });
    previous = actual;
  }
  const sq = windows.map((w) => (w.predicted - w.actual) ** 2);
  const mse = sq.reduce((s, e) => s + e, 0) / sq.length;
  return { windows, span: [1500, 1500 + 8 * width] as [number, number], mse, rmse: Math.sqrt(mse) };
})();

/**
 * One forecast line as the forecast view draws it: each window's value held flat across the window (a step,
 * risers where windows meet), with the line's marker at the window's midpoint only.
 */
function forecastSpecimenTrace(line: ForecastLine, theme: ThemeName) {
  const s = forecastStyle(line, theme);
  const x: number[] = [];
  const y: number[] = [];
  const mid: boolean[] = [];
  const window: string[] = [];
  for (const w of FORECAST_SPECIMEN.windows) {
    const [a, b] = w.window;
    for (const [t, isMid] of [
      [a, false],
      [(a + b) / 2, true],
      [b, false],
    ] as const) {
      x.push(t);
      y.push(w[line]);
      mid.push(isMid);
      window.push(formatWindow(w.window));
    }
  }
  return {
    type: 'scatter',
    mode: 'lines+markers',
    name: s.name,
    x,
    y,
    line: s.line,
    // Per-point sizes: Plotly would default a sized marker to a bubble chart's 0.7 opacity, so it is explicit.
    marker: {
      ...s.marker,
      opacity: 1,
      size: mid.map((m) => (m ? s.marker.size : 0)),
      line: { ...s.marker.line, width: mid.map((m) => (m ? s.marker.line.width : 0)) },
    },
    customdata: window,
    hovertemplate: `${s.name}, t %{customdata}: %{y:.3f}<extra></extra>`,
    showlegend: true,
  };
}

function SpecimenForecastChart({ theme }: { theme: ThemeName }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // @ts-ignore — plotly.js-dist-min ships no type declarations.
    import('plotly.js-dist-min')
      .then((mod: { default?: unknown }) => {
        if (cancelled || !ref.current) return;
        const Plotly = (mod.default ?? mod) as {
          react: (el: HTMLElement, data: unknown[], layout: unknown, config: unknown) => Promise<unknown>;
        };
        const data = FORECAST_LINES.map((line) => forecastSpecimenTrace(line, theme));
        const layout = plotLayout(theme, {
          height: 260,
          showlegend: true,
          xaxis: { title: { text: axisTitle('Time t', 'a/v_{th,i}') }, range: FORECAST_SPECIMEN.span },
          yaxis: { title: { text: axisTitle('Ion heat flux Q_i', 'Q_{gB,i}') }, tickformat: '.2f' },
        });
        return Plotly.react(ref.current, data, layout, plotConfig());
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [theme]);
  return (
    <figure
      className="gal-figure"
      aria-label="Specimen forecast chart: synthetic Predicted (dashed, downward triangles) and Actual (solid, circles) ion heat flux, each held over its 50-unit window"
    >
      <div ref={ref} className="gal-chart gal-chart--forecast" />
      {error && <Callout tone="warn" title="Chart failed to load">{error}</Callout>}
    </figure>
  );
}

/** The specimen surface and the camera that frames it on a 2:1 canvas. */
export const SPECIMEN = { majorRadius: 5.4, minorRadius: 0.75, fovDeg: 32, camera: [0, -13.5, 15.5] } as const;

/**
 * Canvas height and camera pull-back for the specimen scene at a given width.
 * Half as tall as wide, between 180 and 300px, so a narrow panel is not mostly empty canvas. The
 * framing is tuned for 2:1; on a narrower canvas the camera backs away in proportion, so the whole
 * surface stays inside the horizontal field of view (at 390px it used to be cropped on both sides).
 */
export function specimenFrame(width: number): { height: number; aspect: number; fit: number } {
  const height = Math.round(Math.min(300, Math.max(180, width * 0.5)));
  const aspect = width / height;
  return { height, aspect, fit: Math.max(1, 2 / aspect) };
}

function SpecimenScene({ theme }: { theme: ThemeName }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    import('three')
      .then((THREE) => {
        const el = ref.current;
        if (disposed || !el) return;
        const st = sceneTheme(theme);
        const w = el.clientWidth || 600;
        const { height: h, aspect, fit } = specimenFrame(w);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(1);
        renderer.setSize(w, h);
        renderer.setClearColor(new THREE.Color(st.background));
        el.replaceChildren(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(SPECIMEN.fovDeg, aspect, 0.1, 100);
        camera.position.set(SPECIMEN.camera[0] * fit, SPECIMEN.camera[1] * fit, SPECIMEN.camera[2] * fit);
        camera.lookAt(0, 0, 0);
        // Gray wireframe torus = context surface (synthetic stand-in for the flux surface).
        const R = SPECIMEN.majorRadius;
        const torus = new THREE.TorusGeometry(R, SPECIMEN.minorRadius, 14, 96);
        const wire = new THREE.LineSegments(
          new THREE.WireframeGeometry(torus),
          new THREE.LineBasicMaterial({ color: new THREE.Color(st.surface.line), transparent: true, opacity: 0.8 }),
        );
        scene.add(wire);
        // Field line on the surface, coloured by a synthetic |B| through the |B| colormap.
        const pts: InstanceType<typeof THREE.Vector3>[] = [];
        const bm: number[] = [];
        const N = 400;
        for (let i = 0; i <= N; i++) {
          const phi = (i / N) * Math.PI * 2;
          const theta = phi * 5 * 0.87;
          const rr = R + 0.78 * Math.cos(theta);
          pts.push(new THREE.Vector3(rr * Math.cos(phi), rr * Math.sin(phi), 0.78 * Math.sin(theta)));
          bm.push(0.5 + 0.5 * Math.cos(5 * phi) * Math.cos(theta));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const radial = 6;
        const tube = new THREE.TubeGeometry(curve, N, 0.06, radial, false);
        const colors: number[] = [];
        const count = tube.attributes.position?.count ?? 0;
        const c = new THREE.Color();
        for (let v = 0; v < count; v++) {
          const seg = Math.min(N, Math.floor(v / (radial + 1)));
          const [r, g, b] = bmagColor(bm[seg] ?? 0, theme);
          c.setRGB(r, g, b, THREE.SRGBColorSpace);
          colors.push(c.r, c.g, c.b);
        }
        tube.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        scene.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ vertexColors: true })));
        renderer.render(scene, camera);
        cleanup = () => {
          renderer.dispose();
          torus.dispose();
          tube.dispose();
        };
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      disposed = true;
      cleanup();
    };
  }, [theme]);
  return (
    <figure className="gal-figure">
      <div ref={ref} className="gal-scene" role="img" aria-label="Specimen scene: gray wireframe surface and a field line coloured by |B|" />
      {error && <Callout tone="warn" title="WebGL unavailable">{error}</Callout>}
    </figure>
  );
}

function Swatch({ name, value, onBg }: { name: string; value: string; onBg?: string }) {
  return (
    <div className="gal-swatch">
      <span className="gal-swatch__chip" style={{ background: value, borderColor: onBg }} />
      <span className="gal-swatch__name">{name}</span>
      <span className="gal-swatch__hex lab-mono">{value}</span>
    </div>
  );
}

/** The three colormaps as each viewer sees them (D6): rows of simulated bars, not a table. */
const RAMP_ROWS: { id: RampId; label: string }[] = [
  { id: 'heat', label: 'Temperature' },
  { id: 'field', label: '|B| (Heat & field)' },
  { id: 'bmag', label: '|B| (Locate the tubes)' },
];
const RAMP_VISIONS: { vision: 'normal' | 'deuteranopia' | 'protanopia'; label: string }[] = [
  { vision: 'normal', label: 'Normal vision' },
  { vision: 'deuteranopia', label: 'Deuteranopia' },
  { vision: 'protanopia', label: 'Protanopia' },
];

/** A colormap drawn as one bar, as seen under `vision` (the colours are token values, or simulations of them). */
function rampBackground(id: RampId, theme: ThemeName, vision: (typeof RAMP_VISIONS)[number]['vision']): string {
  const colours = rampSamples(id, theme, 17).map((c) => (vision === 'normal' ? c : simulateHex(c, vision)));
  return `linear-gradient(to right, ${colours.join(', ')})`;
}

function HeatFieldSpecimen({ theme }: { theme: ThemeName }) {
  const st = sceneTheme(theme);
  const separation = useMemo(
    () => ({
      heat: rampPairSeparation('field/heat', theme),
      bmag: rampPairSeparation('field/bmag', theme),
      heatBmag: rampPairSeparation('heat/bmag', theme),
    }),
    [theme],
  );
  // The plate on the grounds where it is hardest to see: the scene, and the darkest stop of each ramp.
  const grounds = [
    { name: 'scene', colour: st.background },
    { name: 'hottest', colour: st.heat[st.heat.length - 1] as string },
    { name: 'strongest |B|', colour: st.field[st.field.length - 1] as string },
    { name: 'coldest', colour: st.heat[0] as string },
  ];
  return (
    <>
      <div className="gal-colorbar" data-ramp="heat">
        <span className="gal-colorbar__label gal-colorbar__label--pill">
          Temperature (keV) <StatusPill status="model" />
        </span>
        <span className="gal-colorbar__bar" style={{ background: heatGradientCss(theme) }} />
        <span className="gal-colorbar__ticks">
          <span>coldest</span>
          <span>hottest</span>
        </span>
      </div>
      <div className="gal-colorbar" data-ramp="field">
        <span className="gal-colorbar__label">|B| (T)</span>
        <span className="gal-colorbar__bar" style={{ background: fieldGradientCss(theme) }} />
        <span className="gal-colorbar__ticks">
          <span>weakest</span>
          <span>strongest</span>
        </span>
      </div>
      <div className="gal-ramps" role="group" aria-label="The three colormaps under simulated colour-vision deficiency">
        {RAMP_VISIONS.map((v) => (
          <div key={v.vision} className="gal-ramps__vision">
            <p className="gal-ramps__title">{v.label}</p>
            {RAMP_ROWS.map((r) => (
              <div key={r.id} className="gal-ramps__row" data-ramp={r.id} data-vision={v.vision}>
                <span className="gal-ramps__name">{r.label}</span>
                <span className="gal-ramps__bar" style={{ background: rampBackground(r.id, theme, v.vision) }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="gal-ramps__measure lab-num">
        Closest approach, worst of normal vision and simulated protanopia / deuteranopia: field vs temperature{' '}
        <strong data-measure="field/heat">{separation.heat.toFixed(1)}</strong> ΔE00 (gate ≥ {RAMP_SEPARATION_GATES['field/heat']}); field
        vs Locate the tubes’ |B| <strong data-measure="field/bmag">{separation.bmag.toFixed(1)}</strong> ΔE00 (gate ≥{' '}
        {RAMP_SEPARATION_GATES['field/bmag']}). Normal vision: temperature vs Locate the tubes’ |B|{' '}
        <strong data-measure="heat/bmag">{separation.heatBmag.toFixed(1)}</strong> ΔE00 (gate ≥ {RAMP_SEPARATION_GATES['heat/bmag']}; they
        never share a view).
      </p>
      <ul className="gal-diverters" aria-label="Diverter plate on its hardest grounds">
        {grounds.map((g) => (
          <li key={g.name} className="gal-diverters__ground" style={{ background: g.colour }}>
            <span className="gal-diverters__plate" style={{ background: st.diverter.fill, borderColor: st.diverter.edge }} />
            <span className="lab-visually-hidden">Diverter plate on {g.name}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Columns of the palette table. Soft hyphens let the long names break in a 390px panel instead of being cut. */
const CVD: { vision: Exclude<Vision, 'tritanopia'>; label: string; gate: number }[] = [
  { vision: 'normal', label: 'Normal', gate: PALETTE_GATES.normal },
  { vision: 'deuteranopia', label: 'Deuter­anopia', gate: PALETTE_GATES.cvd },
  { vision: 'protanopia', label: 'Protan­opia', gate: PALETTE_GATES.cvd },
];

export default function Gallery() {
  const theme = useResolvedTheme();
  const [pref, setPref] = useState<ThemePreference>(() => {
    const a = document.documentElement.getAttribute('data-theme');
    return a === 'light' || a === 'dark' ? a : 'system';
  });
  const [tube, setTube] = useState<'bean' | 'triangular'>('bean');
  const [win, setWin] = useState<'200-300' | '300-400'>('300-400');
  const t = themes[theme];
  const cvdMin = useMemo(() => CVD.map((c) => seriesMinDeltaE(theme, c.vision)), [theme]);

  return (
    <div className="gal">
      <header className="gal-header">
        <div>
          <p className="gal-eyebrow">Labyrinth · design system</p>
          <h1 className="gal-title">Is this W7-X heat-flux estimate accurate enough to justify a longer simulation?</h1>
          <p className="gal-sub">
            Tokens and primitives, {theme} theme. Charts and the 3D scene use <strong>synthetic specimen data</strong> for
            styling review only.
          </p>
        </div>
        {/* No mode indicator here: the gallery runs without the app shell and never asks
            /api/live/status, so it cannot know that $0 is true (DESIGN.md §5). */}
        <div className="gal-header__controls">
          <SegmentedControl
            label="Theme"
            size="sm"
            value={pref}
            onChange={(v) => {
              setPref(v);
              setThemePreference(v);
            }}
            options={[
              // Same words as the app's theme switch (shell/ThemeSwitch.tsx).
              { value: 'system', label: 'Auto', ariaLabel: 'Follow system theme' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </header>

      <main className="gal-grid">
        <Panel
          eyebrow="Check transport"
          title="Bean ion heat flux"
          subtitle="stella and GENE archives with the GX run overlaid; time-weighted means on closed windows"
          status={<ProvenanceBadge provenance={specimenProvenance} subject="specimen trace" />}
          actions={
            <SegmentedControl
              label="Window"
              size="sm"
              value={win}
              onChange={setWin}
              options={[
                { value: '200-300', label: '200–300' },
                { value: '300-400', label: '300–400' },
              ]}
            />
          }
          footer="Specimen data. Shaded bands = analysis windows; gray = unsampled; band = ±1σ sampling uncertainty."
        >
          <div className="gal-stats">
            <Stat label="stella mean" value={2.552} decimals={2} uncertainty={0.06} unit="Q_gB" window={[300, 400]} />
            <Stat label="GENE mean" value={2.674} decimals={2} uncertainty={0.07} unit="Q_gB" window={[300, 400]} />
            <Stat
              label="GX mean"
              value={null}
              decimals={2}
              unit="Q_gB"
              window={[300, 400]}
              note="Window not covered by the run"
            />
            <Stat label="Reduced Modal stella" value={5.79} decimals={2} unit="Q_gB" window={[300, 400]} status={<StatusPill status="prd-reported" />} />
          </div>
          <SpecimenChart theme={theme} />
        </Panel>

        <Panel eyebrow="Accuracy fixtures" title="Claimed vs computed" subtitle="At the PRD's printed precision">
          <FixtureCheck
            unit="Q_gB"
            fixture={{ id: 'g', label: 'GENE mean, 300–400', claimed: 2.68, computed: 2.674, printedDecimals: 2, matches: false, note: 'D-009' }}
          />
          <FixtureCheck
            unit="Q_gB"
            fixture={{ id: 's', label: 'stella mean, 300–400', claimed: 2.55, computed: 2.552, printedDecimals: 2, matches: true }}
          />
          <FixtureCheck
            fixture={{ id: 'b', label: 'Bean |B| vs 129 stella samples', claimed: 129, computed: null, printedDecimals: 0, matches: null, note: 'Samples not in repo (D-007)' }}
          />
          <FixtureCheck
            unit="CPU-h"
            fixture={{ id: 'a', label: 'Published stella bean: 161 h × 288 processors', claimed: 46368, computed: 46368, printedDecimals: 0, matches: true, basis: 'arithmetic', note: 'Arithmetic recomputed; inputs are PRD-reported.' }}
          />
          <FixtureCheck
            unit="Q_gB"
            fixture={{ id: 'm', label: 'stella MAE, persistence forecast', claimed: 0.0444, computed: 0.04396792, printedDecimals: 4, matches: false, note: LONG_NOTE }}
          />
          {/* D-023: the PRD prints a range. `claimed` is null; no midpoint is shown or spoken. */}
          <FixtureCheck
            unit="days"
            fixture={{ id: 'r1', label: 'Full-grid stella wall time', claimed: null, claimedRange: [14, 15], computed: 14.44792, printedDecimals: 0, matches: true }}
          />
          <FixtureCheck
            unit="USD"
            fixture={{ id: 'r2', label: 'Full-grid stella cost', claimed: null, claimedRange: [3100, 3200], computed: 3172.763, printedDecimals: 0, matches: true, basis: 'arithmetic', note: 'Arithmetic on PRD-reported rates.' }}
          />
          <FixtureCheck
            unit="USD"
            fixture={{ id: 'r3', label: 'Halved-timestep cost (specimen)', claimed: null, claimedRange: [6200, 6400], computed: 6512.3, printedDecimals: 0, matches: false }}
          />
          <div className="gal-stack">
            <Callout tone="blocked" title="129 saved stella samples are not in the repository" action={<a href="#d-007">What would unblock this</a>}>
              Validated against the saved ρ = 0.7 geometry instead (25 samples).
            </Callout>
            <Callout tone="warn" title="Triangular raw trace is unverified">
              Only the published mean (2.22 on 1200–1500) is shown.
            </Callout>
            <Callout tone="info" title="Units">
              Raw GX → archive: t × √2, Q ÷ 2√2, only with identical dimensional references.
            </Callout>
          </div>
        </Panel>

        <Panel
          eyebrow="Forecast"
          title="Predicted vs actual heat flux"
          subtitle="Each window's forecast and its archived window mean, held over the window. Actual keeps stella's colour, solid line and circle; Predicted has its own token, a dashed line and a downward triangle."
          footer={'Specimen data. Lines from forecastStyle(line, theme); legend names from FORECAST_LABEL. Error e = Predicted − Actual per window; the statistics beside the chart are Stats.'}
        >
          <div className="gal-stats">
            <Stat label="MSE" value={FORECAST_SPECIMEN.mse} decimals={4} unit="Q_{gB,i}²" window={FORECAST_SPECIMEN.span} note="8 windows (specimen)" />
            <Stat label="RMSE" value={FORECAST_SPECIMEN.rmse} decimals={3} unit="Q_{gB,i}" window={FORECAST_SPECIMEN.span} note="√MSE" />
          </div>
          <SpecimenForecastChart theme={theme} />
        </Panel>

        <Panel eyebrow="Locate the tubes" title="Field line coloured by |B|" subtitle="Gray = sampled surface context; colour = data">
          <div className="gal-row">
            <SegmentedControl
              label="Field line"
              value={tube}
              onChange={setTube}
              options={[
                { value: 'bean', label: 'Bean' },
                { value: 'triangular', label: 'Triangular' },
              ]}
            />
          </div>
          <SpecimenScene theme={theme} />
          <div className="gal-colorbar">
            <span className="gal-colorbar__label">|B| / B<sub>ref</sub></span>
            <span className="gal-colorbar__bar" style={{ background: bmagGradientCss(theme) }} />
            <span className="gal-colorbar__ticks lab-num">
              <span>low</span>
              <span>high</span>
            </span>
          </div>
        </Panel>

        <Panel
          eyebrow="Heat & field"
          title="Temperature and |B| colormaps, diverter plates"
          subtitle="The owner’s rules: red hottest → yellow coldest; dark blue strongest → green weakest. Specimen colour bars with no data; every model number carries the Model pill."
          footer="Diverter plates: near-black fill with an edge, shown on the scene and on the darkest and lightest ramp colours."
        >
          <HeatFieldSpecimen theme={theme} />
        </Panel>

        <Panel
          eyebrow="Status semantics"
          title="Colour + icon + text"
          subtitle="Never colour alone. LIVE is the only solid pill. This panel's badge has provenance of kind “live” from a saved run: without the live flag it reads “Recorded run”."
          status={<ProvenanceBadge provenance={recordedRunProvenance} subject="saved GX specimen run" />}
        >
          <ul className="gal-status">
            {STATUS_KINDS.map((k) => (
              <li key={k}>
                <StatusPill status={k} />
                <span className="gal-status__desc">{STATUS_META[k].description}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Live session"
          title="GPUs may still be billing"
          subtitle="The billing-risk pill leads the header while a stop is unconfirmed or the session state is unknown; the Alert carries the backend's reason word for word and the control that acts on it. The second Alert is the header's compact copy."
        >
          <div className="gal-pills">
            <StatusPill status="billing-risk" size="md">
              TERMINATE FAILED
            </StatusPill>
            <StatusPill status="billing-risk" size="md">
              TERMINATION PENDING
            </StatusPill>
            <StatusPill status="billing-risk" size="md">
              Stop not confirmed
            </StatusPill>
            <StatusPill status="billing-risk" size="md">
              Connection lost
            </StatusPill>
          </div>
          <div className="gal-stack">
            <Alert
              title="TERMINATE FAILED — GPUs may still be billing"
              reason={SPECIMEN_TERMINATE_FAILED}
              action={
                <button type="button" className="gal-btn">
                  Retry terminate
                </button>
              }
            >
              Check the Modal dashboard until both workers are confirmed stopped.
            </Alert>
            {/* The header's copy: compact, with a link to the panel that has the Terminate control. */}
            <Alert
              compact
              title="CONNECTION LOST — session state unknown"
              reason={SPECIMEN_CONNECTION_LOST}
              action={<a href="#/advance">Open Advance plasma to send Terminate</a>}
            >
              Check the Modal dashboard until both workers are confirmed stopped.
            </Alert>
          </div>
        </Panel>

        <Panel
          eyebrow="Series palette"
          title="stella · GENE · GX · bean · triangular"
          subtitle="Each series as seen with normal vision and under simulated deuteranopia and protanopia; smallest pairwise ΔE00 against its gate"
        >
          <table className="gal-cvd">
            <thead>
              <tr>
                <th scope="col">Series</th>
                {CVD.map((c) => (
                  <th key={c.vision} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SERIES_IDS.map((id) => (
                <tr key={id}>
                  <th scope="row">{SERIES_LABEL[id]}</th>
                  {CVD.map((c) => (
                    <td key={c.vision}>
                      <span
                        className="gal-cvd__chip"
                        style={{ background: c.vision === 'normal' ? t.series[id] : simulateHex(t.series[id], c.vision) }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Min ΔE00</th>
                {CVD.map((c, i) => (
                  <td key={c.vision} className="lab-num">
                    {(cvdMin[i] ?? 0).toFixed(1)}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Gate</th>
                {CVD.map((c) => (
                  <td key={c.vision} className="lab-num">
                    ≥ {c.gate}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </Panel>

        <Panel eyebrow="Tokens" title="Surfaces, text, accent">
          <div className="gal-swatches">
            {(['bg', 'surface', 'surfaceSunken', 'surfaceRaised', 'border', 'borderStrong', 'text', 'textMuted', 'textSubtle', 'accent', 'accentText', 'accentSubtle'] as const).map((k) => (
              <Swatch key={k} name={k} value={t.color[k]} onBg={t.color.border} />
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Type" title="Scale (px / line-height)">
          <ul className="gal-type">
            {Object.entries(typeScale)
              .reverse()
              .map(([k, [s, lh]]) => (
                <li key={k} style={{ fontSize: s, lineHeight: `${lh}px` }}>
                  <span className="gal-type__k lab-mono">
                    {k} {s}/{lh}
                  </span>{' '}
                  <span className="lab-num">Q = 2.242 ± 0.031</span>
                </li>
              ))}
          </ul>
        </Panel>
      </main>
    </div>
  );
}
