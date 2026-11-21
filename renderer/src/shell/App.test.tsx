import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { ROUTES } from './routes';

vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => <p>geometry</p> }));
vi.mock('../features/forecast/ForecastView', () => ({ ForecastView: () => <p>forecast</p> }));
vi.mock('../features/spatial/SpatialView', () => ({ SpatialView: () => <p>spatial</p> }));
beforeEach(() => {
  history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 404})));
});
afterEach(() => vi.unstubAllGlobals());

test.each(['advance', 'transport', 'budget', 'unknown'])('retired or unknown route %s opens geometry', async route => {
  history.replaceState(null, '', '#/' + route);
  render(<App />);
  await waitFor(() => expect(location.hash).toBe('#/locate'));
  expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Locate the tubes');
  expect(screen.queryByRole('contentinfo')).toBeNull();
  expect(screen.queryByText('Replay · $0')).toBeNull();
});

test('three keyboard-accessible views, current page and route announcements', async () => {
  const user = userEvent.setup();
  render(<App />);
  const links = within(screen.getByRole('navigation', {name: 'Views'})).getAllByRole('link');
  expect(links.map(a => a.textContent)).toEqual(['Locate the tubes', 'Forecast replay', 'Spatial parallelism']);
  for (const [i, route] of ROUTES.entries()) {
    links[i]!.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(links[i]).toHaveAttribute('aria-current', 'page'));
    expect(links[i]).toHaveFocus();
    expect(screen.getByRole('main')).toHaveAccessibleName(route.label);
  }
  screen.getByRole('main').focus();
  act(() => { location.hash = '#/forecast'; });
  await waitFor(() => expect(screen.getByTestId('route-announcer')).toHaveTextContent('Forecast replay view'));
  expect(screen.getByRole('main')).toHaveFocus();
});
