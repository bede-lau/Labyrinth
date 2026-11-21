// Task 09 finding 2: nothing in the header may blank the page. The mode indicator and the live-session
// alert sit inside HeaderBoundary; main.tsx wraps the whole app in AppErrorBoundary.
import { render, screen, within } from '@testing-library/react';
import { App } from './App';
import { AppErrorBoundary, HeaderBoundary } from './Boundary';

const broken = vi.hoisted(() => ({ indicator: false, alert: false }));
vi.mock('./ModeIndicator', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ModeIndicator')>();
  return {
    ...real,
    ModeIndicator: (props: Parameters<typeof real.ModeIndicator>[0]) => {
      if (broken.indicator) throw new Error("Cannot read properties of undefined (reading 'label')");
      return <real.ModeIndicator {...props} />;
    },
    ModeAlert: (props: Parameters<typeof real.ModeAlert>[0]) => {
      if (broken.alert) throw new Error('danger text could not be built');
      return <real.ModeAlert {...props} />;
    },
  };
});
vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => <p>view:locate</p> }));
vi.mock('../features/live-gx/LiveView', () => ({ LiveView: () => <p>view:advance</p> }));
vi.mock('../features/transport/TransportView', () => ({ TransportView: () => <p>view:transport</p> }));
vi.mock('../features/forecast/ForecastView', () => ({ ForecastView: () => <p>view:forecast</p> }));
vi.mock('../features/spatial/SpatialView', () => ({ SpatialView: () => <p>view:spatial</p> }));
vi.mock('../features/budget/BudgetView', () => ({ BudgetView: () => <p>view:budget</p> }));

beforeEach(() => {
  history.replaceState(null, '', '/');
  broken.indicator = false;
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
  expect(screen.getByText('view:locate')).toBeInTheDocument();
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
