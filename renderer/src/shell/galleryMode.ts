// `#gallery` (the design-system review page) is chosen once at load in main.tsx, outside the hash
// router. This keeps the page and the URL in step afterwards: when the hash enters or leaves
// `#gallery` (Back, Forward, an edited URL) the page reloads, so the right root is mounted.
export const GALLERY_HASH = '#gallery';

export function isGalleryHash(hash: string): boolean {
  return hash === GALLERY_HASH;
}

/** Returns a function that removes the listener. `reload` is injected so it can be tested. */
export function watchGalleryHash(
  showingGallery: boolean,
  reload: () => void,
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'location'> = window,
): () => void {
  const onHashChange = () => {
    if (isGalleryHash(win.location.hash) !== showingGallery) reload();
  };
  win.addEventListener('hashchange', onHashChange);
  return () => win.removeEventListener('hashchange', onHashChange);
}
