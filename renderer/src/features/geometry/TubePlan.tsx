import { useMemo } from 'react';
import type { GeometryArtifact, TubeId } from './types';
import { tubeById } from './model';

// Orthographic overview of the same xyz samples used by the interactive Locate view.
// Both illustrations use the same camera and scale so their field-line paths can be compared.
function project(x: number, y: number, z: number): string {
  const horizontal = 0.8 * x - 0.6 * y;
  const depth = 0.6 * x + 0.8 * y;
  return ((horizontal * 9) + 64).toFixed(1) + ',' + (39 - (0.42 * depth + 0.908 * z) * 9).toFixed(1);
}

function outlines(g: GeometryArtifact) {
  const { nTheta, nPhi, positions } = g.surface;
  const point = (phi: number, theta: number) => {
    const i = (phi * nTheta + theta) * 3;
    return project(positions[i]!, positions[i + 1]!, positions[i + 2]!);
  };
  const rings: string[] = [];
  for (let p = 0; p < nPhi; p += 3) {
    const ring: string[] = [];
    for (let t = 0; t < nTheta; t += 3) ring.push(point(p, t));
    rings.push('M' + ring.join('L') + 'Z');
  }
  for (let t = 0; t < nTheta; t += 8) {
    const loop: string[] = [];
    for (let p = 0; p < nPhi; p += 2) loop.push(point(p, t));
    rings.push('M' + loop.join('L') + 'Z');
  }
  return rings.join('');
}

export function TubePlan({ geometry, selected, onSelect }: {
  geometry: GeometryArtifact;
  selected: TubeId;
  onSelect: (tube: TubeId) => void;
}) {
  const mesh = useMemo(() => outlines(geometry), [geometry]);
  return (
    <div className="geo-plan" role="group" aria-label="W7-X GPU assignments">
      {(['bean', 'triangular'] as const).map((id, index) => {
        const tube = tubeById(geometry, id);
        return <button type="button" key={id} data-tube={id} aria-pressed={id === selected} onClick={() => onSelect(id)}>
          <svg viewBox="0 0 128 78" aria-hidden="true">
            <path className="geo-plan__mesh" d={mesh} />
            <polyline className="geo-plan__line" points={tube.samples.map(s => project(s.x, s.y, s.z)).join(' ')} />
          </svg>
          <span>GPU {index}</span><strong>{id === 'bean' ? 'Bean tube' : 'Triangular tube'}</strong>
        </button>;
      })}
    </div>
  );
}
