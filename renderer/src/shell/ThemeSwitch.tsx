import { useState } from 'react';
import { SegmentedControl, setThemePreference, type ThemePreference } from '../design';

const OPTIONS = [
  { value: 'system', label: 'Auto', ariaLabel: 'Follow system theme' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

function current(): ThemePreference {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePreference>(current);
  return (
    <SegmentedControl<ThemePreference>
      label="Colour theme"
      size="sm"
      options={OPTIONS}
      value={pref}
      onChange={(p) => {
        setThemePreference(p);
        setPref(p);
      }}
    />
  );
}
