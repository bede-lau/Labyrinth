// Hash routes for the four views. `#gallery` is not a route: main.tsx handles it at load time.
// The owner's redesign (bbf2fc6) retired Advance plasma, Check transport and Budget from navigation: their hashes
// fall back to the default view. Heat & field (D-027) is the fourth entry.
import type { ArtifactId } from '../lib/artifacts';

export type RouteId = 'locate' | 'forecast' | 'spatial' | 'heat';

export interface RouteDef {
  id: RouteId;
  /** Nav label, as named in the PRD (Heat & field: the owner's requirement of 2026-11-21, D-027). */
  label: string;
  /**
   * How the view's data arrives. Replay of saved evidence is the default and is not repeated in the nav; any other
   * source is named under the label. `model` = an illustrative model running in the browser.
   */
  source: 'replay' | 'live' | 'model';
  /** Files the view reads, named in error panels if the view fails. */
  files: string[];
}

const artifactFile = (id: ArtifactId) => `artifacts/${id}.json`;

export const ROUTES: readonly RouteDef[] = [
  { id: 'locate', label: 'Locate the tubes', source: 'replay', files: [artifactFile('geometry')] },
  { id: 'forecast', label: 'Forecast replay', source: 'replay', files: [artifactFile('forecast')] },
  { id: 'spatial', label: 'Spatial parallelism', source: 'replay', files: [artifactFile('spatial')] },
  // D-027: real VMEC geometry and |B| with an illustrative edge heat model computed in the browser.
  { id: 'heat', label: 'Heat & field', source: 'model', files: [artifactFile('heatfield')] },
];

/** The words for a route's source: the nav prints them under the label of every view that is not a replay. */
export function sourceLabel(source: RouteDef['source']): string {
  return source === 'live' ? 'GX run · gated' : source === 'model' ? 'illustrative model' : 'replay';
}

export const DEFAULT_ROUTE: RouteId = 'locate';

export function hrefFor(id: RouteId): string {
  return `#/${id}`;
}

/** `#/spatial` -> 'spatial'. Anything else (empty, unknown, retired, `#gallery`) -> null. */
export function parseHash(hash: string): RouteId | null {
  const m = /^#\/([a-z]+)\/?$/.exec(hash);
  const id = m?.[1];
  return ROUTES.some((r) => r.id === id) ? (id as RouteId) : null;
}

export function routeDef(id: RouteId): RouteDef {
  return ROUTES.find((r) => r.id === id) ?? (ROUTES[0] as RouteDef);
}
