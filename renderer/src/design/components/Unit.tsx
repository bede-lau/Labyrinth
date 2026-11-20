import { parseUnit } from '../format';

/** Renders a unit string with subscripts: `Q_gB` -> Q<sub>gB</sub>, `a/v_{th,i}` -> a/v<sub>th,i</sub>. */
export function Unit({ unit, className }: { unit: string; className?: string }) {
  return (
    <span className={className}>
      {parseUnit(unit).map((p, i) => (p.sub ? <sub key={i}>{p.text}</sub> : <span key={i}>{p.text}</span>))}
    </span>
  );
}
