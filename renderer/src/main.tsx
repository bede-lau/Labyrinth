import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import { App } from './shell/App';
import { AppErrorBoundary } from './shell/Boundary';
import { isGalleryHash, watchGalleryHash } from './shell/galleryMode';

// Design-system gallery for review: open /#gallery (lazy chunk; not part of the app bundle).
const Gallery = lazy(() => import('./design/Gallery'));
const isGallery = isGalleryHash(location.hash);
// The root is chosen once; reload when the hash enters or leaves #gallery so Back/Forward stay in step.
watchGalleryHash(isGallery, () => location.reload());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {isGallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : (
        <App />
      )}
    </AppErrorBoundary>
  </StrictMode>,
);
