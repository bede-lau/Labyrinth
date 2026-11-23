import { heatedEdge } from './heatedEdge';
import { decideLoop, type LoopRequest } from '../heatfield/loopPolicy';
import type { HeatfieldArtifact } from '../heatfield/types';

type Request = { art: HeatfieldArtifact } | { request: LoopRequest };
let model: ReturnType<typeof heatedEdge>;

// The visible simulation keeps stepping while this worker evolves independent snapshots of it: the controller's
// look-ahead with the coils as they are now, and the candidate transfer and release look-aheads (loopPolicy.ts).
self.onmessage = ({data}: MessageEvent<Request>) => {
  if ('art' in data) {
    model = heatedEdge(data.art);
    return;
  }
  self.postMessage(decideLoop(model, data.request));
};
