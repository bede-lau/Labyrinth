import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { GeometryView } from '../features/geometry/GeometryView';
import { ForecastView } from '../features/forecast/ForecastView';
import { SpatialView } from '../features/spatial/SpatialView';
import { ViewActive } from '../lib/viewActive';
import { useLiveStatus } from '../lib/liveStatus';
import { ViewErrorBoundary } from './ArtifactGate';
import { HeaderBoundary } from './Boundary';
import { ModeAlert } from './ModeIndicator';
import { centeredScrollLeft, fadeEdges, type FadeEdges } from './navScroll';
import { ROUTES, hrefFor, routeDef, sourceLabel, type RouteId } from './routes';
import { ThemeSwitch } from './ThemeSwitch';
import { useHashRoute } from './useHashRoute';
import './shell.css';

const VIEWS: Record<Exclude<RouteId, 'locate'>, ComponentType> = {
  forecast: ForecastView,
  spatial: SpatialView,
};

// Each navigation glyph describes the view beside it. Text carries the accessible name.
const ROUTE_GLYPHS: Record<RouteId, string> = {
  locate: 'M12 3c6 0 9 5 7 10s-9 10-14 6-2-9 1-12 4-4 6-4Z M15 7c3 2 0 7-3 9s-6 1-5-2 4-9 8-7Z',
  forecast: 'M3 17l5-6 4 2 3-6m3-2 1-1m1 5 1-1M14 7l-1 4',
  spatial: 'M12 2.5 21 7l-9 4.5L3 7zM3 12l9 4.5 9-4.5M3 17l9 4.5 9-4.5',
};

function Wordmark() {
  return <p className="shell-wordmark">
    <img alt="" src="/labyrinth-mark.png" width="44" height="44" />
    Labyrinth
  </p>;
}

function ReactorPhoto() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="shell-photo-trigger" title="W7-X photo" aria-label="Open W7-X photo"
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/>
        <circle cx="9" cy="10" r="1.5"/><path d="m4 17 5-4 3 2 4-5 5 6"/></svg>
    </button>
    <dialog ref={dialog} className="shell-photo-dialog" aria-label="Wendelstein 7-X photograph"
      onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
      <figure>
        <figcaption><strong>Wendelstein 7-X</strong>
          <button type="button" aria-label="Close photo" onClick={() => dialog.current?.close()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </figcaption>
        <img src={import.meta.env.BASE_URL + 'w7x-assembly.jpg'} width="1234" height="816" loading="lazy"
          alt="Wendelstein 7-X during assembly, with exposed copper coils, vessel ports and support frames" />
      </figure>
    </dialog>
  </>;
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
  const [visited, setVisited] = useState<RouteId[]>([route]);
  if (!visited.includes(route)) setVisited([...visited, route]);
  const scrollPositions = useRef<Partial<Record<RouteId, number>>>({});
  useLayoutEffect(() => {
    const y = scrollPositions.current[route] ?? 0;
    if (window.scrollY !== y) window.scrollTo({top: y, behavior: 'instant'});
    const remember = () => { scrollPositions.current[route] = window.scrollY; };
    window.addEventListener('scroll', remember, {passive: true});
    return () => window.removeEventListener('scroll', remember);
  }, [route]);
  const [assignmentsAnchor, setAssignmentsAnchor] = useState<HTMLDivElement | null>(null);
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
          <ReactorPhoto />
        </nav>
        <div className="shell-header__actions">
          <div ref={setAssignmentsAnchor} className="shell-header__assignments" />
          <ThemeSwitch />
        </div>
      </header>
      <HeaderBoundary what="live-session alert" resetKey={live}>
        <ModeAlert state={live} />
      </HeaderBoundary>
      <div className="lab-visually-hidden" aria-live="polite" aria-atomic="true" data-testid="route-announcer">
        {announcement}
      </div>
      <main ref={mainRef} id="main" className="shell-main" tabIndex={-1} aria-label={def.label}>
        <h1 className="lab-visually-hidden">{def.label}</h1>
        {visited.map(id => {
          const active = id === route;
          const tab = routeDef(id);
          const View = id === 'locate' ? null : VIEWS[id];
          return (
            <div key={id} hidden={!active}>
              <ViewActive.Provider value={active}>
                <ViewErrorBoundary view={tab.label} files={tab.files}>
                  {View ? <View /> : <GeometryView assignmentsAnchor={active ? assignmentsAnchor : null} />}
                </ViewErrorBoundary>
              </ViewActive.Provider>
            </div>
          );
        })}
      </main>
    </div>
  );
}
