// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideLoop, LoopController, type LoopOutcome } from '../heatfield/loopPolicy';
import type { HeatfieldArtifact } from '../heatfield/types';
import { fiveTargetScenario, heatedEdge, startupSimulation } from './heatedEdge';

// The worker is a thin message handler around decideLoop: drive its handler directly, as a Worker would.
test('the forecast worker answers a loop request with the decision a synchronous call makes', async () => {
  const art: HeatfieldArtifact = fiveTargetScenario(JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')));
  const posted: LoopOutcome[] = [];
  const scope = { onmessage: undefined as undefined | ((e: MessageEvent) => void), postMessage: (m: LoopOutcome) => posted.push(m) };
  (globalThis as unknown as { self: typeof scope }).self = scope;
  await import('./thermalForecast.worker');
  expect(scope.onmessage).toBeTypeOf('function');
  scope.onmessage!({ data: { art } } as MessageEvent);

  const sim = startupSimulation(art);
  sim.advance(6500);
  const request = new LoopController(sim, 0.25, true).request();
  scope.onmessage!({ data: { request } } as MessageEvent);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toEqual(decideLoop(heatedEdge(art), request));
  expect(posted[0]!.coils).toEqual([1, 1, 1, 1, 1]);
});
