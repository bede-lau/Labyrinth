// Hash routes for the six views. `#gallery` is not a route: main.tsx handles it at load time.
import type { ArtifactId } from '../lib/artifacts';

export type RouteId = 'locate' | 'advance' | 'transport' | 'forecast' | 'spatial' | 'budget';

export interface RouteDef {
  id: RouteId;
  /** Nav label, as named in the PRD. */
  label: string;
  /** How the view's data arrives, shown next to the label. */
  source: 'replay' | 'live';
  /** Files the view reads, named in error panels if the view fails. */
  files: string[];
}

const artifactFile = (id: ArtifactId) => `artifacts/${id}.json`;

export const ROUTES: readonly RouteDef[] = [
  { id: 'locate', label: 'Locate the tubes', source: 'replay', files: [artifactFile('geometry')] },
  { id: 'advance', label: 'Advance plasma', source: 'live', files: ['/api/live/status'] },
  { id: 'transport', label: 'Check transport', source: 'replay', files: [artifactFile('transport')] },
  { id: 'forecast', label: 'Forecast replay', source: 'replay', files: [artifactFile('forecast')] },
  { id: 'spatial', label: 'Spatial parallelism', source: 'replay', files: [artifactFile('spatial')] },
  { id: 'budget', label: 'Budget', source: 'replay', files: [artifactFile('budget')] },
];

export const DEFAULT_ROUTE: RouteId = 'locate';

export function hrefFor(id: RouteId): string {
  return `#/${id}`;
}

/** `#/spatial` -> 'spatial'. Anything else (empty, unknown, `#gallery`) -> null. */
export function parseHash(hash: string): RouteId | null {
  const m = /^#\/([a-z]+)\/?$/.exec(hash);
  const id = m?.[1];
  return ROUTES.some((r) => r.id === id) ? (id as RouteId) : null;
}

export function routeDef(id: RouteId): RouteDef {
  return ROUTES.find((r) => r.id === id) ?? (ROUTES[0] as RouteDef);
}
