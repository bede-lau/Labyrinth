import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationView } from './ValidationView';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn() }));
vi.mock('plotly.js-dist-min', () => ({ default: plotly }));

// The committed artifacts are the fixtures (read from disk, served through a stubbed fetch).
const read = (name: string) => readFileSync(resolve(__dirname, `../../../../artifacts/${name}.json`), 'utf8');
const FILES: Record<string, string> = {
  '/artifacts/geometry.json': read('geometry'),
  '/artifacts/transport.json': read('transport'),
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const body = FILES[String(input)];
    return body ? new Response(body, { status: 200 }) : new Response('down', { status: 502 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

test('the Validation route shows the tracer-vs-stella checks and the transport verdict from the committed artifacts', async () => {
  render(<ValidationView />);
  // Geometry: both tracer checks, read from geometry.json.
  expect(await screen.findByRole('heading', { name: 'Validation' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Tracer vs stella saved geometry/ })).toBeInTheDocument();
  expect(screen.getByText(/All 25 saved samples agree to their printed 4 significant figures/)).toBeInTheDocument();
  // Transport: the verdict panel and the claim gate, read from transport.json.
  expect(await screen.findByRole('heading', { name: 'Verdict: what the archived evidence supports' })).toBeInTheDocument();
  expect(screen.getAllByText('Saturated claim: not allowed').length).toBeGreaterThan(0);
});

test('a missing geometry artifact is a named error and the transport evidence still renders', async () => {
  delete FILES['/artifacts/geometry.json'];
  try {
    render(<ValidationView />);
    expect(await screen.findByRole('heading', { name: 'Verdict: what the archived evidence supports' })).toBeInTheDocument();
    expect((await screen.findAllByText(/artifacts\/geometry\.json/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: /Tracer vs stella saved geometry/ })).toBeNull();
  } finally {
    FILES['/artifacts/geometry.json'] = read('geometry');
  }
});
