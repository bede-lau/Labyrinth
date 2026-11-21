// Symbols written with "_" in the artifact and the view ("T_ped", "τ_E", "θ_s,k") typeset as subscripts (DZ3-5).
import type { ReactNode } from 'react';

/**
 * A subscript after "_": letters, digits and the symbols the artifact writes there (⊥, ∥, φ, θ), with "s,k" kept
 * together; it ends at a space, a bracket, an operator, punctuation, a comma followed by a space or another "_".
 */
const SUBSCRIPT = /_([^\s_()[\]·,.;:/+−=²*]+(?:,[^\s_()[\]·,.;:/+−=²*]+)*)/g;

/**
 * Text with every "X_abc" typeset as X<sub>abc</sub>: "T_ped" -> T<sub>ped</sub>, "θ_s,k(t)" -> θ<sub>s,k</sub>(t),
 * "(T_ped − T)/τ_E" -> (T<sub>ped</sub> − T)/τ<sub>E</sub>. Text without "_" is printed as is. Callers keep the
 * plain text for assistive technology (an aria-label) where a sub-element would be read apart.
 */
export function SubscriptText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SUBSCRIPT)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<sub key={at}>{m[1]}</sub>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
