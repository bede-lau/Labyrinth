import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { GeometryView } from '../features/geometry/GeometryView';
import { ForecastView } from '../features/forecast/ForecastView';
import { SpatialView } from '../features/spatial/SpatialView';
import { HeatFieldView } from '../features/heatfield/HeatFieldView';
import { useLiveStatus } from '../lib/liveStatus';
import { ViewErrorBoundary } from './ArtifactGate';
import { HeaderBoundary } from './Boundary';
import { ModeAlert } from './ModeIndicator';
import { centeredScrollLeft, fadeEdges, type FadeEdges } from './navScroll';
import { ProvenanceLegend } from './ProvenanceLegend';
import { ROUTES, hrefFor, routeDef, sourceLabel, type RouteId } from './routes';
import { ThemeSwitch } from './ThemeSwitch';
import { useHashRoute } from './useHashRoute';
import './shell.css';


const VIEWS: Record<RouteId, ComponentType> = {
  locate: GeometryView,
  forecast: ForecastView,
  spatial: SpatialView,
  heat: HeatFieldView,
};

// Each navigation glyph describes the view beside it. Text carries the accessible name.
const ROUTE_GLYPHS: Record<RouteId, string> = {
  locate: 'M12 3c6 0 9 5 7 10s-9 10-14 6-2-9 1-12 4-4 6-4Z M15 7c3 2 0 7-3 9s-6 1-5-2 4-9 8-7Z',
  forecast: 'M3 17l5-6 4 2 3-6m3-2 1-1m1 5 1-1M14 7l-1 4',
  spatial: 'M12 2.5 21 7l-9 4.5L3 7zM3 12l9 4.5 9-4.5M3 17l9 4.5 9-4.5',
  // A thermometer beside a field line: temperature and |B|.
  heat: 'M8 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z M10 10v6 M16 5c3 2 4 4.5 4 7s-1 5-4 7',
};

function Wordmark() {
  return <p className="shell-wordmark">
    <img alt="" src="/labyrinth-mark.png" width="44" height="44" />
    Labyrinth
  </p>;
}

export interface AppProps {
  /** Live-status poll interval (ms). */
  pollMs?: number;
}

export function App({ pollMs = 2000 }: AppProps) {
  const route = useHashRoute();
  // The shared store (lib/liveStatus.ts): the views that call useLiveStatus read this same state.
  const live = useLiveStatus(pollMs);
  const def = routeDef(route);
  const View = VIEWS[route];
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shownRoute = useRef(route);
  const [announcement, setAnnouncement] = useState('');
  const [fade, setFade] = useState<FadeEdges>('none');
  useEffect(() => {
    document.title = `${def.label} · Labyrinth`;
  }, [def.label]);

  // A route change is announced, and focus follows it to the view unless the keyboard is in the nav
  // (there focus stays on the link, so Tab keeps moving along the views). Nothing on first load.
  useEffect(() => {
    if (shownRoute.current === route) return;
    shownRoute.current = route;
    setAnnouncement(`${routeDef(route).label} view`);
    if (!navRef.current?.contains(document.activeElement)) mainRef.current?.focus({ preventScroll: true });
  }, [route]);

  const syncFade = useCallback(() => {
    const el = scrollRef.current;
    if (el) setFade(fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);

  // Narrow screens: bring the active tab to the middle of the nav. Only the nav scrolls, never the page.
  useEffect(() => {
    const el = scrollRef.current;
    const link = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && link) {
      const box = el.getBoundingClientRect();
      const item = link.getBoundingClientRect();
      el.scrollLeft = centeredScrollLeft(el.clientWidth, el.scrollWidth, item.left - box.left + el.scrollLeft, item.width);
    }
    syncFade();
  }, [route, syncFade]);

  useEffect(() => {
    const el = scrollRef.current;
    el?.addEventListener('scroll', syncFade, { passive: true });
    window.addEventListener('resize', syncFade);
    return () => {
      el?.removeEventListener('scroll', syncFade);
      window.removeEventListener('resize', syncFade);
    };
  }, [syncFade]);

  return (
    <div className="shell">
      <a className="shell-skip" href="#main" onClick={(e) => {
        // Hash routing owns location.hash; move focus without changing the route.
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>
      <header className="shell-header">
        <Wordmark />
        <nav ref={navRef} className="shell-nav" aria-label="Views">
          <div ref={scrollRef} className="shell-nav__scroll" data-fade={fade}>
            <ul className="shell-nav__list">
              {ROUTES.map((r) => (
                <li key={r.id}>
                  <a className="shell-nav__link" href={hrefFor(r.id)} aria-current={r.id === route ? 'page' : undefined}>
                    <svg className="shell-nav__icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ROUTE_GLYPHS[r.id]} /></svg>
                    <span className="shell-nav__text">
                      <span className="shell-nav__label">{r.label}</span>
                      {/* Replay is the default; a view whose numbers come from elsewhere says so (D-027: "illustrative model").
                          The space keeps the two words apart in the link's accessible name; a flex container does not draw it. */}
                      {r.source !== 'replay' && <>{' '}<span className="shell-nav__source">{sourceLabel(r.source)}</span></>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <ThemeSwitch />
      </header>
      <HeaderBoundary what="live-session alert" resetKey={live}>
        <ModeAlert state={live} />
      </HeaderBoundary>
      <div className="lab-visually-hidden" aria-live="polite" aria-atomic="true" data-testid="route-announcer">
        {announcement}
      </div>
      <main ref={mainRef} id="main" className="shell-main" tabIndex={-1} aria-label={def.label}>
        <h1 className="shell-title">{def.label}</h1>
        <ViewErrorBoundary key={route} view={def.label} files={def.files}>
          <View />
        </ViewErrorBoundary>
      </main>
      {/* The global legend (A4, A6), collapsed under every view. Not a page footer. */}
      <div className="shell-legend-row">
        <ProvenanceLegend />
      </div>
    </div>
  );
}
