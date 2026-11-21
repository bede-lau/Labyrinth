// The poloidal slice at the slider's toroidal angle (H11), coloured by the model temperature or |B| from MODEL.md's
// cross-section formulas, in true R–Z proportions. Hovering a cell shows the read-out (H10). Without a mouse the
// slice is one focusable group: the arrow keys move a cursor over the cells (← → along θ, ↑ ↓ across the flux
// surfaces, Home / End to the innermost / outermost ring) and show the same read-out, announced in words (HF-R3).
import { memo, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { fieldColor, formatNumber, heatColor, type ThemeName } from '../../design';
import { cellMean, type SliceLayout } from './slice';
import { rgbToHex, type ColorBy } from './scene';

export interface SliceHover {
  m: number;
  i: number;
  /** Position of the read-out inside the figure box (px): the pointer, or the centre of the keyboard cell. */
  x: number;
  y: number;
  /** Pointer hover or the keyboard cursor. */
  source: 'pointer' | 'keyboard';
}

export interface SliceCellIndex {
  m: number;
  i: number;
}

export interface CrossSectionProps {
  layout: SliceLayout;
  /** Node values of the quantity coloured (m·nTheta + i). */
  values: Float64Array;
  nTheta: number;
  colorBy: ColorBy;
  range: readonly [number, number];
  theme: ThemeName;
  phiDeg: number;
  onHover: (h: SliceHover | null) => void;
  /** Cell the keyboard cursor starts on. */
  startCell: SliceCellIndex;
  /** Words for screen readers after a keyboard move (the read-out's content); empty otherwise. */
  announcement: string;
  /** Read-out drawn over the figure. */
  overlay?: ReactNode;
  /**
   * The LCFS edge strip (DZ3-3): the last closed flux surface's temperature at this φ (one value per θ node, keV),
   * drawn in a band just outside the LCFS on the 3D surface's colour range, where the cold footprint under a plate
   * and its move with the coils show. Omitted when the slice is coloured by |B|.
   */
  edge?: EdgeStrip | null;
}

export interface EdgeStrip {
  values: Float64Array;
  range: readonly [number, number];
}

/** Colour of an edge-strip cell: the mean of its two LCFS nodes on the heat ramp over `range` (sRGB hex). */
export function edgeFill(values: ArrayLike<number>, i: number, range: readonly [number, number], theme: ThemeName): string {
  const n = values.length;
  const v = (values[i]! + values[(i + 1) % n]!) / 2;
  const [lo, hi] = range;
  return rgbToHex(heatColor(hi > lo ? (v - lo) / (hi - lo) : 0.5, theme));
}

function CrossSectionImpl({
  layout,
  values,
  nTheta,
  colorBy,
  range,
  theme,
  phiDeg,
  onHover,
  startCell,
  announcement,
  overlay,
  edge,
}: CrossSectionProps) {
  const [lo, hi] = range;
  const lookUp = colorBy === 'temperature' ? heatColor : fieldColor;
  const fill = (v: number) => rgbToHex(lookUp(hi > lo ? (v - lo) / (hi - lo) : 0.5, theme));
  const { plot } = layout;
  const hintId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerFocus = useRef(false);
  const [cursor, setCursor] = useState<SliceCellIndex | null>(null);
  const nRings = Math.round(layout.cells.length / nTheta);

  const move = (e: PointerEvent<SVGGElement>) => {
    const target = e.target as Element;
    const key = target.getAttribute?.('data-cell');
    if (!key) return;
    const [m, i] = key.split(':').map(Number) as [number, number];
    const box = (boxRef.current ?? e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    onHover({ m, i, x: e.clientX - box.left, y: e.clientY - box.top, source: 'pointer' });
  };

  /** Put the keyboard cursor on cell c and show its read-out at the cell's centre. */
  const showCell = (c: SliceCellIndex) => {
    const cell = layout.cells[c.m * nTheta + c.i];
    if (!cell) return;
    setCursor(c);
    let x = cell.cx;
    let y = cell.cy;
    const svg = svgRef.current;
    const box = boxRef.current;
    if (svg && box) {
      const r = svg.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const k = r.width > 0 ? r.width / layout.width : 1;
      x = r.left - b.left + cell.cx * k;
      y = r.top - b.top + cell.cy * k;
    }
    onHover({ m: c.m, i: c.i, x, y, source: 'keyboard' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = cursor ?? startCell;
    let next: SliceCellIndex;
    switch (e.key) {
      case 'ArrowLeft':
        next = { m: cur.m, i: (cur.i - 1 + nTheta) % nTheta };
        break;
      case 'ArrowRight':
        next = { m: cur.m, i: (cur.i + 1) % nTheta };
        break;
      case 'ArrowUp':
        next = { m: Math.min(nRings - 1, cur.m + 1), i: cur.i };
        break;
      case 'ArrowDown':
        next = { m: Math.max(0, cur.m - 1), i: cur.i };
        break;
      case 'Home':
        next = { m: 0, i: cur.i };
        break;
      case 'End':
        next = { m: nRings - 1, i: cur.i };
        break;
      case 'Escape':
        e.preventDefault();
        setCursor(null);
        onHover(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    showCell(next);
  };

  const cursorCell = cursor ? layout.cells[cursor.m * nTheta + cursor.i] : undefined;

  return (
    <figure className="hf-xs">
      <div
        ref={boxRef}
        className="hf-xs__box"
        role="group"
        tabIndex={0}
        aria-label={`Cross-section cells at φ ${formatNumber(phiDeg, 0)}°`}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onFocus={() => {
          // A click focuses the box too: then the pointer, not the keyboard cursor, drives the read-out.
          if (pointerFocus.current) {
            pointerFocus.current = false;
            return;
          }
          showCell(cursor ?? startCell);
        }}
        onBlur={() => {
          pointerFocus.current = false;
          setCursor(null);
          onHover(null);
        }}
      >
        <svg
          ref={svgRef}
          className="hf-xs__svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`Poloidal cross-section at toroidal angle ${formatNumber(phiDeg, 0)} degrees, coloured by ${colorBy === 'temperature' ? 'model temperature' : '|B|'}; major radius R and height Z in metres at equal scale${edge ? '; a strip just outside the last closed flux surface shows its model temperature on the 3D view’s colour scale' : ''}`}
        >
          <rect className="hf-xs__frame" x={plot.x0} y={plot.y0} width={plot.x1 - plot.x0} height={plot.y1 - plot.y0} />
          <g className="hf-xs__grid" aria-hidden="true">
            {layout.xTicks.map((t) => (
              <line key={`gx${t.value}`} x1={t.pos} x2={t.pos} y1={plot.y0} y2={plot.y1} />
            ))}
            {layout.yTicks.map((t) => (
              <line key={`gy${t.value}`} x1={plot.x0} x2={plot.x1} y1={t.pos} y2={t.pos} />
            ))}
          </g>
          <g
            className="hf-xs__cells"
            onPointerMove={move}
            onPointerLeave={() => (cursor ? showCell(cursor) : onHover(null))}
          >
            {layout.cells.map((c) => {
              // Stroked in its own colour: no anti-aliasing seam between neighbouring cells (DZ3-4).
              const f = fill(cellMean(values, c.m, c.i, nTheta));
              return <path key={`${c.m}:${c.i}`} d={c.d} data-cell={`${c.m}:${c.i}`} fill={f} stroke={f} />;
            })}
          </g>
          {edge && (
            <g className="hf-xs__edge" data-testid="edge-strip" aria-hidden="true">
              {layout.edge.map((c) => {
                const f = edgeFill(edge.values, c.i, edge.range, theme);
                return <path key={c.i} d={c.d} data-edge={c.i} fill={f} stroke={f} />;
              })}
              <path className="hf-xs__edge-outline" d={layout.edgeOutline} />
            </g>
          )}
          <path className="hf-xs__lcfs" d={layout.lcfsPath} />
          <circle className="hf-xs__axis" cx={layout.axis.x} cy={layout.axis.y} r={2.5} />
          {layout.plate && (
            <g className="hf-xs__plate" data-testid="slice-plate">
              <path className="hf-xs__plate-edge" d={layout.plate.path} />
              <path className="hf-xs__plate-fill" d={layout.plate.path} />
              <text className="hf-xs__plate-label" x={layout.plate.labelAt.x} y={layout.plate.labelAt.y} textAnchor={layout.plate.anchor}>
                {layout.plate.id}
              </text>
            </g>
          )}
          {cursorCell && (
            <g className="hf-xs__cursor" data-testid="slice-cursor" data-cell={`${cursorCell.m}:${cursorCell.i}`} aria-hidden="true">
              <path className="hf-xs__cursor-halo" d={cursorCell.d} />
              <path className="hf-xs__cursor-line" d={cursorCell.d} />
            </g>
          )}
          <g className="hf-xs__ticks" aria-hidden="true">
            {layout.xTicks.map((t) => (
              <text key={`tx${t.value}`} x={t.pos} y={plot.y1 + 14} textAnchor="middle">
                {formatNumber(t.value, 1)}
              </text>
            ))}
            {layout.yTicks.map((t) => (
              <text key={`ty${t.value}`} x={plot.x0 - 6} y={t.pos + 3} textAnchor="end">
                {formatNumber(t.value, 1)}
              </text>
            ))}
          </g>
          <text className="hf-xs__axis-title" x={(plot.x0 + plot.x1) / 2} y={layout.height - 6} textAnchor="middle">
            Major radius R (m)
          </text>
          <text className="hf-xs__axis-title" transform={`translate(14 ${(plot.y0 + plot.y1) / 2}) rotate(-90)`} textAnchor="middle">
            Height Z (m)
          </text>
        </svg>
        {overlay}
      </div>
      <figcaption id={hintId} className="hf-xs__hint">
        Keyboard: focus the slice, then ← → step along θ, ↑ ↓ step outward and inward across the flux surfaces, Home and End
        go to the innermost and outermost ring, Escape hides the read-out.
      </figcaption>
      <p className="lab-visually-hidden" aria-live="polite" aria-atomic="true" data-testid="slice-announcer">
        {announcement}
      </p>
    </figure>
  );
}

export const CrossSection = memo(CrossSectionImpl);
