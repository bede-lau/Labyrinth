import { heatedEdge } from './heatedEdge';
import type { ModelState } from '../heatfield/model';
import type { HeatfieldArtifact } from '../heatfield/types';

type Request = { art: HeatfieldArtifact } | { state: ModelState; steps: number };
let model: ReturnType<typeof heatedEdge>;

// The visible simulation keeps stepping while this worker evolves an independent
// snapshot with all coils off for the controller's look-ahead.
self.onmessage = ({data}: MessageEvent<Request>) => {
  if ('art' in data) {
    model = heatedEdge(data.art);
    return;
  }
  const off = Array<number>(model.nDiverters).fill(0);
  const end = model.advance(data.state, off, data.steps);
  self.postMessage(model.diagnostics(end, off).peakTileC);
};
