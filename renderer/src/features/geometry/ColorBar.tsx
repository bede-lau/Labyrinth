import { bmagGradientCss, formatNumber, type ThemeName } from '../../design';

/** |B| colour bar: always visible next to the scene (the light and dark maps differ, DESIGN.md §7). */
export function ColorBar({ range, theme, tubeLabel }: { range: readonly [number, number]; theme: ThemeName; tubeLabel: string }) {
  const lo = formatNumber(range[0], 3);
  const hi = formatNumber(range[1], 3);
  const mid = formatNumber((range[0] + range[1]) / 2, 3);
  return (
    <div className="geo-colorbar" role="img" aria-label={`Colour bar: ${tubeLabel} coloured by |B| / B_ref from ${lo} (dark) to ${hi} (light)`}>
      <span className="geo-colorbar__title">
        |B| / B<sub>ref</sub>
      </span>
      <span className="geo-colorbar__bar" data-testid="colorbar" style={{ background: bmagGradientCss(theme) }} />
      <span className="geo-colorbar__ticks lab-num" aria-hidden="true">
        <span>{lo}</span>
        <span>{mid}</span>
        <span>{hi}</span>
      </span>
    </div>
  );
}
