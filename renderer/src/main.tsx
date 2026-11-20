import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import { App } from './shell/App';

// Design-system gallery for review: open /#gallery (lazy chunk; not part of the app bundle).
const Gallery = lazy(() => import('./design/Gallery'));
const isGallery = location.hash === '#gallery';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isGallery ? (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
