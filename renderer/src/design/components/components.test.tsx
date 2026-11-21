// D5: every primitive renders with the right roles, names and keyboard behaviour.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CALLOUT_META, STATUS_META, VERIFICATION_STATUS, provenanceStatus } from '../status';
import type { FixtureCheckData, Provenance } from '../types';
import { CALLOUT_TONES, STATUS_KINDS, THEMES, themes, type StatusKind } from '../tokens';
import { Alert } from './Alert';
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
    'billing-risk': { label: 'Billing risk', icon: 'danger' },
    replay: { label: 'Replay', icon: 'replay' },
    rehearsal: { label: 'Rehearsal', icon: 'rehearsal' },
    archive: { label: 'Archive', icon: 'archive' },
    derived: { label: 'Derived', icon: 'derived' },
    'prd-reported': { label: 'PRD-reported', icon: 'quote' },
    model: { label: 'Model', icon: 'model' },
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
  test('rendered pills: as many different texts and glyph drawings as there are kinds', () => {
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
    const names = [...new Set([...STATUS_KINDS.map((k) => STATUS_META[k].icon), ...CALLOUT_TONES.map((t) => CALLOUT_META[t].icon), 'danger', 'equals', 'chevron', 'external'])] as IconName[];
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

// DL-1: "GPUs may still be billing" has its own treatment in the system, so the shell and the live
// panel stop improvising one from `failed`. The reason strings below are the backend's own words
// (main/labyrinth_main/features/live_gx/orchestrator.py: TERMINATE_FAILED, TERMINATE_PENDING,
// KILL_SWITCH_ONLY, STOPPING; lib/liveStatus.ts builds the connection-lost text).
const TERMINATE_FAILED = 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing';
const TERMINATE_PENDING = 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing';
const KILL_SWITCH_ONLY = 'kill switch raised, stop not confirmed';
const STOPPING = 'Stop requested; terminating workers — not confirmed yet';
const LIVE_BASE = 'Both workers launched; streaming GX output (rehearsal).';
const DANGER_STATES = [
  ['TERMINATE FAILED', 'TERMINATE FAILED — GPUs may still be billing', `${TERMINATE_FAILED}: GPU 0 (bean) cancel failed: ConnectionError: timed out. ${LIVE_BASE}`],
  [
    'TERMINATION PENDING',
    'TERMINATION PENDING — GPUs may still be billing',
    `${TERMINATE_PENDING}: GPU 1 (triangular) cancel queued; the run kill switch is raised. Launching GX workers (rehearsal); hard timeout 900 s.`,
  ],
  [
    'kill switch only',
    'TERMINATE FAILED — GPUs may still be billing',
    `${TERMINATE_FAILED}: GPU 0 (bean) ${KILL_SWITCH_ONLY}: the spawn failed client-side (TimeoutError: rpc) after it may have reached Modal, there is no call to cancel and a worker that started stops only when it reads the switch. ${LIVE_BASE}`,
  ],
  ['stop requested', 'STOP NOT CONFIRMED — GPUs may still be billing', `${STOPPING}. ${LIVE_BASE}`],
  [
    'connection lost',
    'CONNECTION LOST — session state unknown',
    `The live API stopped answering (/api/live/status: no answer within 1500 ms). The last status, received at 14:02:11, reported mode "live": ${LIVE_BASE} GPUs may still be billing.`,
  ],
] as const;

describe('billing risk: the danger pill (DL-1)', () => {
  test('its own label, icon and description; never the live dot', () => {
    const { container } = render(<StatusPill status="billing-risk">TERMINATE FAILED</StatusPill>);
    const pill = container.querySelector('.lab-pill') as HTMLElement;
    expect(pill.dataset.status).toBe('billing-risk');
    expect(pill).toHaveTextContent('TERMINATE FAILED');
    expect(pill.querySelector('svg')?.getAttribute('data-icon')).toBe('danger');
    expect(pill.querySelector('.lab-pill__dot')).toBeNull();
    expect(pill.getAttribute('title')).toMatch(/GPUs may still be billing/);
    render(<StatusPill status="billing-risk" />);
    expect(screen.getByText('Billing risk')).toBeInTheDocument();
  });
  test('its glyph is a solid stop sign with a knocked-out "!", not the outlined circle of Failed (read alike at 12px)', () => {
    const glyph = (name: IconName) => {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector('svg') as SVGElement;
      const out = {
        filled: Array.from(svg.querySelectorAll('path[fill="currentColor"]')).map((p) => p.getAttribute('fill-rule')),
        stroked: svg.querySelectorAll('[stroke="currentColor"]').length,
      };
      unmount();
      return out;
    };
    expect(glyph('danger')).toEqual({ filled: ['evenodd'], stroked: 0 });
    expect(glyph('alert').stroked).toBeGreaterThan(0);
  });
  test('the only outlined kind, and its outline is its text colour in both themes', () => {
    expect(STATUS_KINDS.filter((k) => STATUS_META[k].outlined)).toEqual(['billing-risk']);
    expect(STATUS_META['billing-risk'].dashed).toBeFalsy();
    for (const t of THEMES) expect(themes[t].status['billing-risk'].border, t).toBe(themes[t].status['billing-risk'].fg);
  });
});

/**
 * WAI-ARIA's politeness for a change at `node`: that of the nearest element, itself included, that sets
 * aria-live, explicitly or through a live role (alert is assertive; status and log are polite).
 */
function politeness(node: Element): string {
  for (let el: Element | null = node; el; el = el.parentElement) {
    const live = el.getAttribute('aria-live');
    if (live) return live;
    const role = el.getAttribute('role');
    if (role === 'alert') return 'assertive';
    if (role === 'status' || role === 'log') return 'polite';
  }
  return 'off';
}

describe('Alert (DL-1)', () => {
  test.each(DANGER_STATES)('%s: role="alert", a spoken title, the backend reason verbatim and the action', async (_k, title, reason) => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <Alert title={title} reason={reason} action={<button type="button" onClick={onRetry}>Retry terminate</button>}>
        Check the Modal dashboard until both workers are confirmed stopped.
      </Alert>,
    );
    const alert = screen.getByRole('alert', { name: `Danger: ${title}` });
    expect(alert).toHaveAttribute('data-status', 'billing-risk');
    expect(alert.querySelector('.lab-alert__reason')?.textContent).toBe(reason);
    expect(alert).toHaveTextContent('Check the Modal dashboard until both workers are confirmed stopped.');
    // Never colour alone: its own glyph, and the tone is spoken.
    expect(alert.querySelector('svg[aria-hidden="true"]')?.getAttribute('data-icon')).toBe('danger');
    await user.click(within(alert).getByRole('button', { name: 'Retry terminate' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  test('the reason comes after the title and before the action, in the DOM', () => {
    render(<Alert title="TERMINATE FAILED" reason={TERMINATE_FAILED} action={<a href="#/advance">Open Advance plasma</a>} />);
    const alert = screen.getByRole('alert');
    const title = within(alert).getByText('TERMINATE FAILED');
    const reason = within(alert).getByText(TERMINATE_FAILED);
    const action = within(alert).getByRole('link', { name: 'Open Advance plasma' });
    expect(title.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reason.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  test('without a reason, body or action it renders only the title (no empty slots)', () => {
    const { container } = render(<Alert title="CONNECTION LOST — session state unknown" />);
    expect(screen.getByRole('alert', { name: 'Danger: CONNECTION LOST — session state unknown' })).toBeInTheDocument();
    expect(container.querySelector('.lab-alert__reason')).toBeNull();
    expect(container.querySelector('.lab-alert__body')).toBeNull();
    expect(container.querySelector('.lab-alert__action')).toBeNull();
  });
  // design-r1-R7: one danger is announced once. A second copy of it on the same page (the live panel
  // under the header's) is drawn the same and keeps its name, but is not a second assertive live region.
  test('announce={false}: the same Alert and the same name, but a group instead of a live region', () => {
    const title = 'TERMINATE FAILED — GPUs may still be billing';
    render(
      <>
        <Alert title={title} reason={TERMINATE_FAILED} />
        <Alert title={title} reason={TERMINATE_FAILED} announce={false} action={<button type="button">Retry terminate</button>}>
          Send Terminate again.
        </Alert>
      </>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    const copy = screen.getByRole('group', { name: `Danger: ${title}` });
    expect(copy).toHaveClass('lab-alert');
    expect(copy).toHaveAttribute('data-status', 'billing-risk');
    expect(copy).not.toHaveAttribute('aria-live');
    expect(copy.querySelector('.lab-alert__reason')?.textContent).toBe(TERMINATE_FAILED);
    expect(copy.querySelector('svg[data-icon]')?.getAttribute('data-icon')).toBe('danger');
    expect(copy).toHaveTextContent('Send Terminate again.');
    expect(within(copy).getByRole('button', { name: 'Retry terminate' })).toBeInTheDocument();
    expect(copy.closest('[role="alert"]')).toBeNull();
    expect(politeness(within(copy).getByRole('button'))).toBe('off');
  });
  // design-r2-R5: while the alert is up its action and body change (Terminate → "Terminating… (send
  // again)" → "Retry terminate", a terminate answer). Each change was a fresh assertive announcement,
  // because role="alert" covered the whole box. Only the title and reason are announced now: the body and
  // the action sit in aria-live="off" sub-regions, which WAI-ARIA's nearest-ancestor rule leaves silent.
  // They stay inside the alert, so the alert still carries its own action and body.
  test('only the title and reason are announced; later changes to the body and the action are not', () => {
    const title = 'TERMINATION PENDING — GPUs may still be billing';
    const view = (label: string, answer?: string) => (
      <Alert title={title} reason={TERMINATE_FAILED} action={<button type="button">{label}</button>}>
        Check the Modal dashboard until both workers are confirmed stopped.
        {answer ? <p>{answer}</p> : null}
      </Alert>
    );
    const { rerender } = render(view('Terminate'));
    const alert = screen.getByRole('alert', { name: `Danger: ${title}` });
    expect(politeness(within(alert).getByText(title))).toBe('assertive');
    expect(politeness(within(alert).getByText(TERMINATE_FAILED))).toBe('assertive');
    expect(politeness(within(alert).getByRole('button', { name: 'Terminate' }))).toBe('off');
    for (const [label, answer] of [['Terminating… (send again)'], ['Retry terminate', 'Terminate not confirmed: no answer.']] as const) {
      rerender(view(label, answer));
      expect(screen.getAllByRole('alert')).toEqual([alert]);
      expect(politeness(within(alert).getByRole('button', { name: label }))).toBe('off');
      expect(politeness(within(alert).getByText(/^Check the Modal dashboard/))).toBe('off');
      if (answer) expect(politeness(within(alert).getByText(answer))).toBe('off');
      expect(politeness(within(alert).getByText(TERMINATE_FAILED))).toBe('assertive');
    }
  });
  // SEED-design-1: at 390 px the header's Alert stood about 370 px tall. The compact variant keeps every
  // part (role, title, the reason verbatim, body, action) in the same order; it only tightens the box.
  test('compact: every part kept, in order, with the compact class and a 16 px icon', () => {
    const [, title, reason] = DANGER_STATES[0] as (typeof DANGER_STATES)[number];
    render(
      <Alert compact title={title} reason={reason} action={<a href="#/advance">Open Advance plasma to send Terminate</a>}>
        Check the Modal dashboard until both workers are confirmed stopped.
      </Alert>,
    );
    const alert = screen.getByRole('alert', { name: `Danger: ${title}` });
    expect(alert).toHaveClass('lab-alert', 'lab-alert--compact');
    expect(alert.querySelector('.lab-alert__reason')?.textContent).toBe(reason);
    const parts = ['.lab-alert__title', '.lab-alert__reason', '.lab-alert__body', '.lab-alert__action'].map((s) => alert.querySelector(s) as Element);
    for (let i = 1; i < parts.length; i++) expect(parts[i - 1]?.compareDocumentPosition(parts[i] as Element) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(alert).getByRole('link', { name: 'Open Advance plasma to send Terminate' })).toBeInTheDocument();
    expect(alert.querySelector('svg[data-icon="danger"]')?.getAttribute('width')).toBe('16');
  });
  test('the default Alert is not compact and keeps its 20 px icon', () => {
    render(<Alert title="CONNECTION LOST — session state unknown" />);
    const alert = screen.getByRole('alert');
    expect(alert).not.toHaveClass('lab-alert--compact');
    expect(alert.querySelector('svg[data-icon="danger"]')?.getAttribute('width')).toBe('20');
  });
});

describe('ProvenanceBadge', () => {
  test('collapsed: a disclosure button naming kind and verification', () => {
    render(<ProvenanceBadge provenance={provenance} subject="stella trace" />);
    const btn = screen.getByRole('button', { name: 'Provenance of stella trace: Archive, Verified' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('stella 6f60964d')).not.toBeVisible();
    // Without a caption nothing but the pills (and the chevron) is drawn in the button.
    expect(btn.querySelector('.lab-prov__caption')).toBeNull();
  });
  test('DZ-8 caption: two badges on one panel each show their subject, and each name starts with it (label in name)', () => {
    render(
      <>
        <ProvenanceBadge provenance={{ ...provenance, kind: 'model' }} subject="temperatures, heat fluxes and tile temperatures" caption="Temperatures" />
        <ProvenanceBadge provenance={{ ...provenance, kind: 'derived' }} subject="geometry and |B|" caption="Geometry and |B|" />
      </>,
    );
    const temps = screen.getByRole('button', { name: 'Temperatures — provenance of temperatures, heat fluxes and tile temperatures: Model, Verified' });
    const geom = screen.getByRole('button', { name: 'Geometry and |B| — provenance of geometry and |B|: Derived, Verified' });
    // The caption is visible text inside the button, before the pills.
    for (const [btn, caption] of [
      [temps, 'Temperatures'],
      [geom, 'Geometry and |B|'],
    ] as const) {
      const cap = btn.querySelector('.lab-prov__caption');
      expect(cap).toHaveTextContent(caption);
      expect(cap).toBeVisible();
      expect(btn.firstElementChild).toBe(cap);
      expect(btn.textContent?.startsWith(caption)).toBe(true);
    }
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
  // DL-2: a relative source ("PRD.md") resolved against the app and opened the app shell in a new tab.
  test('only http(s) sources are links; any other source is text, with its reference shown', () => {
    const sources = [
      { label: 'Public trace archive', url: 'https://example.org/trace.h5', sha256: 'a'.repeat(64) },
      { label: 'Mirror', url: 'HTTP://example.org/mirror.h5', sha256: 'b'.repeat(64) },
      { label: 'Accuracy fixtures', url: 'PRD.md', sha256: 'n/a' },
      { label: 'Script', url: 'javascript:alert(1)', sha256: 'n/a' },
      { label: 'Budget task', url: 'tasks/04-budget/TASK.md', sha256: 'n/a', path: 'tasks/04-budget/TASK.md' },
    ];
    render(<ProvenanceBadge provenance={{ ...provenance, kind: 'prd-reported', sources }} defaultOpen />);
    const detail = screen.getByRole('region', { name: /details/ });
    const links = within(detail).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.org/trace.h5', 'HTTP://example.org/mirror.h5']);
    expect(detail.querySelectorAll('a')).toHaveLength(2);
    const items = Array.from(detail.querySelectorAll('.lab-prov__sources li'));
    expect(items).toHaveLength(5);
    expect(items[2]).toHaveTextContent('Accuracy fixtures');
    expect(items[2]?.querySelector('.lab-prov__ref')).toHaveTextContent('PRD.md');
    expect(items[3]?.querySelector('a')).toBeNull();
    expect(items[3]?.querySelector('.lab-prov__ref')).toHaveTextContent('javascript:alert(1)');
    // The text form keeps the hash and the path, like a link does.
    expect(items[2]).toHaveTextContent('sha256 n/a');
    expect(items[4]?.querySelector('.lab-prov__path')).toHaveTextContent('tasks/04-budget/TASK.md');
    expect(items[4]?.querySelector('.lab-prov__ref')).toBeNull(); // the same reference is not printed twice
  });
  // DL-3: the "Units" line printed raw Q_gB.
  test('units are typeset: subscripts, no underscores (a/v_th,i keeps th,i together)', () => {
    render(<ProvenanceBadge provenance={{ ...provenance, units: 'Q_i/Q_gB,i vs t v_th,i/a' }} defaultOpen />);
    const detail = screen.getByRole('region', { name: /details/ });
    const units = within(detail).getByText('Units').nextElementSibling as HTMLElement;
    expect(units.tagName).toBe('DD');
    expect(units.textContent).toBe('Qi/QgB,i vs t vth,i/a');
    expect(Array.from(units.querySelectorAll('sub')).map((s) => s.textContent)).toEqual(['i', 'gB,i', 'th,i']);
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
  test.each(['archive', 'derived', 'prd-reported', 'rehearsal', 'model'] as const)(
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
    expect(provenanceStatus('model')).toMatchObject({ status: 'model', label: 'Model', icon: 'model' });
    expect(provenanceStatus('live').description).not.toMatch(/live/i);
  });
});

// D6 (owner requirement 2026-11-21, D-027): every number of the Heat & field model carries the `model`
// status. It must say what it is (illustrative, not fitted, not a measurement or a W7-X simulation), be
// dashed (not backed by data in this repo) and be told apart from every other kind without colour.
describe('D6 the model status', () => {
  const DESCRIPTION =
    'Illustrative model output: parameters chosen for illustration, not fitted to measurements; not a measurement or a W7-X simulation.';
  test('D6 its label, icon, description and dashed outline', () => {
    expect(STATUS_KINDS).toContain('model');
    expect(STATUS_META.model).toEqual({ label: 'Model', icon: 'model', description: DESCRIPTION, dashed: true });
    // The dashed kinds are exactly the ones no data in this repo backs.
    expect(STATUS_KINDS.filter((k) => STATUS_META[k].dashed)).toEqual(['prd-reported', 'model', 'unverified']);
  });
  test('D6 the pill: visible "Model", the ƒ glyph, the meaning as its title, never the live dot', () => {
    const { container } = render(<StatusPill status="model" />);
    const pill = container.querySelector('.lab-pill') as HTMLElement;
    expect(pill.dataset.status).toBe('model');
    expect(pill).toHaveTextContent('Model');
    expect(pill.querySelector('svg')?.getAttribute('data-icon')).toBe('model');
    expect(pill.getAttribute('title')).toBe(DESCRIPTION);
    expect(pill.querySelector('.lab-pill__dot')).toBeNull();
  });
  test('D6 its glyph is its own drawing (not the Σ of derived nor the quote of PRD-reported)', () => {
    const drawing = (name: IconName) => {
      const { container, unmount } = render(<Icon name={name} />);
      const html = container.querySelector('svg')?.innerHTML ?? '';
      unmount();
      return html;
    };
    for (const other of ['derived', 'quote', 'question'] as const) expect(drawing('model')).not.toBe(drawing(other));
  });
  test.each(THEMES)('D6 %s: its own tokens, a tint of its own and a dashed border distinct from the other dashed kinds', (theme) => {
    const s = themes[theme].status;
    expect(Object.keys(s)).toContain('model');
    for (const other of ['prd-reported', 'unverified', 'blocked', 'billing-risk'] as const) {
      expect(s.model.fg, other).not.toBe(s[other].fg);
      expect(s.model.border, other).not.toBe(s[other].border);
    }
  });
  test('D6 a ProvenanceBadge of kind model reads "Model" with its outcome, and its card says what the model is', () => {
    const record: Provenance = {
      ...provenance,
      kind: 'model',
      solverRevision: 'heatfield model v1',
      verification: { outcome: 'not-applicable', details: 'Illustrative model, not a W7-X simulation.' },
      sources: [],
    };
    const { container } = render(<ProvenanceBadge provenance={record} subject="tile temperatures" defaultOpen />);
    const btn = screen.getByRole('button', { name: 'Provenance of tile temperatures: Model, Not applicable' });
    expect(btn.querySelector('.lab-pill')?.getAttribute('data-status')).toBe('model');
    expect(screen.getByRole('region', { name: /details/ })).toHaveTextContent(`Model. ${DESCRIPTION}`);
    expect(container.querySelector('[data-status="live"]')).toBeNull();
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
  // design-r1-R2: the producer sets `matches` with Python's round(), ties to even. The check and the
  // printed values use the same rule, so an exact tie neither contradicts the flag nor shows two equal
  // numbers labelled Mismatch. Δ is the difference of the printed values: 0 exactly when they match.
  // `matches` below is python3's round(computed, d) == round(claimed, d).
  test.each([
    [0.12, 0.125, 2, true, 'Match', '0.12', '0.00'],
    [0.13, 0.125, 2, false, 'Mismatch', '0.12', '−0.01'],
    [2, 2.5, 0, true, 'Match', '2', '0'],
    [3, 2.5, 0, false, 'Mismatch', '2', '−1'],
    [14.2, 14.25, 1, true, 'Match', '14.2', '0.0'],
    [14.3, 14.25, 1, false, 'Mismatch', '14.2', '−0.1'],
    // not a tie: printed 1.0 vs 1.1 differ, while the raw difference (0.02) rounds to 0.0
    [1.04, 1.06, 1, false, 'Mismatch', '1.1', '+0.1'],
  ] as const)('claimed %s, computed %s at %s decimals (matches: %s): %s, computed %s, Δ %s', (claimed, computed, d, matches, word, shown, delta) => {
    const f = fx({ label: 'tie', claimed, computed, printedDecimals: d, matches });
    expect(fixtureOutcome(f)).toEqual({ outcome: matches ? 'match' : 'mismatch', inconsistent: false });
    render(<FixtureCheck fixture={f} />);
    const g = screen.getByRole('group', { name: new RegExp(`^tie: ${word}\\.`) });
    expect(within(g).getByTestId('computed').textContent).toBe(shown);
    expect(g.querySelector('.lab-fixture__delta')?.textContent).toBe(delta);
    expect(within(g).queryByText(/flag disagrees/)).toBeNull();
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

// DL-5 / D-023: `claimedRange` + `claimed: null` when the PRD prints a range, and `basis` on the fixture.
describe('FixtureCheck renders D-023 fixtures: ranges, missing claims and the basis from the data', () => {
  type Combo = { matches: boolean | null; claimedIsNumber: boolean; hasRange: boolean; basis: 'data' | 'arithmetic' };
  const COMBOS: Combo[] = [true, false, null].flatMap((matches) =>
    [true, false].flatMap((claimedIsNumber) =>
      [true, false].flatMap((hasRange) => (['data', 'arithmetic'] as const).map((basis) => ({ matches, claimedIsNumber, hasRange, basis }))),
    ),
  );
  // 3172.763 is inside [3100, 3200] and prints as 3173 at the PRD's 0 decimals. 3150 is the midpoint
  // an old artifact put in `claimed`: with a range present it must never be shown or spoken.
  const fixtureFor = (c: Combo): FixtureCheckData => ({
    id: 'full-grid-usd',
    label: 'Full-grid cost',
    claimed: c.claimedIsNumber ? (c.hasRange ? 3150 : 3173) : null,
    ...(c.hasRange ? { claimedRange: [3100, 3200] as const } : {}),
    computed: 3172.763,
    printedDecimals: 0,
    matches: c.matches,
    basis: c.basis,
  });
  const expected = (c: Combo) => {
    if (c.hasRange) {
      if (c.matches === null) return { outcome: 'unknown', text: 'Not recomputable', icon: 'dash', claim: 'range', inconsistent: false };
      if (c.matches)
        return c.basis === 'data'
          ? { outcome: 'match', text: 'Inside PRD range', icon: 'check', claim: 'range', inconsistent: false }
          : { outcome: 'match', text: 'Arithmetic in PRD range', icon: 'equals', claim: 'range', inconsistent: false };
      return { outcome: 'mismatch', text: 'Mismatch', icon: 'cross', claim: 'range', inconsistent: true };
    }
    if (!c.claimedIsNumber) return { outcome: 'unknown', text: 'No PRD value', icon: 'dash', claim: 'none', inconsistent: false };
    if (c.matches === null) return { outcome: 'unknown', text: 'Not recomputable', icon: 'dash', claim: 'value', inconsistent: false };
    if (c.matches)
      return c.basis === 'data'
        ? { outcome: 'match', text: 'Match', icon: 'check', claim: 'value', inconsistent: false }
        : { outcome: 'match', text: 'Arithmetic consistent', icon: 'equals', claim: 'value', inconsistent: false };
    return { outcome: 'mismatch', text: 'Mismatch', icon: 'cross', claim: 'value', inconsistent: true };
  };

  test('the matrix has every combination once', () => {
    expect(COMBOS).toHaveLength(24);
    expect(new Set(COMBOS.map((c) => JSON.stringify(c))).size).toBe(24);
  });

  test.each(COMBOS.map((c) => [JSON.stringify(c), c] as const))('%s', (_name, c) => {
    const e = expected(c);
    const { container } = render(<FixtureCheck fixture={fixtureFor(c)} unit="USD" />);
    const g = screen.getByRole('group', { name: new RegExp(`^Full-grid cost: ${e.text}\\.`) });
    expect(g).toHaveAttribute('data-outcome', e.outcome);
    expect(g).toHaveAttribute('data-basis', c.basis);
    expect(g).toHaveAttribute('data-claim', e.claim);
    expect(g.querySelector('.lab-fixture__outcome-text')?.textContent).toBe(e.text);
    expect(g.querySelector('.lab-fixture__glyph [data-icon]')?.getAttribute('data-icon')).toBe(e.icon);
    const claimed = within(g).getByTestId('claimed');
    const key = claimed.previousElementSibling?.textContent;
    if (c.hasRange) {
      expect(key).toBe('PRD range');
      expect(claimed.textContent).toBe('3100–3200USD');
      // Never the midpoint, on screen or in the spoken name.
      expect(container.textContent).not.toContain('3150');
      expect(g.getAttribute('aria-label')).not.toContain('3150');
      expect(g.getAttribute('aria-label')).toContain('PRD range 3100 to 3200 USD');
    } else {
      expect(key).toBe('Claimed (PRD)');
      expect(claimed.textContent).toBe(c.claimedIsNumber ? '3173' : '—');
    }
    expect(Boolean(within(g).queryByText(/flag disagrees/)), 'inconsistency note').toBe(e.inconsistent);
  });

  test('outside the range: "Outside PRD range", ✗, and the signed distance to the nearer bound — no midpoint anywhere', () => {
    const f: FixtureCheckData = { id: 'x', label: 'Full-grid cost', claimed: null, claimedRange: [3100, 3200], computed: 3260.4, printedDecimals: 0, matches: false };
    render(<FixtureCheck fixture={f} unit="USD" />);
    const g = screen.getByRole('group', {
      name: 'Full-grid cost: Outside PRD range. PRD range 3100 to 3200 USD, computed 3260.40 USD, distance to the range plus 60.40',
    });
    expect(g).toHaveAttribute('data-outcome', 'mismatch');
    expect(g.querySelector('[data-icon="cross"]')).not.toBeNull();
    expect(within(g).getByTestId('computed').textContent).toBe('3260.40USD');
    expect(g.querySelector('.lab-fixture__delta')?.textContent).toBe('+60.40');
    expect(g.querySelector('.lab-fixture__delta')?.previousElementSibling?.textContent).toBe('Δ to range');
    expect(within(g).queryByText(/flag disagrees/)).toBeNull();
    expect(g.textContent).not.toContain('3150');
  });
  test('below the range the distance is negative; inside it is zero', () => {
    const below: FixtureCheckData = { id: 'b', label: 'Wall time', claimed: null, claimedRange: [14, 15], computed: 13.2, printedDecimals: 0, matches: false };
    const inside: FixtureCheckData = { ...below, id: 'i', label: 'Wall time inside', computed: 14.44792, matches: true };
    render(
      <>
        <FixtureCheck fixture={below} unit="days" />
        <FixtureCheck fixture={inside} unit="days" />
      </>,
    );
    const b = screen.getByRole('group', { name: /^Wall time: Outside PRD range\./ });
    expect(b.querySelector('.lab-fixture__delta')?.textContent).toBe('−0.80');
    const i = screen.getByRole('group', { name: /^Wall time inside: Inside PRD range\./ });
    expect(within(i).getByTestId('claimed').textContent).toBe('14–15days');
    // The two bounds and the dash are one element (CSS keeps it on one line); the unit is outside it.
    expect(within(i).getByTestId('claimed').querySelector('.lab-fixture__range')?.textContent).toBe('14–15');
    // ...and the unit keeps a break opportunity before it, or it runs into the next column at 390 px.
    expect(within(i).getByTestId('claimed').querySelector('.lab-fixture__range')?.nextSibling?.nodeName).toBe('WBR');
    expect(within(i).getByTestId('computed').textContent).toBe('14.45days');
    expect(i.querySelector('.lab-fixture__delta')?.textContent).toBe('0.00');
  });
  test('a flag that says "inside" for a value outside the range is shown as outside, with the disagreement named', () => {
    const f: FixtureCheckData = { id: 'x', label: 'Cost', claimed: null, claimedRange: [3100, 3200], computed: 3260.4, printedDecimals: 0, matches: true };
    render(<FixtureCheck fixture={f} unit="USD" />);
    const g = screen.getByRole('group', { name: /^Cost: Outside PRD range\..*The match flag disagrees with the range test\.$/ });
    expect(g).toHaveAttribute('data-outcome', 'mismatch');
    expect(within(g).getByText('Match flag disagrees with the range test — treated as a mismatch.')).toBeVisible();
  });
  test('the computed value is never rounded onto the other side of a bound', () => {
    const at = (computed: number, matches: boolean) =>
      ({ id: `c${computed}`, label: `t ${computed}`, claimed: null, claimedRange: [14, 15], computed, printedDecimals: 0, matches }) as FixtureCheckData;
    render(
      <>
        <FixtureCheck fixture={at(15.000004, false)} />
        <FixtureCheck fixture={at(13.9999, false)} />
        <FixtureCheck fixture={at(14.999999, true)} />
      </>,
    );
    const shown = (name: string) => within(screen.getByRole('group', { name: new RegExp(`^${name}: `) })).getByTestId('computed').textContent;
    expect(shown('t 15.000004')).toBe('15.000004'); // "15.00" would read as on the bound, i.e. inside
    expect(shown('t 13.9999')).toBe('13.9999');
    expect(shown('t 14.999999')).toBe('15.00'); // inside, and "15.00" is inside too: two extra decimals are enough
  });
  // design-r1-R1: within an ulp of a bound no fixed number of extra decimals separates the value from
  // the bound. The value then prints in its shortest round-trip form, which is always on its own side,
  // and Δ gains decimals until it is not an unsigned zero.
  test.each([
    [[1, 2], 0, 0.9999999999999999, '0.9999999999999999', '−0.0000000000000001'],
    [[1, 2], 0, 2.0000000000000004, '2.0000000000000004', '+0.0000000000000004'],
    [[0.1, 0.3], 1, 0.1 + 0.2, '0.30000000000000004', '+0.00000000000000006'],
  ] as const)('range %j at %s decimals, computed %s: printed %s, Δ %s', (range, d, computed, shown, delta) => {
    const f: FixtureCheckData = { id: 'u', label: 'ulp', claimed: null, claimedRange: range, computed, printedDecimals: d, matches: false };
    render(<FixtureCheck fixture={f} />);
    const g = screen.getByRole('group', { name: /^ulp: Outside PRD range\./ });
    expect(within(g).getByTestId('computed').textContent).toBe(shown);
    expect(g.querySelector('.lab-fixture__delta')?.textContent).toBe(delta);
  });
  test('one to three ulps either side of a bound: the printed value is on the same side as the value, and Δ has its sign', () => {
    const ulps = (x: number, n: number) => {
      const f = new Float64Array([x]);
      const bits = new BigInt64Array(f.buffer);
      bits[0] = (bits[0] as bigint) + BigInt(n);
      return f[0] as number;
    };
    const ranges: [number, number, number][] = [[1, 2, 0], [0.1, 0.3, 1], [14, 15, 0], [3100, 3200, 0], [0.001, 0.002, 3], [2.55, 2.68, 2]];
    const cases = ranges.flatMap(([lo, hi, d]) =>
      [lo, hi].flatMap((b) => [-3, -2, -1, 1, 2, 3].map((n) => ({ lo, hi, d, v: ulps(b, n) }))),
    );
    const parse = (s: string) => Number(s.replace('−', '-'));
    const side = (x: number, lo: number, hi: number) => (x < lo ? -1 : x > hi ? 1 : 0);
    const signOf = (s: string) => (s.startsWith('+') ? 1 : s.startsWith('−') ? -1 : 0);
    render(
      <>
        {cases.map((c, i) => (
          <FixtureCheck
            key={i}
            fixture={{ id: `p${i}`, label: `p${i}`, claimed: null, claimedRange: [c.lo, c.hi], computed: c.v, printedDecimals: c.d, matches: side(c.v, c.lo, c.hi) === 0 }}
          />
        ))}
      </>,
    );
    const seen = cases.map((c, i) => {
      const g = screen.getByRole('group', { name: new RegExp(`^p${i}: `) });
      const printed = parse(within(g).getByTestId('computed').textContent ?? '');
      const delta = g.querySelector('.lab-fixture__delta')?.textContent ?? '';
      return { v: c.v, printedSide: side(printed, c.lo, c.hi), deltaSign: signOf(delta), outcome: g.getAttribute('data-outcome') };
    });
    expect(seen).toEqual(
      cases.map((c) => {
        const truth = side(c.v, c.lo, c.hi);
        return { v: c.v, printedSide: truth, deltaSign: truth, outcome: truth === 0 ? 'match' : 'mismatch' };
      }),
    );
  });
  test('a range that cannot be recomputed: em dashes, no unit after them, no distance', () => {
    const f: FixtureCheckData = { id: 'x', label: 'Cost', claimed: null, claimedRange: [3100, 3200], computed: null, printedDecimals: 0, matches: null };
    render(<FixtureCheck fixture={f} unit="USD" />);
    const g = screen.getByRole('group', { name: 'Cost: Not recomputable. PRD range 3100 to 3200 USD, computed value not available' });
    expect(within(g).getByTestId('computed').textContent).toBe('—');
    expect(g.querySelector('.lab-fixture__delta')?.textContent).toBe('—');
  });
  test('a claimed value of null without a range is a bare em dash, spoken as not available', () => {
    render(<FixtureCheck fixture={fx({ claimed: null, matches: true })} unit="Q_gB" />);
    const g = screen.getByRole('group', { name: 'GENE mean, 300–400: No PRD value. Claimed value not available, computed 2.67 Q gB' });
    expect(within(g).getByTestId('claimed').textContent).toBe('—');
    expect(g.querySelector('.lab-fixture__delta')?.textContent).toBe('—');
  });
  // design-r1-R3: D-023 takes the basis from the artifact. A call site may make a check more cautious
  // (data -> arithmetic), never less: an arithmetic-only fixture never becomes a green ✓ "Match".
  test('the basis comes from the fixture; the prop can only downgrade it; absent means data', () => {
    const match = fx({ computed: 2.68, matches: true });
    render(
      <>
        <FixtureCheck fixture={{ ...match, id: 'a', label: 'from data', basis: 'arithmetic' }} />
        <FixtureCheck fixture={{ ...match, id: 'b', label: 'upgrade refused', basis: 'arithmetic' }} basis="data" />
        <FixtureCheck fixture={{ ...match, id: 'd', label: 'downgraded', basis: 'data' }} basis="arithmetic" />
        <FixtureCheck fixture={{ ...match, id: 'c', label: 'absent' }} />
      </>,
    );
    expect(screen.getByRole('group', { name: /^from data: Arithmetic consistent\./ })).toHaveAttribute('data-basis', 'arithmetic');
    const refused = screen.getByRole('group', { name: /^upgrade refused: Arithmetic consistent\./ });
    expect(refused).toHaveAttribute('data-basis', 'arithmetic');
    expect(refused.querySelector('[data-icon="check"]')).toBeNull();
    expect(screen.getByRole('group', { name: /^downgraded: Arithmetic consistent\./ })).toHaveAttribute('data-basis', 'arithmetic');
    expect(screen.getByRole('group', { name: /^absent: Match\./ })).toHaveAttribute('data-basis', 'data');
  });
  test('an explicit claimedLabel still wins over "PRD range"', () => {
    const f: FixtureCheckData = { id: 'x', label: 'Cost', claimed: null, claimedRange: [3100, 3200], computed: 3150.5, printedDecimals: 0, matches: true };
    render(<FixtureCheck fixture={f} unit="USD" claimedLabel="Range (TASK.md)" />);
    expect(within(screen.getByRole('group')).getByTestId('claimed').previousElementSibling?.textContent).toBe('Range (TASK.md)');
  });
  // design-r2-R2: contract `claimSource` "task" = only tasks/<NN>/TASK.md prints the claim, and consumers
  // label it as a TASK.md figure, never a PRD one. The words come from the fixture, not from a call site.
  describe('claimSource "task": every word that names the claim’s source says TASK.md', () => {
    const task = (part: Partial<FixtureCheckData>): FixtureCheckData => ({
      id: 't',
      label: 'Remaining',
      claimed: null,
      computed: null,
      printedDecimals: 0,
      matches: null,
      claimSource: 'task',
      ...part,
    });
    test.each([
      ['a value', task({ claimed: 18.17, computed: 18.17, printedDecimals: 2, matches: true, basis: 'arithmetic' }), 'Claimed (TASK.md)', 'Arithmetic consistent', 'Claimed 18.17 USD, computed 18.17 USD'],
      ['a range, arithmetic, inside', task({ claimedRange: [14, 15], computed: 14.4, matches: true, basis: 'arithmetic' }), 'TASK.md range', 'Arithmetic in TASK.md range', 'TASK.md range 14 to 15 USD, computed 14.40 USD'],
      ['a range, data, inside', task({ claimedRange: [14, 15], computed: 14.4, matches: true }), 'TASK.md range', 'Inside TASK.md range', 'TASK.md range 14 to 15 USD'],
      ['a range, outside', task({ claimedRange: [14, 15], computed: 16.2, matches: false }), 'TASK.md range', 'Outside TASK.md range', 'TASK.md range 14 to 15 USD, computed 16.20 USD, distance to the range plus 1.20'],
      ['no value', task({ computed: 3, matches: true }), 'Claimed (TASK.md)', 'No TASK.md value', 'Claimed value not available, computed 3 USD'],
    ] as const)('%s', (_name, fixture, key, outcome, spoken) => {
      render(<FixtureCheck fixture={fixture} unit="USD" />);
      const g = screen.getByRole('group', { name: new RegExp(`^Remaining: ${outcome}\\. `) });
      expect(within(g).getByTestId('claimed').previousElementSibling?.textContent).toBe(key);
      expect(g.querySelector('.lab-fixture__outcome-text')?.textContent).toBe(outcome);
      expect(g.getAttribute('aria-label')).toContain(`Remaining: ${outcome}. ${spoken}`);
      expect(`${g.textContent} ${g.getAttribute('aria-label')}`).not.toMatch(/PRD/);
    });
    test('"prd", or no claimSource, keeps the PRD words; an explicit claimedLabel still wins', () => {
      const range: FixtureCheckData = { id: 'r', label: 'Days', claimed: null, claimedRange: [14, 15], computed: 16.2, printedDecimals: 0, matches: false };
      render(
        <>
          <FixtureCheck fixture={{ ...range, claimSource: 'prd' }} />
          <FixtureCheck fixture={{ ...range, id: 'a', label: 'Absent' }} />
          <FixtureCheck fixture={{ ...range, id: 'l', label: 'Labelled', claimSource: 'task' }} claimedLabel="Range (task 04)" />
        </>,
      );
      const prd = screen.getByRole('group', { name: 'Days: Outside PRD range. PRD range 14 to 15, computed 16.20, distance to the range plus 1.20' });
      expect(within(prd).getByTestId('claimed').previousElementSibling?.textContent).toBe('PRD range');
      expect(screen.getByRole('group', { name: /^Absent: Outside PRD range\. PRD range 14 to 15/ })).toBeInTheDocument();
      const labelled = screen.getByRole('group', { name: /^Labelled: Outside TASK\.md range\. TASK\.md range 14 to 15/ });
      expect(within(labelled).getByTestId('claimed').previousElementSibling?.textContent).toBe('Range (task 04)');
    });
  });
  // design-r2-R6: no number of decimals up to the printed + 15 the loop used to try separates a value a
  // few 1e-16 from a bound of 0, and the fallback printed "−3.4907937049865723e-16". It is fixed
  // notation now, with as many places as it takes (toFixed() prints at most 100; beyond that, every
  // digit of the shortest round-trip form). printedDecimals above 100 used to throw from toFixed().
  test('a value a few 1e-16 off a bound of 0 is printed in fixed notation, on its own side, with a signed Δ', () => {
    const f: FixtureCheckData = { id: 'z', label: 'z', claimed: null, claimedRange: [0, 1], computed: -3.4907937049865723e-16, printedDecimals: 0, matches: false };
    render(<FixtureCheck fixture={f} />);
    const g = screen.getByRole('group', { name: /^z: Outside PRD range\./ });
    expect(within(g).getByTestId('computed').textContent).toBe('−0.0000000000000003');
    expect(g.querySelector('.lab-fixture__delta')?.textContent).toBe('−0.0000000000000003');
  });
  test('closer to a bound than 100 decimals can tell: every digit, still in fixed notation', () => {
    const below: FixtureCheckData = { id: 'b', label: 'below', claimed: null, claimedRange: [0, 1], computed: -1.5e-200, printedDecimals: 0, matches: false };
    const above: FixtureCheckData = { ...below, id: 'a', label: 'above', claimedRange: [-1, 0], computed: 5e-324 };
    render(
      <>
        <FixtureCheck fixture={below} />
        <FixtureCheck fixture={above} />
      </>,
    );
    const b = screen.getByRole('group', { name: /^below: Outside PRD range\./ });
    expect(within(b).getByTestId('computed').textContent).toBe(`−0.${'0'.repeat(199)}15`);
    expect(b.querySelector('.lab-fixture__delta')?.textContent).toBe(`−0.${'0'.repeat(199)}15`);
    const a = screen.getByRole('group', { name: /^above: Outside PRD range\./ });
    expect(within(a).getByTestId('computed').textContent).toBe(`0.${'0'.repeat(323)}5`);
    expect(a.querySelector('.lab-fixture__delta')?.textContent).toBe(`+0.${'0'.repeat(323)}5`);
  });
  test('a sweep of values near bounds across magnitudes: never exponential; printed side, Δ sign and outcome follow the value', () => {
    // A fixed linear congruential generator: the same cases on every run.
    let seed = 20261120;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const side = (x: number, lo: number, hi: number) => (x < lo ? -1 : x > hi ? 1 : 0);
    const cases = [1e-9, 1e-3, 1, 1e3, 1e9].flatMap((m) =>
      [[0, m], [m, 2 * m], [-m, 0]].flatMap(([lo, hi]) =>
        Array.from({ length: 16 }, () => {
          const bound = rnd() < 0.5 ? (lo as number) : (hi as number);
          const offset = (rnd() < 0.5 ? -1 : 1) * 10 ** -Math.floor(rnd() * 22) * (1 + rnd()) * Math.max(Math.abs(bound), 1e-16);
          const v = bound + offset;
          return { lo: lo as number, hi: hi as number, v, d: Math.floor(rnd() * 5) };
        }),
      ),
    );
    render(
      <>
        {cases.map((c, i) => (
          <FixtureCheck key={i} fixture={{ id: `s${i}`, label: `s${i}`, claimed: null, claimedRange: [c.lo, c.hi], computed: c.v, printedDecimals: c.d, matches: side(c.v, c.lo, c.hi) === 0 }} />
        ))}
      </>,
    );
    const parse = (s: string) => Number(s.replace('−', '-'));
    const signOf = (s: string) => (s.startsWith('+') ? 1 : s.startsWith('−') ? -1 : 0);
    const seen = cases.map((c, i) => {
      const g = screen.getByRole('group', { name: new RegExp(`^s${i}: `) });
      const printed = within(g).getByTestId('computed').textContent ?? '';
      const delta = g.querySelector('.lab-fixture__delta')?.textContent ?? '';
      return { i, exponent: /e/i.test(printed + delta), side: side(parse(printed), c.lo, c.hi), sign: signOf(delta), outcome: g.getAttribute('data-outcome') };
    });
    expect(cases.filter((c) => side(c.v, c.lo, c.hi) !== 0).length, 'the sweep has values outside').toBeGreaterThan(40);
    expect(seen).toEqual(
      cases.map((c, i) => {
        const truth = side(c.v, c.lo, c.hi);
        return { i, exponent: false, side: truth, sign: truth, outcome: truth === 0 ? 'match' : 'mismatch' };
      }),
    );
  });
  test.each([99, 100, 150])('printedDecimals %s (the contract allows any integer ≥ 0) renders instead of throwing; above 100 it prints 100', (d) => {
    const range: FixtureCheckData = { id: 'r', label: 'range', claimed: null, claimedRange: [1, 2], computed: 1.5, printedDecimals: d, matches: true };
    const value: FixtureCheckData = { id: 'v', label: 'value', claimed: 1.5, computed: 1.5, printedDecimals: d, matches: true };
    render(
      <>
        <FixtureCheck fixture={range} />
        <FixtureCheck fixture={value} />
      </>,
    );
    const places = Math.min(d, 100);
    const r = screen.getByRole('group', { name: /^range: Inside PRD range\./ });
    expect(within(r).getByTestId('computed').textContent).toBe(`1.${'5'.padEnd(Math.min(places + 2, 100), '0')}`);
    const v = screen.getByRole('group', { name: /^value: Match\./ });
    expect(within(v).getByTestId('claimed').textContent).toBe(`1.${'5'.padEnd(places, '0')}`);
    expect(fixtureOutcome(value)).toEqual({ outcome: 'match', inconsistent: false });
  });
  test('fixtureOutcome() applies the range rule to the unrounded value', () => {
    const r = (computed: number | null, matches: boolean | null): FixtureCheckData => ({ id: 'r', label: 'r', claimed: null, claimedRange: [14, 15], computed, printedDecimals: 0, matches });
    expect(fixtureOutcome(r(15, true))).toEqual({ outcome: 'match', inconsistent: false });
    expect(fixtureOutcome(r(15.0001, true))).toEqual({ outcome: 'mismatch', inconsistent: true });
    expect(fixtureOutcome(r(14.5, false))).toEqual({ outcome: 'mismatch', inconsistent: true });
    expect(fixtureOutcome(r(16, false))).toEqual({ outcome: 'mismatch', inconsistent: false });
    expect(fixtureOutcome(r(null, true))).toEqual({ outcome: 'unknown', inconsistent: false });
    expect(fixtureOutcome({ ...r(14.5, true), claimedRange: undefined })).toEqual({ outcome: 'unknown', inconsistent: false });
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
