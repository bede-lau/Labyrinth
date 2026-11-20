// plotTheme / sceneTheme / format / theme resolution behaviour.
import { hexToRgb } from './color';
import { formatNumber, formatSigned, formatWindow, parseUnit, plotlyUnit, spokenUnit } from './format';
import { axisTitle, plotLayout, seriesStyle, uncertaintyBand, windowShape, SERIES_LABEL } from './plotTheme';
import { bmagColor, normalizeBmag, sceneTheme, toThreeHex } from './sceneTheme';
import { resolveTheme, setThemePreference } from './theme';
import { SERIES_IDS, THEMES, themes } from './tokens';

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
    expect(s.fillcolor).toBe(themes.dark.plot.windowShade);
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
