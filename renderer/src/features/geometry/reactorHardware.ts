import { plasmaMaterials } from '../../design/tokens';
/// <reference types="vite/client" />
import hardware from './hardware/w7x-hardware.json';
import solenoid from './hardware/solenoid.json';
import sourceNotice from './hardware/SOURCES.md?raw';

type Three = typeof import('three');

// Blender exports little-endian positions in millimetres and indexed triangle faces.
function shorts(encoded: string, signed: boolean): number[] {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 2 }, (_, i) =>
    signed ? view.getInt16(i * 2, true) / 1000 : view.getUint16(i * 2, true),
  );
}

function hardwareMesh(THREE: Three, coords: string, triangles: number[]): import('three').BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(shorts(coords, true), 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}

/** Blender meshes in the scene's metre / Z-up frame. Toggle visibility on the returned group. */
export function buildReactorHardware(THREE: Three): import('three').Group {
  const assembly = new THREE.Group();
  assembly.name = 'W7-X vessel and superconducting coils';
  assembly.userData.source = sourceNotice;
  const coilIndex = shorts(hardware.coilTriangles, false);
  const coils = hardware.coilPositionMM.map((positions) => hardwareMesh(THREE, positions, coilIndex));
  const vessel = hardwareMesh(THREE, hardware.vesselPositionMM, shorts(hardware.vesselTriangles, false));

  // Matcap's built-in view-dependent gradient models the curved metal without adding lights.
  const coilMaterials = plasmaMaterials.windings.map((color) =>
    new THREE.MeshMatcapMaterial({ color, transparent: true, opacity: 0.81, depthWrite: false }),
  );
  const shell = new THREE.MeshMatcapMaterial({
    color: plasmaMaterials.vessel, side: THREE.DoubleSide, transparent: true, opacity: 0.12, depthWrite: false,
  });
  shell.forceSinglePass = true;

  const sectors = 5;
  const chamber = new THREE.InstancedMesh(vessel, shell, sectors);
  chamber.name = 'Plasma vessel';
  const support = new THREE.InstancedMesh(
    hardwareMesh(THREE, hardware.supportPositionMM, shorts(hardware.supportTriangles, false)),
    new THREE.MeshMatcapMaterial({ color: plasmaMaterials.vessel }), sectors,
  );
  support.name = 'Central coil support ring (schematic)';
  assembly.add(chamber, support);

  // A single draw per winding family keeps changing heat frames responsive.
  const windings = coils.map((geometry, index) => {
    const planar = index >= 5;
    const coil = new THREE.InstancedMesh(geometry, coilMaterials[planar ? 1 : 0], sectors * 2);
    coil.name = planar ? 'Planar coil' : 'Nonplanar coil';
    assembly.add(coil);
    return coil;
  });
  const flip = new THREE.Matrix4().makeRotationX(Math.PI);
  for (let sector = 0; sector < sectors; sector++) {
    const turn = new THREE.Matrix4().makeRotationZ(sector * 2 * Math.PI / sectors);
    chamber.setMatrixAt(sector, turn);
    support.setMatrixAt(sector, turn);
    // Stellarator symmetry is (x,y,z) → (x,−y,−z) in this Cartesian frame.
    const mirrored = turn.clone().multiply(flip);
    for (const winding of windings) {
      winding.setMatrixAt(2 * sector, turn);
      winding.setMatrixAt(2 * sector + 1, mirrored);
    }
  }
  const comparison = new THREE.Group();
  comparison.name = 'Tokamak central solenoid · comparison model';
  const finishes: Record<string, string> = plasmaMaterials.solenoid;
  for (const part of solenoid) {
    const mesh = new THREE.InstancedMesh(
      hardwareMesh(THREE, part.coords, shorts(part.triangles, false)),
      new THREE.MeshMatcapMaterial({ color: finishes[part.material], side: THREE.DoubleSide }),
      part.instances.length,
    );
    mesh.name = part.name;
    part.instances.forEach(([x,y,z,angle], index) => {
      mesh.setMatrixAt(index, new THREE.Matrix4().makeRotationZ(angle!).setPosition(x!,y!,z!));
    });
    comparison.add(mesh);
  }
  assembly.add(comparison);
  return assembly;
}
