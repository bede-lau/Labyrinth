// plotTheme / sceneTheme / format / theme resolution behaviour.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hexToRgb, withAlpha } from './color';
import { formatNumber, formatSigned, formatWindow, parseUnit, plotlyUnit, spokenUnit } from './format';
import {
  axisTitle,
  plotConfig,
  plotLayout,
  seriesStyle,
  uncertaintyBand,
  unsampledShapes,
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
  // design-r1-R2: the artifacts' `matches` flags come from Python's round(), which rounds an exact
  // binary tie to even, where toFixed() rounds it away from zero. Printed values follow Python, so a
  // flag and the values printed beside it cannot disagree. Expected strings: python3 f"{round(x, d):.{d}f}".
  test.each([
    [0.125, 2, '0.12'],
    [2.5, 0, '2'],
    [14.25, 1, '14.2'],
    [0.375, 2, '0.38'],
    [3.5, 0, '4'],
    [1.5, 0, '2'],
    [0.5, 0, '0'],
    [-0.125, 2, '−0.12'],
    [0.0625, 3, '0.062'],
    // stored below the tie (2.67499…, 1.00499…, 0.1499…): down, as stored; above it: up
    [2.675, 2, '2.67'],
    [1.005, 2, '1.00'],
    [0.15, 1, '0.1'],
    [0.15000000000000002, 1, '0.2'],
    [0.25, 1, '0.2'],
  ] as const)('formatNumber(%s, %s) rounds like Python round(): %s', (x, d, expected) => {
    expect(formatNumber(x, d)).toBe(expected);
  });
  test('formatSigned uses the same rounding: a tie that rounds to zero is unsigned', () => {
    expect(formatSigned(0.5, 0)).toBe('0');
    expect(formatSigned(-0.5, 0)).toBe('0');
    expect(formatSigned(1.5, 0)).toBe('+2');
    expect(formatSigned(-0.125, 2)).toBe('−0.12');
  });
  test('units', () => {
    expect(parseUnit('Q_gB')).toEqual([
      { text: 'Q', sub: false },
      { text: 'gB', sub: true },
    ]);
    expect(plotlyUnit('a/v_{th,i}')).toBe('a/v<sub>th,i</sub>');
    expect(spokenUnit('Q_gB')).toBe('Q gB');
  });
  // DL-3: the artifacts write their units as prose ("Q_i/Q_gB,i vs t v_th,i/a"). A comma between two
  // word characters belongs to the subscript (Q_{gB,i}); a comma followed by a space ends it.
  test('units: a comma-joined subscript stays one subscript, a list comma does not', () => {
    expect(parseUnit('Q_gB,i')).toEqual([
      { text: 'Q', sub: false },
      { text: 'gB,i', sub: true },
    ]);
    expect(plotlyUnit('Q_i/Q_gB,i vs t v_th,i/a')).toBe('Q<sub>i</sub>/Q<sub>gB,i</sub> vs t v<sub>th,i</sub>/a');
    expect(plotlyUnit('Q_i, Q_e')).toBe('Q<sub>i</sub>, Q<sub>e</sub>');
    expect(plotlyUnit('B_ref = 2.60431 T, a = Aminor_p')).toBe('B<sub>ref</sub> = 2.60431 T, a = Aminor<sub>p</sub>');
    expect(spokenUnit('Q_gB,i')).toBe('Q gB,i');
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
    // design-r1-R8: a partial font inside the layout title, the legend or the hover label used to
    // replace the themed font, dropping its colour, family and weight.
    test('title, legend and hover-label fonts: one key overridden, the others kept', () => {
      const l = plotLayout(theme, {
        title: { text: 'x', font: { size: 16 } },
        legend: { font: { size: 10 } },
        hoverlabel: { font: { size: 13 } },
      });
      expect(l.title).toEqual({ ...base.title, text: 'x', font: { family: font.sans, size: 16, color: t.color.text, weight: 600 } });
      expect(l.legend.font).toEqual({ family: font.sans, size: 10, color: t.color.text });
      expect(l.hoverlabel.font).toEqual({ family: font.sans, size: 13, color: t.color.text });
      expect(l.hoverlabel.bgcolor).toBe(base.hoverlabel.bgcolor);
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
      const [block, label] = unsampledShapes([340, 420], theme);
      expect(block).toMatchObject({ type: 'rect', x0: 340, x1: 420, yref: 'paper', y0: 0, y1: 1, layer: 'below', name: 'unsampled' });
      expect(block?.fillcolor).toBe(withAlpha(t.plot.unsampled, t.plot.unsampledAlpha));
      // A horizontal, centred label is cut by the plot edge when the block is narrower than the word
      // (46 px at 390). Vertical text needs one line height of width.
      expect(label?.label).toMatchObject({ text: 'unsampled', textangle: -90, textposition: 'bottom left' });
      // Plotly rotates the text about its start point, so the glyphs lie on the far side of the
      // baseline: the padding must be at least the font size for them to land inside the block.
      const size = typeScale['2xs'][0];
      expect(label?.label?.font?.size).toBe(size);
      expect(label?.label?.padding).toBeGreaterThanOrEqual(size);
    }
  });

  // DL-4: a grid line was drawn through the word "unsampled". Plotly draws every shape that is not
  // layer "above" and refers to the paper UNDER the grid, label included; so the label rides on its own
  // transparent "above" shape over the same range, while the gray stays under the grid and the data.
  test('unsampled range: the gray block stays under the grid and the data; its label is drawn above the grid (DL-4)', () => {
    for (const theme of THEMES) {
      const shapes = unsampledShapes([340, 420], theme);
      expect(shapes).toHaveLength(2);
      const [block, label] = shapes;
      expect(block?.label, 'the block carries no label: it would be drawn under the grid').toBeUndefined();
      expect(block?.layer).toBe('below');
      expect(label).toMatchObject({ type: 'rect', xref: 'x', yref: 'paper', x0: 340, x1: 420, y0: 0, y1: 1, layer: 'above', name: 'unsampled label' });
      // Transparent and unstroked: above the data it must add the word and nothing else.
      expect(label?.fillcolor).toBe(withAlpha(themes[theme].plot.unsampled, 0));
      expect(label?.line?.width).toBe(0);
      expect(label?.label?.font?.color).toBe(themes[theme].color.textMuted);
    }
  });
  test('the installed Plotly layers shapes as DL-4 assumes (the control for the test above)', () => {
    const bundle = readFileSync(resolve(import.meta.dirname, '../../node_modules/plotly.js-dist-min/plotly.min.js'), 'utf8');
    // "above" shapes go to the upper layer; any other shape that refers to the paper goes to the lower one.
    expect(bundle).toMatch(
      /if\((\w)\.layer==="above"\)\w\(\w\._fullLayout\._shapeUpperLayer\);else if\(\1\.xref\.includes\("paper"\)\|\|\1\.yref\.includes\("paper"\)\)\w\(\w\._fullLayout\._shapeLowerLayer\)/,
    );
    // The lower layer is created before the cartesian layer (which holds the grid): it is painted under it.
    expect(bundle).toMatch(/(\w)\._paper\.append\("g"\)\.classed\("layer-below",!0\);\1\._imageLowerLayer=\w\.append\("g"\)\.classed\("imagelayer",!0\),\1\._shapeLowerLayer=\w\.append\("g"\)\.classed\("shapelayer",!0\),\1\._cartesianlayer=/);
    // The upper layer lives in the top SVG, over the data; that SVG takes no pointer events, so the
    // transparent label shape cannot steal hover from the traces under it.
    expect(bundle).toMatch(/=(\w)\._toppaper\.append\("g"\)\.classed\("layer-above",!0\);\1\._imageUpperLayer=\w\.append\("g"\)\.classed\("imagelayer",!0\),\1\._shapeUpperLayer=/);
    expect(bundle).toContain('"X .main-svg":"position:absolute;top:0;left:0;pointer-events:none;"');
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
