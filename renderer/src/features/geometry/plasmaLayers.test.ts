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
  const layers = {heat:true,hardware:true,particles:true,lines:false};
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
  const routes = content.group.getObjectByName('Heat transfer routes')!;
  expect(routes.children.every(r => !r.visible)).toBe(true);
  sim.setCoils([1,0,1,0,0],[{from:0,to:4,fraction:0.1},{from:2,to:3,fraction:0.05}]);
  update(frame);
  expect(routes.children.map(r => r.visible)).toEqual([true,false,true,false,false]);
  const endAngle = (from: number) => {
    // The dashes flow, so check the one closest to the receiver.
    const dashes = routes.children[from]!.children[0] as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    return Array.from({length: dashes.count}, (_, i) => {
      dashes.getMatrixAt(i, matrix);
      const p = new THREE.Vector3().setFromMatrixPosition(matrix);
      return Math.atan2(p.y, p.x);
    });
  };
  for (const {from,to} of sim.commandedTransfers) {
    const gaps = endAngle(from).map(a => Math.abs(Math.atan2(Math.sin(a - art.diverters.items[to]!.phi), Math.cos(a - art.diverters.items[to]!.phi))));
    expect(Math.min(...gaps)).toBeLessThan(0.08);
  }
  update({...frame,followed: 3});
  expect(routes.children.map(r => r.visible)).toEqual([false,false,true,false,false]);
  for (const row of tracks.read()) {
    expect(particles.getObjectByName('P'+row.id)!.visible).toBe(row.id === 3);
  }
  update(frame);
  expect(particles.getObjectByName('P1')!.visible).toBe(true);
  update({...frame,visiblePlates:[true,true,true,true,false]});
  expect(routes.children[0]!.visible).toBe(false);
  expect(routes.children[2]!.visible).toBe(true);
  sim.setCoils([0,0,0,0,0]);
  update(frame);
  expect(routes.children.every(r => !r.visible)).toBe(true);
  layers.particles=false;layers.hardware=false;update(frame);
  expect(routes.visible).toBe(false);
  expect(particles.visible).toBe(false);
  expect(solenoid.parent!.visible).toBe(false);
});
