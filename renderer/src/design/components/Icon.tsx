// 16px stroke icons drawn on a 16-unit grid; colour is always `currentColor`.
// Icons are decorative (aria-hidden): the adjacent text carries the meaning.

export type IconName =
  | 'check'
  | 'cross'
  | 'dash'
  | 'equals'
  | 'alert'
  | 'danger'
  | 'blocked'
  | 'question'
  | 'replay'
  | 'live'
  | 'rehearsal'
  | 'archive'
  | 'derived'
  | 'quote'
  | 'info'
  | 'warn'
  | 'chevron'
  | 'external';

const PATHS: Record<IconName, { stroke?: string[]; fill?: string[]; circle?: [number, number, number, boolean][] }> = {
  check: { stroke: ['M3.5 8.5l3 3 6-7'] },
  cross: { stroke: ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'] },
  dash: { stroke: ['M4 8h8'] },
  equals: { stroke: ['M4 6h8', 'M4 10h8'] },
  alert: { circle: [[8, 8, 6, false], [8, 11, 0.9, true]], stroke: ['M8 4.75v3.75'] },
  // A SOLID octagon (the stop sign) with a knocked-out "!": billing risk. At 12px an outlined octagon
  // reads as the circle of `alert`; a filled one does not (and it is not the triangle of `warn`).
  danger: { fill: ['M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2zM7.1 4.1h1.8v5H7.1zM8 10.3a1 1 0 1 1 0 2a1 1 0 1 1 0-2z'] },
  blocked: { circle: [[8, 8, 6, false]], stroke: ['M3.9 12.1l8.2-8.2'] },
  question: {
    circle: [[8, 8, 6, false], [8, 11.4, 0.85, true]],
    stroke: ['M6.2 6.4a1.85 1.85 0 1 1 2.6 1.7c-.55.3-.8.65-.8 1.25'],
  },
  replay: { stroke: ['M3.2 8a4.8 4.8 0 1 0 1.4-3.4', 'M3.4 2.6v2.6H6'] },
  live: { circle: [[8, 8, 3.5, true]] },
  rehearsal: { circle: [[8, 8, 5.75, false], [8, 8, 2.5, true]] },
  archive: { stroke: ['M2.5 3.5h11v3h-11z', 'M3.5 6.5v6h9v-6', 'M6.5 9h3'] },
  derived: { stroke: ['M11.5 3.5h-7l4 4.5-4 4.5h7'] },
  quote: { fill: ['M3 7.5h3.25V11H3zM9.25 7.5h3.25V11H9.25z'], stroke: ['M3.5 7.75c0-1.9.7-3 2.4-3.5', 'M9.75 7.75c0-1.9.7-3 2.4-3.5'] },
  info: { circle: [[8, 8, 6, false], [8, 5.1, 0.9, true]], stroke: ['M8 7.25v4'] },
  warn: { stroke: ['M8 2.75l5.75 10H2.25z', 'M8 6.5v3'], circle: [[8, 11.2, 0.8, true]] },
  chevron: { stroke: ['M6 4l4 4-4 4'] },
  external: { stroke: ['M7 3.5H3.5v9h9V9', 'M9.5 3.5h3v3', 'M12.5 3.5L7.5 8.5'] },
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 14, className }: IconProps) {
  const p = PATHS[name];
  return (
    <svg
      className={['lab-icon', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {p.circle?.map(([cx, cy, r, filled], i) => (
        <circle
          key={`c${i}`}
          cx={cx}
          cy={cy}
          r={r}
          fill={filled ? 'currentColor' : 'none'}
          stroke={filled ? 'none' : 'currentColor'}
          strokeWidth={1.6}
        />
      ))}
      {/* evenodd: a sub-path inside a filled shape is a hole (the "!" of `danger`). */}
      {p.fill?.map((d, i) => <path key={`f${i}`} d={d} fill="currentColor" fillRule="evenodd" />)}
      {p.stroke?.map((d, i) => (
        <path
          key={`s${i}`}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
