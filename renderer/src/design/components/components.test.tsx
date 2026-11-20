// D5: every primitive renders with the right roles, names and keyboard behaviour.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { FixtureCheckData, Provenance } from '../types';
import { STATUS_KINDS } from '../tokens';
import { Callout } from './Callout';
import { FixtureCheck, fixtureOutcome } from './FixtureCheck';
import { Panel } from './Panel';
import { ProvenanceBadge } from './ProvenanceBadge';
import { SegmentedControl } from './SegmentedControl';
import { Stat } from './Stat';
import { StatusPill } from './StatusPill';

const provenance: Provenance = {
  kind: 'archive',
  solverRevision: 'stella 6f60964d',
  units: 'ion gyro-Bohm (Q_gB), t in a/v_th,i',
  coverage: { description: 'bean tube, full trace', tStart: 0, tEnd: 1900 },
  runtime: '161 h on 288 processors',
  verification: { outcome: 'passed', details: 'sha256 matches pinned copy.' },
  sources: [
    {
      label: 'Public trace archive',
      url: 'https://github.com/stellaGK/stella/blob/6f60964d/x.h5',
      sha256: 'a'.repeat(64),
      path: 'data/raw/benchmark.h5',
    },
  ],
};

describe('Panel', () => {
  test('is a region named by its heading, with eyebrow, subtitle, status, actions and footer', () => {
    render(
      <Panel
        eyebrow="Check transport"
        title="Bean ion heat flux"
        subtitle="stella and GENE archives"
        status={<StatusPill status="replay" />}
        actions={<button type="button">Export</button>}
        footer="Source: public trace archive"
        headingLevel={3}
      >
        <p>body</p>
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Bean ion heat flux' });
    expect(within(region).getByRole('heading', { level: 3, name: 'Bean ion heat flux' })).toBeInTheDocument();
    expect(within(region).getByText('Check transport')).toBeInTheDocument();
    expect(within(region).getByText('stella and GENE archives')).toBeInTheDocument();
    expect(within(region).getByText('Replay')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(within(region).getByRole('contentinfo')).toHaveTextContent('Source: public trace archive');
  });
});

describe('Stat', () => {
  test('value + uncertainty + unit + window, tabular, with a full spoken name', () => {
    render(
      <Stat
        label="stella mean"
        value={2.2421}
        decimals={3}
        uncertainty={0.0314}
        unit="Q_gB"
        window={[1500, 1900]}
        windowUnit="a/v_{th,i}"
      />,
    );
    const g = screen.getByRole('group', {
      name: 'stella mean: 2.242 plus or minus 0.031 Q gB, window t 1500 to 1900 a/v th,i',
    });
    expect(g).toHaveTextContent('2.242');
    expect(g).toHaveTextContent('±0.031');
    expect(g.querySelector('.lab-stat__number')).toHaveClass('lab-num');
    expect(g.querySelector('sub')).toHaveTextContent('gB');
    expect(g).toHaveTextContent('1500–1900');
  });
  test('null value says "not available" — never renders 0', () => {
    render(<Stat label="GX mean" value={null} decimals={2} unit="Q_gB" note="No live run yet" />);
    const g = screen.getByRole('group', { name: 'GX mean: not available' });
    expect(g).toHaveTextContent('—');
    expect(g).toHaveTextContent('not available');
    expect(g).not.toHaveTextContent('0.00');
    expect(g).toHaveTextContent('No live run yet');
  });
  test('negative values use a true minus sign', () => {
    render(<Stat label="Δ" value={-0.5} decimals={2} unit="dimensionless" />);
    expect(screen.getByRole('group', { name: 'Δ: minus 0.50' })).toHaveTextContent('−0.50');
  });
});

describe('StatusPill', () => {
  test.each(STATUS_KINDS)('%s renders visible text and an aria-hidden glyph (not colour alone)', (s) => {
    const { container } = render(<StatusPill status={s} />);
    const pill = container.querySelector('.lab-pill') as HTMLElement;
    expect(pill.dataset.status).toBe(s);
    expect(pill.textContent?.trim().length).toBeGreaterThan(0);
    const glyph = pill.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
  });
  test('live is distinct: its own dot, not an icon, and the text "Live"', () => {
    const { container } = render(<StatusPill status="live" />);
    expect(container.querySelector('.lab-pill__dot')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
  test('replay never looks like live', () => {
    const { container } = render(<StatusPill status="replay" />);
    expect(container.querySelector('.lab-pill__dot')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('data-icon')).toBe('replay');
  });
});

describe('ProvenanceBadge', () => {
  test('collapsed: a disclosure button naming kind and verification', () => {
    render(<ProvenanceBadge provenance={provenance} subject="stella trace" />);
    const btn = screen.getByRole('button', { name: 'Provenance of stella trace: Archive, Verified' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('stella 6f60964d')).not.toBeVisible();
  });
  test('expands to list solverRevision, units, coverage, runtime, verification and sources', async () => {
    const user = userEvent.setup();
    render(<ProvenanceBadge provenance={provenance} />);
    const btn = screen.getByRole('button', { name: /provenance/i });
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByRole('region', { name: /details/ });
    expect(btn.getAttribute('aria-controls')).toBe(detail.id);
    for (const term of ['Solver revision', 'Units', 'Coverage', 'Runtime', 'Verification', 'Sources'])
      expect(within(detail).getByText(term).tagName).toBe('DT');
    expect(detail).toHaveTextContent('stella 6f60964d');
    expect(detail).toHaveTextContent('ion gyro-Bohm');
    expect(detail).toHaveTextContent('bean tube, full trace (t 0–1900)');
    expect(detail).toHaveTextContent('161 h on 288 processors');
    expect(detail).toHaveTextContent('sha256 matches pinned copy.');
    const link = within(detail).getByRole('link', { name: /public trace archive/i });
    expect(link).toHaveAttribute('href', provenance.sources[0]?.url);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(detail).toHaveTextContent('sha256 aaaaaaaaaa…');
  });
  test('Escape closes and returns focus to the button', async () => {
    const user = userEvent.setup();
    render(<ProvenanceBadge provenance={provenance} defaultOpen />);
    const btn = screen.getByRole('button', { name: /provenance/i });
    await user.click(within(screen.getByRole('region', { name: /details/ })).getByRole('link'));
    await user.keyboard('{Escape}');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveFocus();
  });
  test('prd-reported + blocked are shown as such', () => {
    render(
      <ProvenanceBadge
        provenance={{ ...provenance, kind: 'prd-reported', verification: { outcome: 'blocked', details: 'no data' }, sources: [] }}
      />,
    );
    expect(screen.getByRole('button', { name: /PRD-reported, Blocked/ })).toBeInTheDocument();
  });
});

const fx = (o: Partial<FixtureCheckData>): FixtureCheckData => ({
  id: 'gene-300-400',
  label: 'GENE mean, 300–400',
  claimed: 2.68,
  computed: 2.674,
  printedDecimals: 2,
  matches: false,
  ...o,
});

describe('FixtureCheck', () => {
  test('mismatch: claimed vs computed at printed precision, Δ, ✗ and the word "Mismatch"', () => {
    render(<FixtureCheck fixture={fx({})} unit="Q_gB" />);
    const g = screen.getByRole('group', {
      name: 'GENE mean, 300–400: Mismatch. Claimed 2.68 Q gB, computed 2.67 Q gB, difference minus 0.01',
    });
    expect(g).toHaveAttribute('data-outcome', 'mismatch');
    expect(within(g).getByTestId('claimed')).toHaveTextContent('2.68');
    expect(within(g).getByTestId('computed')).toHaveTextContent('2.67');
    expect(g).toHaveTextContent('−0.01');
    expect(within(g).getByText('Mismatch')).toBeVisible();
    expect(g.querySelector('[data-icon="cross"]')).not.toBeNull();
  });
  test('match shows ✓ and "Match"', () => {
    render(<FixtureCheck fixture={fx({ label: 'stella 300–400', claimed: 2.55, computed: 2.552, matches: true })} />);
    const g = screen.getByRole('group', { name: /stella 300–400: Match\./ });
    expect(g).toHaveAttribute('data-outcome', 'match');
    expect(within(g).getByText('Match')).toBeInTheDocument();
    expect(g.querySelector('[data-icon="check"]')).not.toBeNull();
  });
  test('not recomputable shows — and says so', () => {
    render(<FixtureCheck fixture={fx({ label: '129 stella samples', computed: null, matches: null })} />);
    const g = screen.getByRole('group', { name: /129 stella samples: Not recomputable\..*computed value not available/ });
    expect(within(g).getByTestId('computed')).toHaveTextContent('—');
    expect(g.querySelector('[data-icon="dash"]')).not.toBeNull();
  });
  test('mismatch is distinguishable from match by text, icon and attribute — not only colour', () => {
    const { container } = render(
      <>
        <FixtureCheck fixture={fx({})} />
        <FixtureCheck fixture={fx({ computed: 2.68, matches: true })} />
      </>,
    );
    const [mis, ok] = Array.from(container.querySelectorAll('.lab-fixture')) as HTMLElement[];
    expect(mis?.textContent).not.toBe(ok?.textContent);
    expect(mis?.querySelector('.lab-fixture__outcome-text')?.textContent).toBe('Mismatch');
    expect(ok?.querySelector('.lab-fixture__outcome-text')?.textContent).toBe('Match');
  });
  test('a "matches: true" flag that disagrees with the printed values is shown as a mismatch', () => {
    expect(fixtureOutcome(fx({ matches: true }))).toEqual({ outcome: 'mismatch', inconsistent: true });
    render(<FixtureCheck fixture={fx({ matches: true })} />);
    expect(screen.getByText(/flag disagrees/)).toBeInTheDocument();
  });
});

function Seg({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState<'bean' | 'triangular' | 'both' | 'none'>('bean');
  return (
    <SegmentedControl
      label="Field line"
      value={v}
      onChange={(n) => {
        setV(n);
        onChange?.(n);
      }}
      options={[
        { value: 'bean', label: 'Bean' },
        { value: 'triangular', label: 'Triangular' },
        { value: 'none', label: 'None', disabled: true },
        { value: 'both', label: 'Both' },
      ]}
    />
  );
}

describe('SegmentedControl', () => {
  test('radiogroup semantics with one tab stop on the checked radio', () => {
    render(<Seg />);
    const group = screen.getByRole('radiogroup', { name: 'Field line' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Bean' })).toHaveAttribute('aria-checked', 'true');
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });
  test('arrow keys move focus and selection, skip disabled, wrap; Home/End jump', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Seg onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Bean' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Triangular' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Triangular' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}'); // skips disabled "None"
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveFocus();
    await user.keyboard('{ArrowRight}'); // wraps
    expect(screen.getByRole('radio', { name: 'Bean' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Bean' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['triangular', 'both', 'bean', 'both', 'bean', 'both']);
    expect(screen.getByRole('radio', { name: 'None' })).toBeDisabled();
  });
  test('click selects', async () => {
    const user = userEvent.setup();
    render(<Seg />);
    await user.click(screen.getByRole('radio', { name: 'Triangular' }));
    expect(screen.getByRole('radio', { name: 'Triangular' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Bean' })).toHaveAttribute('tabindex', '-1');
  });
});

describe('Callout', () => {
  test.each([
    ['info', 'Note'],
    ['warn', 'Warning'],
    ['blocked', 'Blocked'],
  ] as const)('%s is a note whose name speaks the tone (%s)', (tone, spoken) => {
    render(
      <Callout tone={tone} title="129 stella samples not in repo" action={<a href="#d-007">D-007</a>}>
        Provide the stella geometry file to unblock.
      </Callout>,
    );
    const note = screen.getByRole('note', { name: `${spoken}: 129 stella samples not in repo` });
    expect(note).toHaveAttribute('data-tone', tone);
    expect(note).toHaveTextContent('Provide the stella geometry file to unblock.');
    expect(within(note).getByRole('link', { name: 'D-007' })).toBeInTheDocument();
    expect(note.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

test('act is available (keeps React 19 test env honest)', () => {
  expect(typeof act).toBe('function');
});
