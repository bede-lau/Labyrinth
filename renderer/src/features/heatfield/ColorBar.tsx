import type { ReactNode } from 'react';
import { fieldGradientCss, formatNumber, heatGradientCss, type ThemeName } from '../../design';
import type { ColorBy } from './scene';
import { SubscriptText } from './SubscriptText';

export interface ColorBarProps {
  kind: ColorBy;
  range: readonly [number, number];
  theme: ThemeName;
  /** "Temperature", "|B|". */
  title: string;
  unit: string;
  decimals: number;
  /** The status pill of the quantity (model / VMEC). */
  status: ReactNode;
  /** Where the range comes from, in words. */
  note: string;
}

/** End words and the owner's colour words (spoken, never used as colours). */
const ENDS: Record<ColorBy, [string, string, string, string]> = {
  temperature: ['coldest', 'hottest', 'coldest end in yellow', 'hottest end in red'],
  field: ['weakest', 'strongest', 'weakest end in green', 'strongest end in dark blue'],
};

/** Colour bar with the quantity, its unit, the words at its ends and its status (DESIGN.md §7, Heat & field). */
export function ColorBar({ kind, range, theme, title, unit, decimals, status, note }: ColorBarProps) {
  const [lo, hi] = range;
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
        aria-label={`Colour bar: ${title} in ${unit} from ${f(lo)} (${weakColour}) to ${f(hi)} (${strongColour}). ${note}`}
      >
        <span className="hf-colorbar__bar" data-testid={`colorbar-${kind}`} style={{ background: kind === 'temperature' ? heatGradientCss(theme) : fieldGradientCss(theme) }} />
        <span className="hf-colorbar__ticks lab-num" aria-hidden="true">
          <span>
            {f(lo)} · {weak}
          </span>
          <span>{f((lo + hi) / 2)}</span>
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
