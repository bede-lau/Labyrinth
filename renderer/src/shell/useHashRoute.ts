import { useEffect, useState } from 'react';
import { DEFAULT_ROUTE, hrefFor, parseHash, type RouteId } from './routes';

/**
 * The current view from `location.hash`. An empty or unknown hash is normalised to the default
 * route with replaceState (no extra history entry), so the URL always names the visible view.
 */
export function useHashRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(() => parseHash(location.hash) ?? DEFAULT_ROUTE);
  useEffect(() => {
    const sync = () => {
      if (location.hash === '#gallery') {
        // The design gallery is chosen once at load (main.tsx); reload so it can take over.
        location.reload();
        return;
      }
      const parsed = parseHash(location.hash);
      if (!parsed) history.replaceState(null, '', hrefFor(DEFAULT_ROUTE));
      setRoute(parsed ?? DEFAULT_ROUTE);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return route;
}
