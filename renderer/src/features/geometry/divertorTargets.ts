import type { HeatfieldArtifact } from '../heatfield/types';
import type { Simulation } from '../heatfield/sim';
import { sampleRZ, toXYZ } from '../heatfield/scene';
import { plasmaMaterials } from '../../design/tokens';

// Sub-bin maximum of the parabola through the three hottest adjacent samples.
export function peakOffset(values: ArrayLike<number>, peak: number) {
  if (peak === 0 || peak === values.length - 1) return 0;
  const left = values[peak-1]!, right = values[peak+1]!;
  const curvature = left + right - 2*values[peak]!;
  return curvature < 0 ? Math.max(-0.5, Math.min(0.5, (left-right)/(2*curvature))) : 0;
}

type Three = typeof import('three');

// Schematic armoured targets, enlarged for inspection. The glowing band
// shows the calculated tile temperature. The marker follows the strike load.
export function buildTargets(T: Three, art: HeatfieldArtifact) {
  const { nTheta, nPhi } = art.grid;
  const surface = art.surfaces[art.surfaces.length - 1]!;
  const group = new T.Group();
  const segment = new T.BoxGeometry(1, 1, 1);
  const dark = new T.Color(plasmaMaterials.targetCold),
    hot = new T.Color(plasmaMaterials.targetHot);
  const warm = new T.Color(plasmaMaterials.temperature[3]);
  const steel = new T.Color(plasmaMaterials.vessel);
  const halfSpan = art.diverters.halfWidthTheta + 0.35;
  const count = 15;
  const targets = art.diverters.items.map(({ id, phi }, k) => {
    const bank = new T.Group();
    const frameMat = new T.MeshMatcapMaterial({ color: steel });
    bank.name = id + ' tiled divertor';
    const point = (theta: number) => {
      const [r, z] = sampleRZ(surface, nTheta, nPhi, theta, phi);
      const [ra, za] = sampleRZ(art.surfaces[0]!, nTheta, nPhi, 0, phi);
      const len = Math.hypot(r - ra, z - za) || 1;
      return new T.Vector3(...toXYZ(r + (0.12 * (r - ra)) / len, z + (0.12 * (z - za)) / len, phi));
    };
    const tiles = Array.from({ length: count }, (_, i) => {
      const step = (2 * halfSpan) / count;
      const theta = art.diverters.thetaCentre - halfSpan + (i + 0.5) * step;
      const left = point(theta - step / 2),
        right = point(theta + step / 2);
      const tan = right.clone().sub(left).normalize();
      const along = new T.Vector3(-Math.sin(phi), Math.cos(phi), 0);
      const normal = along.clone().cross(tan).normalize();
      const basis = new T.Matrix4().makeBasis(along, tan, normal);
      const m = new T.MeshBasicMaterial({ color: dark.clone() });
      const tile = new T.Mesh(segment, m);
      tile.position.copy(point(theta));
      tile.quaternion.setFromRotationMatrix(basis);
      tile.scale.set(0.97, Math.max(0.012, left.distanceTo(right) * 0.87), 0.105);
      bank.add(tile);
      const frame = new T.Mesh(segment, frameMat);
      frame.quaternion.copy(tile.quaternion);
      frame.scale.set(1.13, left.distanceTo(right) * 1.03, 0.06);
      frame.position.copy(tile.position).addScaledVector(normal, -0.065);
      bank.add(frame);
      const u = ((theta * nTheta) / (2 * Math.PI) + nTheta) % nTheta;
      return { tile, m, idx: k * nTheta + Math.floor(u), next: k * nTheta + ((Math.floor(u) + 1) % nTheta), f: u % 1 };
    });
    group.add(bank);
    return { bank, frameMat, tiles, loadsAtTiles: new Float64Array(count) };
  });
  const sweepMat = new T.MeshBasicMaterial({ color: plasmaMaterials.tracer });
  const beacon = new T.TorusGeometry(0.16, 0.022, 8, 28);
  const markers = targets.map(({ bank }) => {
    const marker = new T.Mesh(beacon, sweepMat);
    bank.add(marker);
    return marker;
  });
  return {
    group,
    update(sim: Simulation, visible?: readonly boolean[]) {
      const loads = sim.model.stripLoads(sim.state, sim.coils, sim.transfers);
      const {tileLimit, Tcool} = sim.model.params;
      targets.forEach(({ bank, frameMat, tiles, loadsAtTiles }, k) => {
        bank.visible = visible?.[k] !== false;
        const peakTile = sim.peakTileC(k);
        // The bank rim makes a narrow hot footprint visible from across the torus.
        frameMat.color.copy(steel).lerp(hot, T.MathUtils.smoothstep(peakTile, 0.85 * tileLimit, tileLimit));
        let peak = -Infinity,
          peakIndex = 0;
        tiles.forEach(({ m, idx, next, f }, i) => {
          const load = loads[idx]! * (1 - f) + loads[next]! * f;
          loadsAtTiles[i] = load;
          const temp = sim.state.tiles[idx]! * (1 - f) + sim.state.tiles[next]! * f;
          const level = Math.max(0, (temp - Tcool) / (tileLimit - Tcool));
          // Stay graphite while cool, then pass through amber into the warning colour.
          m.color.copy(dark).lerp(warm, Math.min(1, level * level));
          m.color.lerp(hot, Math.max(0, Math.min(1, (level - 0.78) / 0.22)));
          if (load > peak) {
            peak = load;
            peakIndex = i;
          }
        });
        const marker = markers[k]!;
        marker.visible = !!sim.coils[k];
        const offset = peakOffset(loadsAtTiles, peakIndex);
        const tile = tiles[peakIndex]!.tile;
        const neighbour = tiles[peakIndex + Math.sign(offset)]!.tile;
        marker.scale.setScalar(sim.coils[k]!);
        marker.position.copy(tile.position).lerp(neighbour.position, Math.abs(offset));
        marker.quaternion.copy(tile.quaternion).slerp(neighbour.quaternion, Math.abs(offset));
        marker.translateZ(0.1);
      });
    },
  };
}
