// @vitest-environment node
// Task 09 finding 9 (gallery stays on screen after Back) and DS-5 (nav scroll geometry).
import { GALLERY_HASH, isGalleryHash, watchGalleryHash } from './galleryMode';
import { centeredScrollLeft, fadeEdges } from './navScroll';

/** A window stand-in: real hashchange events, a settable hash, and a reload spy (jsdom cannot reload). */
function fakeWindow(showingGallery: boolean, hash: string) {
  const win = Object.assign(new EventTarget(), { location: { hash } });
  const reload = vi.fn();
  const stop = watchGalleryHash(showingGallery, reload, win as unknown as Window);
  const go = (next: string) => {
    win.location.hash = next;
    win.dispatchEvent(new Event('hashchange'));
  };
  return { reload, stop, go };
}

test('the gallery watcher reloads when the hash enters or leaves #gallery, and only then', () => {
  expect(GALLERY_HASH).toBe('#gallery');
  expect(isGalleryHash('#gallery')).toBe(true);
  for (const hash of ['', '#', '#/gallery', '#gallery/', '#Gallery', '#/locate']) expect(isGalleryHash(hash)).toBe(false);

  // The app is on screen.
  const app = fakeWindow(false, '#/spatial');
  app.go('#/budget');
  app.go('#/nope');
  expect(app.reload).not.toHaveBeenCalled(); // ordinary route changes are the router's business
  app.go('#gallery');
  expect(app.reload).toHaveBeenCalledTimes(1); // entering
  app.stop();
  app.go('#/locate');
  app.go('#gallery');
  expect(app.reload).toHaveBeenCalledTimes(1); // no listener left behind

  // The gallery is on screen (opened at load). Back to a view must reload: it used to stay on screen.
  const gallery = fakeWindow(true, '#gallery');
  gallery.go('#gallery');
  expect(gallery.reload).not.toHaveBeenCalled();
  gallery.go('#/spatial');
  expect(gallery.reload).toHaveBeenCalledTimes(1);
  gallery.stop();
});

test('nav scroll geometry: the active tab is centred, clamped to the ends, and hidden edges are named', () => {
  // 390 px window over 732 px of tabs, 122 px each.
  expect(centeredScrollLeft(390, 732, 0, 122)).toBe(0); // first tab: cannot scroll before the start
  expect(centeredScrollLeft(390, 732, 244, 122)).toBe(110); // third tab centred: 244 − (390 − 122) / 2
  expect(centeredScrollLeft(390, 732, 366, 122)).toBe(232);
  expect(centeredScrollLeft(390, 732, 610, 122)).toBe(342); // last tab: clamped to the end (732 − 390)
  expect(centeredScrollLeft(1440, 732, 610, 122)).toBe(0); // everything fits: never scrolls
  expect(centeredScrollLeft(390, 732, 300.4, 121.3)).toBe(166); // sub-pixel boxes give a whole-pixel scroll (166.05)

  expect(fadeEdges(0, 390, 732)).toBe('end');
  expect(fadeEdges(110, 390, 732)).toBe('both');
  expect(fadeEdges(342, 390, 732)).toBe('start');
  expect(fadeEdges(341.5, 390, 732)).toBe('start'); // sub-pixel rounding at the end is not "more to the right"
  expect(fadeEdges(0.5, 390, 732)).toBe('end');
  expect(fadeEdges(0, 1440, 732)).toBe('none'); // nothing hidden on a wide screen
  expect(fadeEdges(0, 0, 0)).toBe('none'); // no layout (jsdom)
});
