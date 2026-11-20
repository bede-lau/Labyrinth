// Typed artifact loader. The ONLY way renderer code reads main/'s output:
// fetch('/artifacts/<id>.json') — served by vite in dev, copied into dist/ for static replay.
// Feature folders define the TS types of their own artifact (mirroring contracts/*.schema.json).
import { useEffect, useState } from 'react';

export type ArtifactId = 'geometry' | 'transport' | 'forecast' | 'budget' | 'spatial';

export type ArtifactState<T> =
  | { status: 'loading' }
  | { status: 'error'; file: string; message: string }
  | { status: 'ready'; data: T };

export function artifactUrl(id: ArtifactId): string {
  return `/artifacts/${id}.json`;
}

export async function fetchArtifact<T>(id: ArtifactId, fetchImpl: typeof fetch = fetch): Promise<T> {
  const url = artifactUrl(id);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null || (body as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error(`${url}: unexpected schemaVersion (expected 1)`);
  }
  return body as T;
}

/** React hook: never returns a blank state — loading, a named error, or data. */
export function useArtifact<T>(id: ArtifactId, fetchImpl: typeof fetch = fetch): ArtifactState<T> {
  const [state, setState] = useState<ArtifactState<T>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetchArtifact<T>(id, fetchImpl).then(
      (data) => alive && setState({ status: 'ready', data }),
      (err: unknown) =>
        alive && setState({ status: 'error', file: `artifacts/${id}.json`, message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
  }, [id, fetchImpl]);
  return state;
}
