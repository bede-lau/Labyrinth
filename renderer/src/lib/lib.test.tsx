import { renderHook, waitFor } from '@testing-library/react';
import { fetchArtifact, useArtifact, artifactUrl } from './artifacts';
import { fetchLiveStatus, isLive, useLiveStatus } from './liveStatus';

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const fail = (status: number) => (async () => new Response('nope', { status })) as unknown as typeof fetch;

test('artifactUrl points at /artifacts/<id>.json', () => {
  expect(artifactUrl('geometry')).toBe('/artifacts/geometry.json');
});

test('fetchArtifact rejects wrong schemaVersion and HTTP errors with the file name', async () => {
  await expect(fetchArtifact('budget', ok({ schemaVersion: 2 }))).rejects.toThrow(/budget\.json.*schemaVersion/);
  await expect(fetchArtifact('budget', fail(404))).rejects.toThrow(/budget\.json: HTTP 404/);
  await expect(fetchArtifact('budget', ok({ schemaVersion: 1, x: 1 }))).resolves.toEqual({ schemaVersion: 1, x: 1 });
});

test('useArtifact goes loading -> error naming the file (never blank)', async () => {
  const f = fail(500);
  const { result } = renderHook(() => useArtifact('spatial', f));
  expect(result.current.status).toBe('loading');
  await waitFor(() => expect(result.current).toMatchObject({ status: 'error', file: 'artifacts/spatial.json' }));
});

test('live status: unreachable backend is not live; only mode=live is live', async () => {
  const f = fail(502);
  const { result } = renderHook(() => useLiveStatus(60_000, f));
  await waitFor(() => expect(result.current.status).toBe('unreachable'));
  expect(isLive(result.current)).toBe(false);
  const base = { schemaVersion: 1, reason: '', budget: { ceilingUsd: 40, billedUsd: 0, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true }, workers: [], fallback: { active: false, label: '', savedRunId: null } };
  expect(isLive({ status: 'ready', data: { ...base, mode: 'fallback' } as never })).toBe(false);
  expect(isLive({ status: 'ready', data: { ...base, mode: 'live' } as never })).toBe(true);
  await expect(fetchLiveStatus(ok({ nope: 1 }))).rejects.toThrow(/bad payload/);
});
