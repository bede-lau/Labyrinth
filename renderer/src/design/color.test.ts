// The colour science behind D2/D3 is itself tested, so a pass means something.
import {
  deltaE2000,
  hexToLab,
  MACHADO_2009,
  VIENOT_1999,
  simulateHex,
  simulateLab,
  withAlpha,
  type Lab,
} from './color';

describe('CIEDE2000 reproduces Sharma, Wu & Dalal (2005) test data to 4 decimals', () => {
  const cases: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
  ];
  test.each(cases)('%j vs %j = %d', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 4);
    expect(deltaE2000(b, a)).toBeCloseTo(expected, 4);
  });
});

describe('sRGB -> CIELAB', () => {
  test('white, black and mid gray', () => {
    const w = hexToLab('#ffffff');
    expect(w[0]).toBeCloseTo(100, 2);
    expect(Math.abs(w[1])).toBeLessThan(0.01);
    expect(hexToLab('#000000')[0]).toBeCloseTo(0, 5);
    expect(hexToLab('#777777')[0]).toBeCloseTo(50.03, 1);
  });
});

describe('CVD simulation matrices', () => {
  const all = [...Object.values(MACHADO_2009), ...Object.values(VIENOT_1999)];
  test('every row sums to ~1, so neutrals stay neutral', () => {
    for (const m of all) for (const row of m) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 3);
    for (const gray of ['#ffffff', '#808080', '#333333'])
      for (const d of ['protanopia', 'deuteranopia'] as const) {
        expect(deltaE2000(simulateLab(gray, d), hexToLab(gray))).toBeLessThan(1.5);
        expect(deltaE2000(simulateLab(gray, d, 'vienot1999'), hexToLab(gray))).toBeLessThan(1.5);
      }
  });
  test('classic confusion pair: red vs green collapses under deuteranopia but not in normal vision', () => {
    const red = '#d62728';
    const green = '#2ca02c';
    const normal = deltaE2000(hexToLab(red), hexToLab(green));
    const deutan = deltaE2000(simulateLab(red, 'deuteranopia'), simulateLab(green, 'deuteranopia'));
    expect(normal).toBeGreaterThan(50);
    expect(deutan).toBeLessThan(normal / 2.5);
  });
  test('blue/yellow survives protanopia and deuteranopia', () => {
    for (const d of ['protanopia', 'deuteranopia'] as const)
      expect(deltaE2000(simulateLab('#1148b3', d), simulateLab('#e5c057', d))).toBeGreaterThan(40);
  });
  test('simulateHex returns a hex colour', () => {
    expect(simulateHex('#0b7f80', 'deuteranopia')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

test('withAlpha', () => {
  expect(withAlpha('#0b7f80', 0.2)).toBe('rgba(11, 127, 128, 0.2)');
});
