import type { HeatTransfer } from '../heatfield/loadBalance';
import { sampleRZ, toXYZ } from '../heatfield/scene';
import type { HeatfieldArtifact } from '../heatfield/types';
import { plasmaMaterials } from '../../design/tokens';

type Three = typeof import('three');

// Each guide follows the short toroidal arc between its two strike footprints.
// The arrowheads point toward the receiver even when the clock is paused.
export function buildTransferGuides(T: Three, art: HeatfieldArtifact) {
  const sites = art.diverters.items;
  const edge = art.surfaces.at(-1)!;
  const {nTheta, nPhi} = art.grid;
  const group = new T.Group();
  group.name = 'Heat transfer routes';
  const dashes = 18;
  const cylinder = new T.CylinderGeometry(1, 1, 1, 8);
  const arrow = new T.ConeGeometry(0.12, 0.34, 12);
  const outline = new T.MeshBasicMaterial({
    color: plasmaMaterials.targetCold, transparent: true, depthTest: false, depthWrite: false,
  });
  const up = new T.Vector3(0,1,0);
  const guides = sites.map((site, from) => {
    const color = plasmaMaterials.particleColours[from]!;
    const material = new T.MeshBasicMaterial({color, transparent: true, depthTest: false, depthWrite: false});
    const rim = new T.InstancedMesh(cylinder, outline, dashes);
    const fill = new T.InstancedMesh(cylinder, material, dashes);
    rim.frustumCulled = fill.frustumCulled = false;
    rim.renderOrder = 5;
    fill.renderOrder = 6;
    const tips = [new T.Mesh(arrow, material), new T.Mesh(arrow, material)];
    tips.forEach(tip => { tip.renderOrder = 7; });
    const route = new T.Group();
    route.visible = false;
    route.add(rim, fill, ...tips);
    group.add(route);
    let destination = -1;
    return (to: number | undefined) => {
      route.visible = to !== undefined;
      if (to === undefined || destination === to) return;
      destination = to;
      route.name = site.id + ' → ' + sites[to]!.id;
      const delta = sites[to]!.phi - site.phi;
      const span = Math.atan2(Math.sin(delta), Math.cos(delta));
      const point = (f: number) => {
        const phi = site.phi + f*span;
        const theta = art.diverters.thetaCentre + 0.35*edge.iota*Math.sin(sites.length*f*span);
        const [r,z] = sampleRZ(edge, nTheta, nPhi, theta, phi);
        return new T.Vector3(...toXYZ(r,z,phi));
      };
      const dash = new T.Object3D();
      for (let i = 0; i < dashes; i++) {
        const start = point(i/dashes), end = point((i+0.73)/dashes);
        dash.position.copy(start).lerp(end, 0.5);
        const direction = end.clone().sub(start);
        const length = direction.length();
        dash.quaternion.setFromUnitVectors(up, direction.normalize());
        dash.scale.set(0.047, length, 0.047);
        dash.updateMatrix();
        rim.setMatrixAt(i, dash.matrix);
        dash.scale.set(0.029, length, 0.029);
        dash.updateMatrix();
        fill.setMatrixAt(i, dash.matrix);
      }
      rim.instanceMatrix.needsUpdate = fill.instanceMatrix.needsUpdate = true;
      tips.forEach((tip,i) => {
        const f = i === 0 ? 0.46 : 0.88;
        tip.position.copy(point(f));
        tip.quaternion.setFromUnitVectors(up, point(f+0.005).sub(point(f-0.005)).normalize());
      });
    };
  });
  return {group, update(transfers: readonly HeatTransfer[], visible?: readonly boolean[]) {
    guides.forEach((setTarget, from) => {
      const route = transfers.find(r => r.from === from);
      setTarget(route && visible?.[from] !== false && visible?.[route.to] !== false ? route.to : undefined);
    });
  }};
}
