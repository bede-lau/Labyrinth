import { render, screen, waitFor } from '@testing-library/react';
import { useArtifact } from '../lib/artifacts';
import { ArtifactGate, ViewErrorBoundary } from './ArtifactGate';

function Probe({ fetchImpl, validate }: { fetchImpl: typeof fetch; validate?: (d: { x?: number }) => string | null }) {
  const state = useArtifact<{ x?: number }>('spatial', fetchImpl);
  return (
    <ArtifactGate state={state} view="Spatial parallelism" file="artifacts/spatial.json" validate={validate}>
      {(d) => <p>data x={d.x}</p>}
    </ArtifactGate>
  );
}
const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

function Boom(): never {
  throw new Error('tubes[0].samples is undefined');
}

test('A3 artifact loading/error/data states: missing or invalid artifacts name the file, never blank', async () => {
  // loading -> data
  const ok = render(<Probe fetchImpl={respond(JSON.stringify({ schemaVersion: 1, x: 7 }))} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading artifacts/spatial.json');
  await waitFor(() => expect(screen.getByText('data x=7')).toBeInTheDocument());
  ok.unmount();

  // missing (HTTP 404)
  const missing = render(<Probe fetchImpl={respond('nope', 404)} />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Could not load artifacts/spatial.json' })).toBeInTheDocument());
  expect(screen.getByRole('note')).toHaveTextContent('artifacts/spatial.json is missing or invalid');
  expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
  expect(screen.getByText(/build_artifacts/)).toBeInTheDocument();
  missing.unmount();

  // invalid: wrong schemaVersion, then not JSON at all
  const wrong = render(<Probe fetchImpl={respond(JSON.stringify({ schemaVersion: 2 }))} />);
  await waitFor(() => expect(screen.getByText(/unexpected schemaVersion/)).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: /artifacts\/spatial\.json/ })).toBeInTheDocument();
  wrong.unmount();
  const garbage = render(<Probe fetchImpl={respond('<html>')} />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Could not load artifacts/spatial.json' })).toBeInTheDocument());
  garbage.unmount();

  // invalid shape caught by the view's structural check
  const shape = render(<Probe fetchImpl={respond(JSON.stringify({ schemaVersion: 1 }))} validate={(d) => (d.x === undefined ? 'x missing' : null)} />);
  await waitFor(() => expect(screen.getByText('artifacts/spatial.json: x missing')).toBeInTheDocument());
  shape.unmount();

  // a view that throws while rendering is caught and the file is named
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ViewErrorBoundary view="Locate the tubes" files={['artifacts/geometry.json']}>
      <Boom />
    </ViewErrorBoundary>,
  );
  expect(screen.getByRole('heading', { name: 'Could not load artifacts/geometry.json' })).toBeInTheDocument();
  expect(screen.getByText('tubes[0].samples is undefined')).toBeInTheDocument();
  warn.mockRestore();
  err.mockRestore();
});
