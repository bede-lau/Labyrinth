// Public surface of the Labyrinth design system. Import from 'src/design' only.
// tokens.css is loaded once, globally, from main.tsx.

export * from './tokens';
export * from './theme';
export * from './format';
export * from './status';
export type * from './types';
export * from './plotTheme';
export * from './sceneTheme';

export { Panel, type PanelProps } from './components/Panel';
export { Stat, type StatProps } from './components/Stat';
export { StatusPill, type StatusPillProps } from './components/StatusPill';
export { ProvenanceBadge, type ProvenanceBadgeProps } from './components/ProvenanceBadge';
export { FixtureCheck, fixtureOutcome, type FixtureCheckProps, type FixtureOutcome } from './components/FixtureCheck';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './components/SegmentedControl';
export { Callout, type CalloutProps } from './components/Callout';
export { Icon, type IconName, type IconProps } from './components/Icon';
export { Unit } from './components/Unit';
