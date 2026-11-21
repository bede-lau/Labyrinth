// Task 09 finding 2: nothing in the header may blank the page. The mode indicator and the live-session
// alert sit inside HeaderBoundary; main.tsx wraps the whole app in AppErrorBoundary.
import { render, screen, within } from '@testing-library/react';
import { App, DECISION_QUESTION } from './App';
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
vi.mock('../features/heatfield/HeatFieldView', () => ({ HeatFieldView: () => <p>view:heat</p> }));

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

test('a crash in the mode indicator leaves the page up and says, as an alert, that the session state is unknown', () => {
  broken.indicator = true;
  render(<App pollMs={60_000} />);
  const header = screen.getByRole('banner');
  const alert = within(header).getByRole('alert');
  expect(alert).toHaveTextContent('Mode unknown');
  expect(alert).toHaveTextContent("The mode indicator failed to render (Cannot read properties of undefined (reading 'label'))");
  expect(alert).toHaveTextContent('Treat the live session state as unknown');
  expect(alert.querySelector('[data-status="failed"]')).not.toBeNull();
  expect(header.querySelector('[data-status="live"]')).toBeNull();
  // Everything else is still on the page.
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(DECISION_QUESTION);
  expect(within(screen.getByRole('navigation', { name: 'Views' })).getAllByRole('link')).toHaveLength(7);
  expect(screen.getByText('view:locate')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Provenance legend' })).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: 'Colour theme' })).toBeInTheDocument();
});

test('a crash in the live-session alert is itself reported as an alert, never swallowed', () => {
  broken.alert = true;
  render(<App pollMs={60_000} />);
  const alert = within(screen.getByRole('banner')).getByRole('alert');
  expect(alert).toHaveTextContent('The live-session alert failed to render (danger text could not be built)');
  expect(screen.getByRole('status', { name: /^Mode: Replay · \$0/ })).toBeInTheDocument(); // the indicator itself still works
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
