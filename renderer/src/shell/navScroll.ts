// Geometry for the horizontally scrolling nav (DS-5). Pure, so it is tested without a layout engine.

/** scrollLeft that centres an item of `itemWidth` at `itemStart` in a `viewWidth` window over `contentWidth`. */
export function centeredScrollLeft(viewWidth: number, contentWidth: number, itemStart: number, itemWidth: number): number {
  const max = Math.max(0, contentWidth - viewWidth);
  return Math.round(Math.min(max, Math.max(0, itemStart - (viewWidth - itemWidth) / 2)));
}

export type FadeEdges = 'none' | 'start' | 'end' | 'both';

/** Which edges of the scroller hide more content (drawn as a fade, so a cut-off tab reads as "more here"). */
export function fadeEdges(scrollLeft: number, viewWidth: number, contentWidth: number): FadeEdges {
  const start = scrollLeft > 1;
  const end = scrollLeft + viewWidth < contentWidth - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}
