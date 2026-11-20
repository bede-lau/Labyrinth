import { useId } from 'react';
import { formatNumber } from '../../design';
import { insetLayout } from './model';
import type { Tube } from './types';

const SIZE = { width: 320, height: 260, padLeft: 48, padBottom: 40, pad: 10 };

export interface CrossSectionInsetProps {
  tube: Tube;
  boundary?: { R: number[]; Z: number[] };
  centre: { R: number; Z: number };
}

/** 2D inset at the tube's central ζ: sampled surface (solid), plasma boundary (dashed), centre ●. */
export function CrossSectionInset({ tube, boundary, centre }: CrossSectionInsetProps) {
  const id = useId();
  const L = insetLayout(tube.crossSection, boundary, centre, SIZE);
  const { plot } = L;
  const zeta = formatNumber(tube.crossSection.zetaDeg, 0);
  return (
    <figure className="geo-inset">
      <svg
        viewBox={`0 0 ${L.width} ${L.height}`}
        className="geo-inset__svg"
        role="img"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
      >
        <title id={`${id}-t`}>{`Cross-section at ζ = ${zeta}°: sampled ρ 0.8 surface and plasma boundary, R and Z in metres`}</title>
        <desc id={`${id}-d`}>
          {`Solid line: the sampled flux surface (ρ 0.8). Dashed line: the plasma boundary (s = 1)${boundary ? '' : ', not available'}. ` +
            `Dot: the tube centre at R ${formatNumber(centre.R, 3)} m, Z ${formatNumber(centre.Z, 3)} m.`}
        </desc>
        <g className="geo-inset__grid" aria-hidden="true">
          {L.xTicks.map((t) => (
            <line key={`gx${t.value}`} x1={t.pos} x2={t.pos} y1={plot.y0} y2={plot.y1} />
          ))}
          {L.yTicks.map((t) => (
            <line key={`gy${t.value}`} x1={plot.x0} x2={plot.x1} y1={t.pos} y2={t.pos} />
          ))}
        </g>
        <rect className="geo-inset__frame" x={plot.x0} y={plot.y0} width={plot.x1 - plot.x0} height={plot.y1 - plot.y0} aria-hidden="true" />
        <g className="geo-inset__ticks" aria-hidden="true">
          {L.xTicks.map((t) => (
            <text key={`tx${t.value}`} x={t.pos} y={plot.y1 + 14} textAnchor="middle">
              {formatNumber(t.value, 1)}
            </text>
          ))}
          {L.yTicks.map((t) => (
            <text key={`ty${t.value}`} x={plot.x0 - 6} y={t.pos + 4} textAnchor="end">
              {formatNumber(t.value, 1)}
            </text>
          ))}
        </g>
        {L.boundaryPath && <path className="geo-inset__boundary" data-testid="inset-boundary" d={L.boundaryPath} strokeDasharray="4 3" />}
        <path className="geo-inset__sampled" data-testid="inset-sampled" d={L.sampledPath} />
        <circle className={`geo-inset__centre geo-inset__centre--${tube.id}`} cx={L.centre.x} cy={L.centre.y} r={5} />
        <text className="geo-inset__axis" x={(plot.x0 + plot.x1) / 2} y={L.height - 6} textAnchor="middle">
          Major radius R (m)
        </text>
        <text
          className="geo-inset__axis"
          transform={`translate(12 ${(plot.y0 + plot.y1) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Z (m)
        </text>
      </svg>
      <figcaption className="geo-inset__legend">
        <span className="geo-key">
          <svg width="22" height="8" aria-hidden="true">
            <line className="geo-inset__sampled" x1="1" x2="21" y1="4" y2="4" />
          </svg>
          sampled surface ρ 0.8
        </span>
        <span className="geo-key">
          <svg width="22" height="8" aria-hidden="true">
            <line className="geo-inset__boundary" x1="1" x2="21" y1="4" y2="4" strokeDasharray="4 3" />
          </svg>
          plasma boundary (s = 1)
        </span>
        <span className="geo-key">
          <svg width="10" height="10" aria-hidden="true">
            <circle className={`geo-inset__centre geo-inset__centre--${tube.id}`} cx="5" cy="5" r="4" />
          </svg>
          tube centre (θ* = 0)
        </span>
      </figcaption>
    </figure>
  );
}
