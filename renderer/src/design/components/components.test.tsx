// D5: every primitive renders with the right roles, names and keyboard behaviour.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CALLOUT_META, STATUS_META, VERIFICATION_STATUS, provenanceStatus } from '../status';
import type { FixtureCheckData, Provenance } from '../types';
import { CALLOUT_TONES, STATUS_KINDS, type StatusKind } from '../tokens';
import { Callout } from './Callout';
import { FixtureCheck, fixtureOutcome } from './FixtureCheck';
import { Icon, type IconName } from './Icon';
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
  test('the uncertainty and the window are tabular too, so ±σ digits line up under each other (F12)', () => {
    render(<Stat label="stella mean" value={2.2421} decimals={3} uncertainty={0.0314} unit="Q_gB" window={[1500, 1900]} />);
    const g = screen.getByRole('group', { name: /^stella mean/ });
    const pm = g.querySelector('.lab-stat__pm');
    expect(pm).toHaveTextContent('±0.031');
    expect(pm).toHaveClass('lab-num');
    expect(g.querySelector('.lab-stat__window')).toHaveClass('lab-num');
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

// Verifier finding F2: "never colour alone" has to fail when two kinds share a label or an icon
// (mutations M15: failed -> "Verified" + check; M15b: failed keeps its label, takes the check icon).
describe('status semantics: every kind is told apart without colour (F2)', () => {
  const PINNED: Record<StatusKind, { label: string; icon: IconName }> = {
    live: { label: 'Live', icon: 'live' },
    replay: { label: 'Replay', icon: 'replay' },
    rehearsal: { label: 'Rehearsal', icon: 'rehearsal' },
    archive: { label: 'Archive', icon: 'archive' },
    derived: { label: 'Derived', icon: 'derived' },
    'prd-reported': { label: 'PRD-reported', icon: 'quote' },
    unverified: { label: 'Unverified', icon: 'question' },
    passed: { label: 'Verified', icon: 'check' },
    failed: { label: 'Failed', icon: 'alert' },
    blocked: { label: 'Blocked', icon: 'blocked' },
    mismatch: { label: 'Mismatch', icon: 'cross' },
    'not-applicable': { label: 'Not applicable', icon: 'dash' },
  };
  const drawn = (el: Element | null) => el?.innerHTML ?? '';

  test('no two kinds share a label, and no two share an icon', () => {
    const labels = STATUS_KINDS.map((k) => STATUS_META[k].label.trim().toLowerCase());
    const icons = STATUS_KINDS.map((k) => STATUS_META[k].icon);
    expect(labels.filter((l, i) => labels.indexOf(l) !== i), 'duplicate labels').toEqual([]);
    expect(icons.filter((c, i) => icons.indexOf(c) !== i), 'duplicate icons').toEqual([]);
  });
  test.each(STATUS_KINDS)('%s keeps its pinned label and icon', (k) => {
    expect({ label: STATUS_META[k].label, icon: STATUS_META[k].icon }).toEqual(PINNED[k]);
  });
  test('rendered pills: twelve different texts and twelve different glyph drawings', () => {
    const seen = STATUS_KINDS.map((k) => {
      const { container, unmount } = render(<StatusPill status={k} />);
      const pill = container.querySelector('.lab-pill') as HTMLElement;
      const out = {
        kind: k,
        text: pill.querySelector('.lab-pill__text')?.textContent ?? '',
        glyph: pill.querySelector('.lab-pill__dot') ? 'dot' : drawn(pill.querySelector('svg')),
        icon: pill.querySelector('svg')?.getAttribute('data-icon') ?? 'dot',
      };
      unmount();
      return out;
    });
    expect(new Set(seen.map((s) => s.text)).size).toBe(STATUS_KINDS.length);
    expect(new Set(seen.map((s) => s.glyph)).size).toBe(STATUS_KINDS.length);
    for (const s of seen) {
      expect(s.text).toBe(PINNED[s.kind].label);
      expect(s.icon).toBe(s.kind === 'live' ? 'dot' : PINNED[s.kind].icon);
    }
  });
  test('every icon name draws a different shape (a renamed copy of another icon would not count)', () => {
    const names = [...new Set([...STATUS_KINDS.map((k) => STATUS_META[k].icon), ...CALLOUT_TONES.map((t) => CALLOUT_META[t].icon), 'equals', 'chevron', 'external'])] as IconName[];
    const drawings = names.map((n) => {
      const { container, unmount } = render(<Icon name={n} />);
      const d = drawn(container.querySelector('svg'));
      unmount();
      return d;
    });
    expect(drawings.every((d) => d.length > 0)).toBe(true);
    expect(new Set(drawings).size).toBe(names.length);
  });
  test('callout tones: three icons, three spoken prefixes', () => {
    expect(new Set(CALLOUT_TONES.map((t) => CALLOUT_META[t].icon)).size).toBe(CALLOUT_TONES.length);
    expect(CALLOUT_TONES.map((t) => CALLOUT_META[t].spoken)).toEqual(['Note', 'Warning', 'Blocked']);
  });
  test('verification outcomes map to their own status', () => {
    expect(VERIFICATION_STATUS).toEqual({ passed: 'passed', failed: 'failed', blocked: 'blocked', 'not-applicable': 'not-applicable' });
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
  test('a click outside closes the card and leaves focus where the user clicked (F12, F10)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ProvenanceBadge provenance={provenance} defaultOpen />
        <button type="button">Elsewhere</button>
      </>,
    );
    const btn = screen.getByRole('button', { name: /provenance/i });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    // A click inside the card does not close it.
    await user.click(screen.getByText('Solver revision'));
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    const card = document.getElementById(btn.getAttribute('aria-controls') as string) as HTMLElement;
    expect(card).toBeVisible();
    await user.click(elsewhere);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(card).not.toBeVisible();
    expect(elsewhere).toHaveFocus();
  });
});

// LIVE must be impossible to produce from replayed data. A provenance record of kind "live" read
// from an artifact (a saved run) is evidence, not a running worker: the badge shows the live
// treatment only when the caller also passes the explicit `live` flag from the live-status path.
describe('ProvenanceBadge never draws LIVE from provenance alone', () => {
  const liveRecord: Provenance = { ...provenance, kind: 'live', solverRevision: 'GX a1b2c3d' };
  const liveMarks = (root: ParentNode) => ({
    pill: root.querySelector('[data-status="live"]'),
    dot: root.querySelector('.lab-pill__dot'),
  });

  test('kind "live" without the flag: no live pill, no pulsing dot, not the word "live"; shown as a recorded run', () => {
    const { container } = render(<ProvenanceBadge provenance={liveRecord} subject="GX bean run" defaultOpen />);
    expect(liveMarks(container)).toEqual({ pill: null, dot: null });
    expect(container.textContent).not.toMatch(/live/i);
    const btn = screen.getByRole('button', { name: 'Provenance of GX bean run: Recorded run, Verified' });
    const kindPill = btn.querySelector('.lab-pill') as HTMLElement;
    expect(kindPill.dataset.status).toBe('replay');
    expect(kindPill).toHaveTextContent('Recorded run');
    expect(kindPill.querySelector('svg')?.getAttribute('data-icon')).toBe('replay');
    expect(screen.getByRole('region', { name: /details/ })).toHaveTextContent(/Recorded run\..*saved record/);
  });
  test('live={false} is the same as leaving the flag out', () => {
    const { container } = render(<ProvenanceBadge provenance={liveRecord} live={false} />);
    expect(liveMarks(container)).toEqual({ pill: null, dot: null });
  });
  test('kind "live" with live={true}: the live pill, named "Live"', () => {
    const { container } = render(<ProvenanceBadge provenance={liveRecord} subject="GX bean run" live />);
    expect(liveMarks(container).pill).not.toBeNull();
    expect(liveMarks(container).dot).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Provenance of GX bean run: Live, Verified' })).toBeInTheDocument();
  });
  test.each(['archive', 'derived', 'prd-reported', 'rehearsal'] as const)(
    'the flag cannot turn %s provenance into LIVE',
    (kind) => {
      const { container } = render(<ProvenanceBadge provenance={{ ...provenance, kind }} live />);
      expect(liveMarks(container)).toEqual({ pill: null, dot: null });
      expect(container.querySelector('.lab-pill')?.getAttribute('data-status')).toBe(kind);
    },
  );
  test('provenanceStatus(): the rule in one place', () => {
    expect(provenanceStatus('live')).toMatchObject({ status: 'replay', label: 'Recorded run', icon: 'replay' });
    expect(provenanceStatus('live', false)).toMatchObject({ status: 'replay' });
    expect(provenanceStatus('live', true)).toMatchObject({ status: 'live', label: 'Live' });
    expect(provenanceStatus('rehearsal', true)).toMatchObject({ status: 'rehearsal', label: 'Rehearsal' });
    expect(provenanceStatus('archive')).toMatchObject({ status: 'archive', label: 'Archive' });
    expect(provenanceStatus('live').description).not.toMatch(/live/i);
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
  test('a missing computed value is a bare em dash: no unit after it, and no Δ', () => {
    render(<FixtureCheck fixture={fx({ label: 'Reduced Modal run', claimed: 5.79, computed: null, matches: null })} unit="Q_{gB,i}" />);
    const g = screen.getByRole('group', { name: 'Reduced Modal run: Not recomputable. Claimed 5.79 Q gB,i, computed value not available' });
    expect(within(g).getByTestId('computed').textContent).toBe('—');
    expect(within(g).getByTestId('computed').querySelector('sub')).toBeNull();
    expect(g.querySelector('.lab-fixture__delta')?.textContent).toBe('—');
    // ...while a computed value keeps its unit
    render(<FixtureCheck fixture={fx({ label: 'GENE', computed: 2.674 })} unit="Q_{gB,i}" />);
    expect(within(screen.getByRole('group', { name: /^GENE: Mismatch/ })).getByTestId('computed').textContent).toBe('2.67QgB,i');
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

const LONG_NOTE =
  'Computed with the stated method and the time-weighted edge-interpolated window mean (D-013), forecasts held at the ' +
  'right edge (no look-ahead); not tuned to the PRD value. A sample-and-hold window mean reproduces the PRD score but ' +
  'breaks the 2.55 archive fixture, so it is not used here (D-016).';

describe('FixtureCheck basis (DS-13): arithmetic re-done on PRD-reported inputs is not a data-backed match', () => {
  const arithmetic = fx({ label: 'Published stella bean: 161 h × 288 processors', claimed: 46368, computed: 46368, printedDecimals: 0, matches: true });

  test('basis="arithmetic" + match: "Arithmetic consistent", an equals glyph, its own data attribute — never "Match" or ✓', () => {
    render(<FixtureCheck fixture={arithmetic} unit="CPU-h" basis="arithmetic" />);
    const g = screen.getByRole('group', {
      name: 'Published stella bean: 161 h × 288 processors: Arithmetic consistent. Claimed 46368 CPU-h, computed 46368 CPU-h, difference 0',
    });
    expect(g).toHaveAttribute('data-outcome', 'match');
    expect(g).toHaveAttribute('data-basis', 'arithmetic');
    expect(within(g).getByText('Arithmetic consistent')).toBeVisible();
    expect(within(g).queryByText('Match')).toBeNull();
    expect(g.querySelector('.lab-fixture__glyph [data-icon]')?.getAttribute('data-icon')).toBe('equals');
    expect(g.querySelector('[data-icon="check"]')).toBeNull();
  });
  test('the default basis is unchanged: "Match" with ✓, data-basis="data"', () => {
    render(<FixtureCheck fixture={arithmetic} unit="CPU-h" />);
    const g = screen.getByRole('group', { name: /: Match\. Claimed 46368 CPU-h/ });
    expect(g).toHaveAttribute('data-basis', 'data');
    expect(within(g).getByText('Match')).toBeVisible();
    expect(g.querySelector('.lab-fixture__glyph [data-icon]')?.getAttribute('data-icon')).toBe('check');
  });
  test('the basis never softens a mismatch or an unknown', () => {
    const { unmount } = render(<FixtureCheck fixture={fx({})} basis="arithmetic" />);
    const mis = screen.getByRole('group', { name: /: Mismatch\./ });
    expect(mis).toHaveAttribute('data-outcome', 'mismatch');
    expect(within(mis).getByText('Mismatch')).toBeVisible();
    expect(mis.querySelector('[data-icon="cross"]')).not.toBeNull();
    unmount();
    render(<FixtureCheck fixture={fx({ computed: null, matches: null })} basis="arithmetic" />);
    expect(screen.getByRole('group', { name: /: Not recomputable\./ })).toHaveAttribute('data-outcome', 'unknown');
  });
  test('the four outcome treatments differ pairwise in text and in glyph', () => {
    const { container } = render(
      <>
        <FixtureCheck fixture={fx({ computed: 2.68, matches: true })} />
        <FixtureCheck fixture={fx({ computed: 2.68, matches: true })} basis="arithmetic" />
        <FixtureCheck fixture={fx({})} />
        <FixtureCheck fixture={fx({ computed: null, matches: null })} />
      </>,
    );
    const rows = Array.from(container.querySelectorAll('.lab-fixture'));
    const texts = rows.map((r) => r.querySelector('.lab-fixture__outcome-text')?.textContent);
    const glyphs = rows.map((r) => r.querySelector('.lab-fixture__glyph svg')?.innerHTML);
    expect(texts).toEqual(['Match', 'Arithmetic consistent', 'Mismatch', 'Not recomputable']);
    expect(new Set(glyphs).size).toBe(4);
  });
});

describe('FixtureCheck reading order and notes (DS-7)', () => {
  const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  test('the numbers and the outcome come before the note, in the DOM (so in every layout and for every reader)', () => {
    render(<FixtureCheck fixture={fx({ note: LONG_NOTE })} unit="Q_gB" />);
    const g = screen.getByRole('group', { name: /^GENE mean, 300–400: Mismatch/ });
    const name = within(g).getByText('GENE mean, 300–400');
    const claimed = within(g).getByTestId('claimed');
    const computed = within(g).getByTestId('computed');
    const delta = g.querySelector('.lab-fixture__delta') as HTMLElement;
    const outcome = within(g).getByText('Mismatch');
    const note = within(g).getByText(LONG_NOTE);
    const order = [name, claimed, computed, delta, outcome, note];
    for (let i = 1; i < order.length; i++)
      expect(follows(order[i - 1] as Element, order[i] as Element), `item ${i} follows item ${i - 1}`).toBe(true);
  });
  test('a long note is clamped behind "Show full note"; the full text stays in the document', async () => {
    const user = userEvent.setup();
    render(<FixtureCheck fixture={fx({ note: LONG_NOTE })} />);
    const note = screen.getByText(LONG_NOTE);
    expect(note).toHaveClass('lab-fixture__note');
    expect(note).toHaveAttribute('data-clamped', 'true');
    const more = screen.getByRole('button', { name: 'Show full note' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more.getAttribute('aria-controls')).toBe(note.id);
    await user.click(more);
    expect(note).not.toHaveAttribute('data-clamped');
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    await user.click(less);
    expect(note).toHaveAttribute('data-clamped', 'true');
  });
  test('a short note is shown whole, with no toggle', () => {
    render(<FixtureCheck fixture={fx({ note: 'Arithmetic recomputed; inputs are PRD-reported.' })} />);
    expect(screen.getByText('Arithmetic recomputed; inputs are PRD-reported.')).not.toHaveAttribute('data-clamped');
    expect(screen.queryByRole('button')).toBeNull();
  });
  test('only the note can collapse: mismatch, claimed, computed and Δ are never clamped, hidden or behind a disclosure', () => {
    render(<FixtureCheck fixture={fx({ note: LONG_NOTE, matches: true })} unit="Q_gB" />);
    const g = screen.getByRole('group', { name: /Mismatch.*The match flag disagrees/ });
    const mustShow = [
      within(g).getByText('Mismatch'),
      within(g).getByTestId('claimed'),
      within(g).getByTestId('computed'),
      g.querySelector('.lab-fixture__delta') as HTMLElement,
      within(g).getByText(/flag disagrees/),
    ];
    for (const el of mustShow) {
      expect(el).toBeVisible();
      expect(el.closest('[data-clamped], details, [hidden], [aria-hidden="true"]')).toBeNull();
    }
    expect(within(g).getByTestId('claimed')).toHaveTextContent('2.68');
    expect(within(g).getByTestId('computed')).toHaveTextContent('2.67');
    expect(g.querySelector('.lab-fixture__delta')).toHaveTextContent('−0.01');
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
  test('ArrowDown and ArrowUp move like ArrowRight and ArrowLeft: select, skip disabled, wrap (F12)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Seg onChange={onChange} />);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Triangular' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Triangular' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}'); // skips disabled "None"
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveFocus();
    await user.keyboard('{ArrowDown}'); // wraps
    expect(screen.getByRole('radio', { name: 'Bean' })).toHaveFocus();
    await user.keyboard('{ArrowUp}'); // wraps backwards
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveFocus();
    await user.keyboard('{ArrowUp}'); // skips disabled "None" backwards
    expect(screen.getByRole('radio', { name: 'Triangular' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Triangular' })).toHaveAttribute('aria-checked', 'true');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['triangular', 'both', 'bean', 'both', 'triangular']);
  });
  test('other keys are left alone (no selection change, default not prevented)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Seg onChange={onChange} />);
    await user.tab();
    await user.keyboard('a{PageDown}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Bean' })).toHaveFocus();
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
