// plotTheme / sceneTheme / format / theme resolution behaviour.
import { hexToRgb, withAlpha } from './color';
import { formatNumber, formatSigned, formatWindow, parseUnit, plotlyUnit, spokenUnit } from './format';
import {
  axisTitle,
  plotConfig,
  plotLayout,
  seriesStyle,
  uncertaintyBand,
  unsampledShape,
  windowShape,
  NARROW_CHART_QUERY,
  SERIES_LABEL,
} from './plotTheme';
import { bmagColor, normalizeBmag, sceneTheme, toThreeHex } from './sceneTheme';
import { resolveTheme, setThemePreference } from './theme';
import { SERIES_IDS, THEMES, font, themes, typeScale } from './tokens';

describe('format', () => {
  test('numbers', () => {
    expect(formatNumber(2.674, 2)).toBe('2.67');
    expect(formatNumber(-0.004, 2)).toBe('0.00');
    expect(formatNumber(-1.5, 1)).toBe('−1.5');
    expect(formatNumber(null, 2)).toBe('—');
    expect(formatNumber(Number.NaN, 2)).toBe('—');
    expect(formatSigned(0.01, 2)).toBe('+0.01');
    expect(formatSigned(-0.006, 2)).toBe('−0.01');
    expect(formatSigned(0.001, 2)).toBe('0.00');
    expect(formatWindow([1500, 1893.765])).toBe('1500–1893.765');
  });
  test('units', () => {
    expect(parseUnit('Q_gB')).toEqual([
      { text: 'Q', sub: false },
      { text: 'gB', sub: true },
    ]);
    expect(plotlyUnit('a/v_{th,i}')).toBe('a/v<sub>th,i</sub>');
    expect(spokenUnit('Q_gB')).toBe('Q gB');
  });
});

describe('plotTheme', () => {
  test('axis titles always carry a unit', () => {
    expect(axisTitle('Ion heat flux Q_i', 'Q_gB')).toBe('Ion heat flux Q<sub>i</sub> (Q<sub>gB</sub>)');
    expect(axisTitle('ρ', 'dimensionless')).toBe('ρ (–)');
    expect(() => axisTitle('Time', '')).toThrow(/unit is required/);
  });
  test.each(THEMES)('%s layout uses the theme surfaces, text and palette', (theme) => {
    const t = themes[theme];
    const l = plotLayout(theme, { yaxis: { title: { text: 'y' } } });
    expect(l.paper_bgcolor).toBe(t.plot.paper);
    expect(l.font.color).toBe(t.color.textMuted);
    expect(l.xaxis.gridcolor).toBe(t.plot.grid);
    expect(l.yaxis.title?.text).toBe('y');
    expect(l.yaxis.gridcolor).toBe(t.plot.grid); // merge keeps the base axis
    expect(l.colorway).toEqual([t.series.stella, t.series.GENE, t.series.GX, t.series.bean, t.series.triangular]);
  });
  test('each series has a unique dash+marker pair (colour is never the only channel)', () => {
    const keys = SERIES_IDS.map((s) => {
      const st = seriesStyle(s, 'light');
      return `${st.line.dash}/${st.marker.symbol}`;
    });
    expect(new Set(keys).size).toBe(SERIES_IDS.length);
    expect(SERIES_LABEL.bean).toBe('Bean tube');
  });
  test('uncertainty band is a closed polygon around the centre line', () => {
    const b = uncertaintyBand([0, 1, 2], [1, 2, 3], 0.5, 'stella', 'light');
    expect(b.x).toEqual([0, 1, 2, 2, 1, 0]);
    expect(b.y).toEqual([1.5, 2.5, 3.5, 2.5, 1.5, 0.5]);
    expect(b.fill).toBe('toself');
    expect(b.showlegend).toBe(false);
  });
  test('window shading spans the plot height below the data', () => {
    const s = windowShape([300, 400], 'dark', '300–400');
    expect(s).toMatchObject({ x0: 300, x1: 400, yref: 'paper', y0: 0, y1: 1, layer: 'below' });
    expect(s.label).toMatchObject({ text: '300–400', textposition: 'top left' });
    expect(s.fillcolor).toBe(themes.dark.plot.windowShade);
    expect(s.line).toMatchObject({ color: themes.dark.plot.windowEdge, dash: 'dot' });
  });

  // DS-14: a caller that passes only `title.text` must keep the themed title font and standoff.
  describe.each(THEMES)('plotLayout merges overrides instead of replacing themed objects — %s', (theme) => {
    const t = themes[theme];
    const base = plotLayout(theme);
    test('axis title: text is added, font and standoff survive', () => {
      const l = plotLayout(theme, {
        xaxis: { title: { text: axisTitle('Time t', 'a/v_{th,i}') }, range: [0, 400] },
        yaxis: { title: { text: 'y (–)' } },
      });
      for (const axis of [l.xaxis, l.yaxis]) {
        expect(axis.title?.font).toEqual({ family: font.sans, size: typeScale.xs[0], color: t.color.textMuted });
        expect(axis.title?.standoff).toBe(8);
      }
      expect(l.xaxis.title?.text).toBe('Time t (a/v<sub>th,i</sub>)');
      expect(l.xaxis.range).toEqual([0, 400]);
      expect(l.xaxis.tickfont).toEqual(base.xaxis.tickfont);
    });
    test('axis title font: one key overridden, the others kept', () => {
      const l = plotLayout(theme, { yaxis: { title: { text: 'y', font: { size: 14 }, standoff: 12 }, tickfont: { size: 10 } } });
      expect(l.yaxis.title).toEqual({ text: 'y', font: { family: font.sans, size: 14, color: t.color.textMuted }, standoff: 12 });
      expect(l.yaxis.tickfont).toEqual({ family: font.sans, size: 10, color: t.color.textMuted });
      expect(l.xaxis.title).toEqual(base.xaxis.title); // untouched axis keeps the base
    });
    test('margin, legend, hover label and modebar: partial overrides keep the remaining themed keys', () => {
      const l = plotLayout(theme, { margin: { r: 40 }, legend: { orientation: 'v' }, hoverlabel: { align: 'right' }, modebar: { orientation: 'v' } });
      expect(l.margin).toEqual({ ...base.margin, r: 40 });
      expect(l.legend).toEqual({ ...base.legend, orientation: 'v' });
      expect(l.hoverlabel).toEqual({ ...base.hoverlabel, align: 'right' });
      expect(l.modebar).toEqual({ ...base.modebar, orientation: 'v' });
    });
    test('scalar and array overrides still replace (height, shapes, hovermode)', () => {
      const shapes = [windowShape([200, 300], theme)];
      const l = plotLayout(theme, { height: 360, shapes, hovermode: 'closest' });
      expect(l.height).toBe(360);
      expect(l.shapes).toBe(shapes);
      expect(l.hovermode).toBe('closest');
    });
    test('the base layout does not alias objects between calls (a caller may mutate its copy)', () => {
      const a = plotLayout(theme);
      const b = plotLayout(theme);
      expect(a.xaxis.title).not.toBe(b.xaxis.title);
      expect(a.xaxis.title?.font).not.toBe(b.xaxis.title?.font);
    });
  });

  // F8: at 390 px the hover modebar (≈216 px) covers a top legend. On a narrow chart the legend
  // moves under the plot, where Plotly reserves room for it, and the top margin holds only the modebar.
  describe('plotLayout on a narrow chart (F8)', () => {
    afterEach(() => vi.unstubAllGlobals());
    const narrowMq = (matches: boolean) => (q: string) => ({ matches: q === NARROW_CHART_QUERY ? matches : false, media: q });

    test('wide (default in tests: no matchMedia): legend sits above the plot, left-aligned', () => {
      const l = plotLayout('light');
      expect(l.legend).toMatchObject({ orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom' });
      expect(l.legend.yref).toBeUndefined();
    });
    test('narrow: true puts the legend at the bottom of the container, below the axis title', () => {
      const l = plotLayout('light', {}, { narrow: true });
      expect(l.legend).toMatchObject({ orientation: 'h', x: 0, xanchor: 'left', yref: 'container', y: 0, yanchor: 'bottom' });
      // and survives a caller's own legend override
      const o = plotLayout('light', { legend: { font: { size: 10 } } }, { narrow: true });
      expect(o.legend).toMatchObject({ yref: 'container', y: 0, yanchor: 'bottom', font: { size: 10 } });
    });
    test('narrow follows the viewport when not stated, and narrow: false wins over it', () => {
      vi.stubGlobal('matchMedia', narrowMq(true));
      expect(plotLayout('dark').legend.yref).toBe('container');
      expect(plotLayout('dark', {}, { narrow: false }).legend.yref).toBeUndefined();
      vi.stubGlobal('matchMedia', narrowMq(false));
      expect(plotLayout('dark').legend.yref).toBeUndefined();
    });
    test('a blanket matchMedia stub (as theme tests use) does not flip charts to narrow', () => {
      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
      expect(plotLayout('light').legend.yref).toBeUndefined();
    });
    test('the query is a width query at the phone breakpoint', () => {
      expect(NARROW_CHART_QUERY).toBe('(max-width: 640px)');
    });
  });

  test('unsampled range: gray token at the token alpha, labelled inside the block along its left edge (F8)', () => {
    for (const theme of THEMES) {
      const t = themes[theme];
      const s = unsampledShape([340, 420], theme);
      expect(s).toMatchObject({ type: 'rect', x0: 340, x1: 420, yref: 'paper', y0: 0, y1: 1, layer: 'below', name: 'unsampled' });
      expect(s.fillcolor).toBe(withAlpha(t.plot.unsampled, t.plot.unsampledAlpha));
      // A horizontal, centred label is cut by the plot edge when the block is narrower than the word
      // (46 px at 390). Vertical text needs one line height of width.
      expect(s.label).toMatchObject({ text: 'unsampled', textangle: -90, textposition: 'bottom left' });
      // Plotly rotates the text about its start point, so the glyphs lie on the far side of the
      // baseline: the padding must be at least the font size for them to land inside the block.
      const size = typeScale['2xs'][0];
      expect(s.label?.font?.size).toBe(size);
      expect(s.label?.padding).toBeGreaterThanOrEqual(size);
    }
  });

  test('plotConfig keeps the modebar reachable (its focus ring is themed in tokens.css) and hides the logo', () => {
    const c = plotConfig();
    expect(c.displaylogo).toBe(false);
    expect(c.responsive).toBe(true);
    expect('displayModeBar' in c).toBe(false);
    expect(c.toImageButtonOptions.format).toBe('svg');
  });
});

describe('sceneTheme', () => {
  test.each(THEMES)('%s: tube colours match the series palette; surface is gray context', (theme) => {
    const s = sceneTheme(theme);
    expect(s.fieldLine.bean).toBe(themes[theme].series.bean);
    expect(s.fieldLine.triangular).toBe(themes[theme].series.triangular);
    const [r, g, b] = hexToRgb(s.surface.line);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.12); // low chroma = gray
    expect(s.unsampled).toBe(themes[theme].scene.unsampled);
  });
  test('bmagColor hits the stops at the ends and clamps', () => {
    const stops = themes.light.scene.bmag;
    expect(bmagColor(0, 'light')).toEqual(hexToRgb(stops[0] as string));
    expect(bmagColor(1, 'light')).toEqual(hexToRgb(stops[stops.length - 1] as string));
    expect(bmagColor(-3, 'light')).toEqual(bmagColor(0, 'light'));
    expect(bmagColor(Number.NaN, 'dark')).toEqual(bmagColor(0, 'dark'));
    expect(normalizeBmag(1.5, [1, 2])).toBe(0.5);
    expect(toThreeHex('#0b7f80')).toBe(0x0b7f80);
  });
});

describe('theme resolution mirrors tokens.css', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));
  test('data-theme wins; system falls back to the media query', () => {
    setThemePreference('dark');
    expect(resolveTheme()).toBe('dark');
    setThemePreference('light');
    expect(resolveTheme()).toBe('light');
    setThemePreference('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    const mm = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', mm);
    expect(resolveTheme()).toBe('dark');
    vi.unstubAllGlobals();
  });
});
