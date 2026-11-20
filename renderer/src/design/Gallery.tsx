// Design-system gallery (open /#gallery). A review surface for the tokens and primitives in both
// themes. All chart and scene data here is SYNTHETIC SPECIMEN data, labelled as such on the page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { deltaE2000, hexToLab, simulateHex, simulateLab, type Deficiency } from './color';
import { Callout } from './components/Callout';
import { FixtureCheck } from './components/FixtureCheck';
import { Panel } from './components/Panel';
import { ProvenanceBadge } from './components/ProvenanceBadge';
import { SegmentedControl } from './components/SegmentedControl';
import { Stat } from './components/Stat';
import { StatusPill } from './components/StatusPill';
import {
  axisTitle,
  meanSegment,
  plotConfig,
  plotLayout,
  seriesStyle,
  uncertaintyBand,
  unsampledShape,
  windowShape,
  SERIES_LABEL,
} from './plotTheme';
import { bmagColor, bmagGradientCss, sceneTheme } from './sceneTheme';
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

function specimenTrace(seed: number, level: number, tMax: number) {
  const r = rng(seed);
  const t: number[] = [];
  const q: number[] = [];
  let ar = 0;
  for (let x = 0; x <= tMax; x += 2) {
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
        const gx = specimenTrace(31, 2.6, 340);
        const line = (id: 'stella' | 'GENE' | 'GX', d: { t: number[]; q: number[] }) => {
          const s = seriesStyle(id, theme);
          return { type: 'scatter', mode: 'lines', x: d.t, y: d.q, name: s.name, line: s.line, hovertemplate: '%{y:.2f}' };
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
            windowShape([200, 300], theme, '200–300'),
            windowShape([300, 400], theme, '300–400'),
            unsampledShape([340, 420], theme),
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
  return (
    <figure className="gal-figure">
      <div ref={ref} className="gal-chart" role="img" aria-label="Specimen chart: synthetic heat-flux traces for stella, GENE and GX with analysis windows" />
      {error && <Callout tone="warn" title="Chart failed to load">{error}</Callout>}
    </figure>
  );
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
        const h = 300;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(1);
        renderer.setSize(w, h);
        renderer.setClearColor(new THREE.Color(st.background));
        el.replaceChildren(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100);
        camera.position.set(0, -13.5, 15.5);
        camera.lookAt(0, 0, 0);
        // Gray wireframe torus = context surface (synthetic stand-in for the flux surface).
        const R = 5.4;
        const torus = new THREE.TorusGeometry(R, 0.75, 14, 96);
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

const CVD: (Deficiency | 'normal')[] = ['normal', 'deuteranopia', 'protanopia'];

function minDeltaE(theme: ThemeName, d: Deficiency | 'normal') {
  const s = themes[theme].series;
  const labs = SERIES_IDS.map((id) => (d === 'normal' ? hexToLab(s[id]) : simulateLab(s[id], d)));
  let min = Infinity;
  for (let i = 0; i < labs.length; i++)
    for (let j = i + 1; j < labs.length; j++) min = Math.min(min, deltaE2000(labs[i]!, labs[j]!));
  return min;
}

export default function Gallery() {
  const theme = useResolvedTheme();
  const [pref, setPref] = useState<ThemePreference>(() => {
    const a = document.documentElement.getAttribute('data-theme');
    return a === 'light' || a === 'dark' ? a : 'system';
  });
  const [tube, setTube] = useState<'bean' | 'triangular'>('bean');
  const [win, setWin] = useState<'200-300' | '300-400'>('300-400');
  const t = themes[theme];
  const cvdRows = useMemo(() => CVD.map((d) => ({ d, min: minDeltaE(theme, d) })), [theme]);

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
        <div className="gal-header__controls">
          <StatusPill status="replay" size="md">
            Replay · $0
          </StatusPill>
          <SegmentedControl
            label="Theme"
            size="sm"
            value={pref}
            onChange={(v) => {
              setPref(v);
              setThemePreference(v);
            }}
            options={[
              { value: 'system', label: 'System' },
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

        <Panel eyebrow="Status semantics" title="Colour + icon + text" subtitle="Never colour alone. LIVE is the only solid pill.">
          <ul className="gal-status">
            {STATUS_KINDS.map((k) => (
              <li key={k}>
                <StatusPill status={k} />
                <span className="gal-status__desc">{STATUS_META[k].description}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel eyebrow="Series palette" title="stella · GENE · GX · bean · triangular" subtitle="Min pairwise ΔE00 under simulation (gate: ≥ 12 CVD, ≥ 20 normal)">
          <table className="gal-cvd">
            <thead>
              <tr>
                <th scope="col">Vision</th>
                {SERIES_IDS.map((id) => (
                  <th key={id} scope="col">
                    {SERIES_LABEL[id].replace(' tube', '')}
                  </th>
                ))}
                <th scope="col">min ΔE00</th>
              </tr>
            </thead>
            <tbody>
              {cvdRows.map(({ d, min }) => (
                <tr key={d}>
                  <th scope="row">{d}</th>
                  {SERIES_IDS.map((id) => (
                    <td key={id}>
                      <span
                        className="gal-cvd__chip"
                        style={{ background: d === 'normal' ? t.series[id] : simulateHex(t.series[id], d) }}
                      />
                    </td>
                  ))}
                  <td className="lab-num">{min.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
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
