import { bmagColor, type ThemeName } from '../../design';
import { particleMarks } from './particleMarks';
import type { ParticleTracks } from './particleTracks';
import type { TubeField } from './tubeResponse';
import { rampColor } from '../../design/sceneTheme';
import { plasmaMaterials } from '../../design/tokens';
import type { Group, MeshBasicMaterial } from 'three';
import { buildContent as buildTubes } from './FluxScene';
import { buildTargets } from './divertorTargets';
import { buildReactorHardware } from './reactorHardware';
import type { SceneModel } from './model';
import type { HeatSceneProps, SceneContent } from '../heatfield/HeatScene';
import { LUT_SIZE, writeColors } from '../heatfield/scene';
import type { HeatfieldArtifact } from '../heatfield/types';

type Three = typeof import('three');
export const HEAT_STOPS = plasmaMaterials.temperature;
export interface Layers {
  heat: boolean;
  hardware: boolean;
  particles: boolean;
  lines: boolean;
}

function heatPalette(three: Three) {
  const out = new Float32Array(LUT_SIZE * 3);
  const color = new three.Color();
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b] = rampColor(HEAT_STOPS, i / (LUT_SIZE - 1));
    color.setRGB(r, g, b, three.SRGBColorSpace).toArray(out, i * 3);
  }
  return out;
}

export function mountPlasmaLayers(three: Three, content: SceneContent, art: HeatfieldArtifact, tubes: SceneModel,
  response: TubeField, theme: ThemeName, tracks: ParticleTracks, getLayers: () => Layers) {
  const sample = buildTubes(three, tubes);
  content.group.add(sample);
  const trace = sample.getObjectByName('tube-'+response.tube.id) as import('three').Mesh<import('three').TubeGeometry>;
  const {path, tubularSegments, radialSegments} = trace.geometry.parameters;
  const rings = Array.from({length:tubularSegments+1}, (_, i) =>
    path.getUtoTmapping(i/tubularSegments, 0)*(response.tube.samples.length-1));
  const colors = trace.geometry.getAttribute('color');
  const [bMin, bMax] = response.tube.bmagRange;
  const palette = Array.from({length:256},(_,i)=>{
    const [r,g,b] = bmagColor(i/255,theme);
    return new three.Color().setRGB(r,g,b,three.SRGBColorSpace);
  });
  let lastDrive = '';

  const targets = buildTargets(three, art);
  content.group.add(targets.group);
  content.plates.visible = false; // The tiled target banks occupy these footprints.
  const heat = heatPalette(three);
  const { nPhi, nTheta } = art.grid;
  // Repeat the index buffer so a moving cutaway can cross 0 degrees without moving its vertices.
  const shell = content.surface.geometry;
  const index = shell.index!;
  const repeated = new Uint32Array(2 * index.count);
  repeated.set(index.array);
  repeated.set(index.array, index.count);
  shell.setIndex(new three.BufferAttribute(repeated, 1));
  const material = content.surface.material as MeshBasicMaterial;
  // Interpolate the scalar first, then evaluate its colour at each rendered
  // pixel. Zoom retains the palette's isotherms between solver samples.
  const temperature = new three.Float32BufferAttribute(new Float32Array(nTheta*nPhi),1);
  temperature.setUsage(three.DynamicDrawUsage);
  shell.setAttribute('edgeTemperature', temperature);
  const heatMode = {value: false};
  const heatRange = {value: new three.Vector2()};
  material.onBeforeCompile = shader => {
    shader.uniforms.showEdgeHeat = heatMode;
    shader.uniforms.edgeRange = heatRange;
    shader.uniforms.edgePalette = {value: HEAT_STOPS.map(stop => new three.Color(stop))};
    shader.vertexShader = 'attribute float edgeTemperature; varying float vEdgeT;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvEdgeT = edgeTemperature;');
    shader.fragmentShader = 'varying float vEdgeT; uniform bool showEdgeHeat; uniform vec2 edgeRange; uniform vec3 edgePalette[6];\n' +
      shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (showEdgeHeat) {
        float t = 5.0 * clamp((vEdgeT-edgeRange.x)/(edgeRange.y-edgeRange.x),0.0,1.0);
        int i = min(4,int(floor(t)));
        diffuseColor.rgb = mix(edgePalette[i],edgePalette[i+1],t-float(i));
      }`);
  };
  material.transparent = true;
  material.opacity = 0.94;
  material.depthWrite = false;
  content.surface.renderOrder = 1;
  content.outline.visible = false;
  const N = art.surfaces.length * nTheta;
  const section = new three.BufferGeometry();
  const position = new three.Float32BufferAttribute(new Float32Array(N * 3), 3);
  const color = new three.Float32BufferAttribute(new Float32Array(N * 3), 3);
  section.setAttribute('position', position);
  section.setAttribute('color', color);
  const faces: number[] = [];
  for (let m = 1; m < art.surfaces.length; m++) {
    for (let i = 0; i < nTheta; i++) {
      const a = (m - 1) * nTheta + i;
      const b = (m - 1) * nTheta + (i + 1) % nTheta;
      faces.push(a, a + nTheta, b + nTheta, a, b + nTheta, b);
    }
  }
  section.setIndex(faces);
  const cap = new three.Mesh(section, new three.MeshBasicMaterial({ vertexColors: true, side: three.DoubleSide }));
  cap.name = 'Thermal cross-section';
  cap.frustumCulled = false;
  content.group.add(cap);

  // Follow the innermost VMEC surface through the torus. A translucent
  // cutaway reveals the heating core until the edge fills in around it.
  const axis = art.surfaces[0]!;
  const spine = Array.from({length: nPhi}, (_, j) => {
    const phi = 2 * Math.PI * j / nPhi;
    const r = axis.R[j * nTheta]!;
    return new three.Vector3(r * Math.cos(phi), r * Math.sin(phi), axis.Z[j * nTheta]!);
  });
  const corePath = new three.CatmullRomCurve3(spine, true);
  const core = new three.Group();
  core.name = 'Toroidal heating core';
  const glow = [0.075, 0.16, 0.28].map(radius => {
    const material = new three.MeshBasicMaterial({color: plasmaMaterials.tracer, transparent: true, depthWrite: false});
    const tube = new three.Mesh(new three.TubeGeometry(corePath, 144, radius, 10, true), material);
    core.add(tube);
    return material;
  });
  content.group.add(core);
  const particles = particleMarks(three, tracks);
  content.group.add(particles.group);

  let lastPlane = -1;
  let hardware: Group | undefined;
  return (frame: HeatSceneProps) => {
    const layers = getLayers();
    targets.update(frame.sim, frame.visiblePlates);
    const drive = frame.model.drive(frame.sim.coils,frame.sim.absoluteTime).join(',');
    if (drive !== lastDrive) {
      const {field} = response.read();
      rings.forEach((u, index)=>{
        const a = Math.min(field.length-2,Math.floor(u)), f = u-a;
        const strength = field[a]!*(1-f)+field[a+1]!*f;
        const bin = Math.round(255*Math.max(0,Math.min(1,(strength-bMin)/(bMax-bMin))));
        const color = palette[bin]!;
        for(let k=0;k<=radialSegments;k++) colors.setXYZ(index*(radialSegments+1)+k,color.r,color.g,color.b);
      });
      colors.needsUpdate = true;
      lastDrive = drive;
    }
    const time = frame.sim.time;
    const fill = three.MathUtils.smoothstep(time, 0.45, 3.6);
    material.opacity = 0.12 + 0.82 * fill;
    content.surface.visible = layers.heat;
    cap.visible = layers.heat && time > 0;
    core.visible = layers.heat && time > 0 && fill < 1;
    sample.children[0]!.visible = !layers.heat;
    sample.children[1]!.visible = !layers.heat;
    if (layers.hardware && !hardware) {
      hardware = buildReactorHardware(three);
      content.group.add(hardware);
    }
    if (hardware) hardware.visible = layers.hardware;
    const j = frame.sliceJ;
    if (j !== lastPlane) {
      const phi = 2 * Math.PI * j / nPhi;
      for (const [m, surface] of art.surfaces.entries()) {
        for (let i = 0; i < nTheta; i++) {
          const k = j * nTheta + i;
          position.setXYZ(m * nTheta + i, surface.R[k]! * Math.cos(phi), surface.R[k]! * Math.sin(phi), surface.Z[k]!);
        }
      }
      position.needsUpdate = true;
      shell.setDrawRange(j * nTheta * 6, Math.round(nPhi * 0.72) * nTheta * 6);
      lastPlane = j;
    }
    heatMode.value = layers.heat;
    if (layers.heat) {
      temperature.array.set(frame.sim.state.T);
      temperature.needsUpdate = true;
      heatRange.value.set(...frame.ranges.lcfsT);
      const xs = frame.model.crossSection(frame.sim.state, frame.sim.coils, j);
      if (core.visible) {
        const energy = three.MathUtils.clamp(xs.T[0]! / frame.model.params.Tcore0, 0, 1);
        const gain = energy * (1 - fill);
        glow[0]!.opacity = gain;
        glow[1]!.opacity = 0.45 * gain;
        glow[2]!.opacity = 0.2 * gain;
        glow[1]!.color.set(HEAT_STOPS[3]);
        glow[2]!.color.set(HEAT_STOPS[4]);
      }
      writeColors(xs.T, frame.ranges.sliceT, heat, color.array as Float32Array);
      color.needsUpdate = true;
    }
    particles.group.visible = layers.particles && time > 0;
    if (layers.particles) particles.update(frame.followed);
  };
}
