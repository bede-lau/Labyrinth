// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { buildContent, type HeatSceneProps } from '../heatfield/HeatScene';
import { createParticleTracks } from './particleTracks';
import { fiveTargetScenario } from './heatedEdge';
import { createModel } from '../heatfield/model';
import { buildSceneGeometry, colourRanges } from '../heatfield/scene';
import { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';
import { buildSceneModel } from './model';
import { mountPlasmaLayers } from './plasmaLayers';
import { createTubeField } from './tubeResponse';
import type { GeometryArtifact } from './types';

const load = (name: string) => JSON.parse(readFileSync(resolve(__dirname,'../../../../artifacts/'+name+'.json'),'utf8'));

test('five numbered tracers follow the live readout and the sectional solenoid follows hardware visibility', () => {
  const art: HeatfieldArtifact = fiveTargetScenario(load('heatfield'));
  const geometry: GeometryArtifact = load('geometry');
  const model = createModel(art);
  const sim = new Simulation(model,model.initialState());
  const geom = buildSceneGeometry(art,model,model.heatFlow(sim.state,sim.coils));
  const content = buildContent(THREE,geom,'light');
  const tube = geometry.tubes.find(t=>t.id==='bean')!;
  const response = createTubeField(art,sim,tube,geometry.surface.rho);
  const layers = {heat:true,field:false,hardware:true,particles:true,lines:false};
  const tracks = createParticleTracks(art,sim);
  const update = mountPlasmaLayers(THREE,content,art,buildSceneModel(geometry,'bean','light'),response,'light',tracks,()=>layers);
  const frame:HeatSceneProps = {model,sim,geom,ranges:colourRanges(art,model,sim.state.T),theme:'light',
    colorBy:'temperature',showArrows:false,showLines:false,sliceJ:0,label:'test'};
  update(frame);
  const solenoid = content.group.getObjectByName('Tokamak central solenoid · comparison model')!;
  expect(solenoid.getObjectByName('Exposed helical winding')).toMatchObject({count:6});
  expect(solenoid.getObjectByName('Hex head')).toMatchObject({count:16});
  const particles = content.group.getObjectByName('Plasma tracers')!;
  expect(particles.children.filter(mark => mark.name.startsWith('P'))).toHaveLength(5);
  sim.advance(30);
  update(frame);
  for (const row of tracks.read()) {
    const head = particles.getObjectByName('P'+row.id) as THREE.Points;
    const pos = head.geometry.getAttribute('position');
    expect([pos.getX(0),pos.getY(0),pos.getZ(0)]).toEqual(Array.from(Float32Array.from(row.position)));
    expect(row.field).toBeGreaterThan(0);
  }
  // No heat-transfer routes are drawn: nothing pipes heat between targets (D-031); the coils change the shares (D-035).
  expect(content.group.getObjectByName('Heat transfer routes')).toBeUndefined();
  update({...frame,followed: 3});
  for (const row of tracks.read()) {
    expect(particles.getObjectByName('P'+row.id)!.visible).toBe(row.id === 3);
  }
  update(frame);
  expect(particles.getObjectByName('P1')!.visible).toBe(true);
  layers.particles=false;layers.hardware=false;update(frame);
  expect(particles.visible).toBe(false);
  expect(solenoid.parent!.visible).toBe(false);
});
