import type { ReactNode } from 'react';
import { fieldGradientCss, formatNumber, heatGradientCss, type ThemeName } from '../../design';
import { LogTicks } from './LogTicks';
import { toMK, type ColorBy } from './scene';
import { SubscriptText } from './SubscriptText';

export interface ColorBarProps {
  kind: ColorBy;
  /** In the model's unit: keV for temperature (shown in MK), T for |B|. */
  range: readonly [number, number];
  theme: ThemeName;
  /** "Temperature", "|B|". */
  title: string;
  /** The unit the bar reads in ("MK" for temperature, "T" for |B|). */
  unit: string;
  decimals: number;
  /** The status pill of the quantity (model / VMEC). */
  status: ReactNode;
  /** Where the range comes from, in words. */
  note: string;
}

/** End words and the owner's colour words (spoken, never used as colours). */
const ENDS: Record<ColorBy, [string, string, string, string]> = {
  temperature: ['coldest', 'hottest', 'coldest end in yellow', 'hottest end in magenta'],
  field: ['weakest', 'strongest', 'weakest end in green', 'strongest end in dark blue'],
};

/**
 * Colour bar with the quantity, its unit, the words at its ends and its status (DESIGN.md §7, Heat & field). Temperature
 * is drawn on a logarithmic scale and read in megakelvin (1 keV = 11.6 MK), with 1-2-5 ticks along the bar.
 */
export function ColorBar({ kind, range, theme, title, unit, decimals, status, note }: ColorBarProps) {
  const temperature = kind === 'temperature';
  const [lo, hi] = temperature ? [toMK(range[0]), toMK(range[1])] : range;
  const [weak, strong, weakColour, strongColour] = ENDS[kind];
  const f = (v: number) => formatNumber(v, decimals);
  return (
    <div className="hf-colorbar" data-kind={kind}>
      <div className="hf-colorbar__head">
        <span className="hf-colorbar__title">
          {title} ({unit})
        </span>
        {status}
      </div>
      <div
        className="hf-colorbar__body"
        role="img"
        aria-label={`Colour bar: ${title} in ${unit} from ${f(lo)} (${weakColour}) to ${f(hi)} (${strongColour})${temperature ? ', logarithmic' : ''}. ${note}`}
      >
        <span className="hf-colorbar__bar" data-testid={`colorbar-${kind}`} style={{ background: temperature ? heatGradientCss(theme) : fieldGradientCss(theme) }} />
        {temperature && <LogTicks lo={lo} hi={hi} />}
        <span className="hf-colorbar__ticks lab-num" aria-hidden="true">
          <span>
            {f(lo)} · {weak}
          </span>
          {/* Temperature has its 1-2-5 ticks above; |B| is linear, its middle is the mean of the ends. */}
          {!temperature && <span>{f((lo + hi) / 2)}</span>}
          <span>
            {strong} · {f(hi)}
          </span>
        </span>
      </div>
      <p className="hf-colorbar__note">
        <SubscriptText text={note} />
      </p>
    </div>
  );
}
