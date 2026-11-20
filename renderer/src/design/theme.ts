import { useSyncExternalStore } from 'react';
import { themes, type ThemeName, type ThemeTokens } from './tokens';

export type ThemePreference = ThemeName | 'system';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The theme actually in effect: `<html data-theme>` wins, otherwise the OS preference.
 * Mirrors the selectors in tokens.css exactly, so Plotly/Three match the CSS.
 */
export function resolveTheme(doc: Document | undefined = globalThis.document): ThemeName {
  const forced = doc?.documentElement.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') return forced;
  const mq = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(DARK_QUERY) : null;
  return mq?.matches ? 'dark' : 'light';
}

/** Force a theme (`light` / `dark`) or follow the OS (`system`). */
export function setThemePreference(pref: ThemePreference, doc: Document = document): void {
  if (pref === 'system') doc.documentElement.removeAttribute('data-theme');
  else doc.documentElement.setAttribute('data-theme', pref);
}

function subscribe(onChange: () => void): () => void {
  const mq = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(DARK_QUERY) : null;
  mq?.addEventListener?.('change', onChange);
  const mo =
    typeof MutationObserver === 'function' && typeof document !== 'undefined'
      ? new MutationObserver(onChange)
      : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    mq?.removeEventListener?.('change', onChange);
    mo?.disconnect();
  };
}

/** React hook: the resolved theme name, re-rendering when the OS or `data-theme` changes. */
export function useResolvedTheme(): ThemeName {
  return useSyncExternalStore(subscribe, () => resolveTheme(), () => 'light');
}

/** React hook: the token object for the resolved theme (for Plotly / Three). */
export function useThemeTokens(): ThemeTokens {
  return themes[useResolvedTheme()];
}
