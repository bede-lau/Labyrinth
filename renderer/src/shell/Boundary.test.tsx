// Task 09 finding 2: nothing above the views may blank the page. The live-session alert sits inside
// HeaderBoundary; main.tsx wraps the whole app in AppErrorBoundary.
import { render, screen, within } from '@testing-library/react';
import { App } from './App';
import { AppErrorBoundary, HeaderBoundary } from './Boundary';
import { ROUTES } from './routes';

const broken = vi.hoisted(() => ({ alert: false }));
vi.mock('./ModeIndicator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ModeIndicator')>();
  return {
    ...real,
    ModeAlert: (props: Parameters<typeof real.ModeAlert>[0]) => {
      if (broken.alert) throw new Error('danger text could not be built');
      return <real.ModeAlert {...props} />;
    },
  };
});
vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => <p>view:locate</p> }));
vi.mock('../features/forecast/ForecastView', () => ({ ForecastView: () => <p>view:forecast</p> }));
vi.mock('../features/spatial/SpatialView', () => ({ SpatialView: () => <p>view:spatial</p> }));
vi.mock('../features/heatfield/HeatFieldView', () => ({ HeatFieldView: () => <p>view:heat</p> }));

beforeEach(() => {
  history.replaceState(null, '', '/');
  broken.alert = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

test('a crash in the live-session alert is itself reported as an alert, never swallowed', () => {
  broken.alert = true;
  render(<App pollMs={60_000} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('The live-session alert failed to render (danger text could not be built)');
  expect(alert).toHaveTextContent('Treat the live session state as unknown');
  expect(alert.querySelector('[data-status="failed"]')).not.toBeNull();
  expect(document.querySelector('[data-status="live"]')).toBeNull();
  // Everything else is still on the page.
  expect(screen.getByText('view:locate')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('W7-X Model');
  expect(within(screen.getByRole('navigation', { name: 'Views' })).getAllByRole('link')).toHaveLength(ROUTES.length);
  expect(screen.getByRole('radiogroup', { name: 'Colour theme' })).toBeInTheDocument();
});

test('HeaderBoundary tries again when its resetKey changes (the next status poll), and stays quiet when nothing fails', () => {
  const { rerender } = render(
    <HeaderBoundary what="mode indicator" resetKey={1}>
      <Boom message="first status was bad" />
    </HeaderBoundary>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('first status was bad');
  // Same key: still the fallback (no render loop).
  rerender(
    <HeaderBoundary what="mode indicator" resetKey={1}>
      <p>mode ok</p>
    </HeaderBoundary>,
  );
  expect(screen.getByRole('alert')).toBeInTheDocument();
  rerender(
    <HeaderBoundary what="mode indicator" resetKey={2}>
      <p>mode ok</p>
    </HeaderBoundary>,
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('mode ok')).toBeInTheDocument();
});

test('AppErrorBoundary: an error above the views shows a message with the cause instead of an empty page', () => {
  const { container } = render(
    <AppErrorBoundary>
      <Boom message="shell exploded" />
    </AppErrorBoundary>,
  );
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('The app could not be displayed');
  expect(alert).toHaveTextContent('shell exploded');
  expect(alert).toHaveTextContent('treat its state as unknown');
  expect(within(alert).getByRole('button', { name: 'Reload the page' })).toBeEnabled();
  expect(container).not.toBeEmptyDOMElement();
  // And it is transparent when nothing fails.
  render(
    <AppErrorBoundary>
      <p>fine</p>
    </AppErrorBoundary>,
  );
  expect(screen.getByText('fine')).toBeInTheDocument();
});
