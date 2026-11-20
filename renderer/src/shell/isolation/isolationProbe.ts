// F13 / FE2-7: per-file isolation probe. isolationA.probe.ts and isolationB.probe.ts each check that nothing
// the other one leaves behind is visible, then leave all of it behind themselves. In the main run two files
// may land in different workers, which would prove nothing, so the pair is not part of it: build.test.ts runs
// exactly these two files in ONE worker (a child vitest run with isolation.config.ts), where the second file
// would see the first one's leftovers if test files shared a context, and checks from the log that they did
// share the worker.
import { appendFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';
import { liveStatusStore, type LiveStatus } from '../../lib/liveStatus';

export const PROBE = 'labyrinth-isolation-probe';
/** Set by build.test.ts for its child run only: the file each probe appends its worker to. */
export const LOG_ENV = 'LABYRINTH_ISOLATION_LOG';

type Bag = Record<string, unknown>;

/** What a file sees of the probe's leftovers. `CLEAN` when nothing leaked in. */
export function leftovers(): Bag {
  return {
    global: (globalThis as Bag).__labyrinthIsolationProbe ?? null,
    prototype: (Element.prototype as unknown as Bag).__labyrinthIsolationProbe ?? null,
    node: document.getElementById(PROBE)?.textContent ?? null,
    hash: location.hash,
    storage: localStorage.getItem(PROBE),
    fetch: (globalThis.fetch as unknown as Bag | undefined)?.__labyrinthIsolationProbe ?? null,
    store: liveStatusStore.getState().status,
  };
}

export const CLEAN: Bag = { global: null, prototype: null, node: null, hash: '', storage: null, fetch: null, store: 'connecting' };

const SNAPSHOT: LiveStatus = {
  schemaVersion: 1,
  mode: 'idle',
  reason: 'isolation probe',
  budget: { ceilingUsd: 40, billedUsd: 0, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true },
  workers: [],
  fallback: { active: false, label: '', savedRunId: null },
};

/** Leave a global, a prototype patch, a DOM node, a hash, storage, a stubbed fetch and store state behind. */
export function leaveEverythingBehind(file: string): void {
  (globalThis as Bag).__labyrinthIsolationProbe = file;
  (Element.prototype as unknown as Bag).__labyrinthIsolationProbe = file;
  const node = document.createElement('p');
  node.id = PROBE;
  node.textContent = file;
  document.body.append(node);
  location.hash = `#${PROBE}`;
  localStorage.setItem(PROBE, file);
  vi.stubGlobal('fetch', Object.assign(async () => new Response('{}'), { __labyrinthIsolationProbe: file }));
  liveStatusStore.apply(SNAPSHOT);
  // `process` is the worker's real one (vitest gives every VM context the same object): it identifies the worker.
  const log = process.env[LOG_ENV];
  if (log) appendFileSync(log, `${JSON.stringify({ file, pid: process.pid, threadId })}\n`);
}

/** What `leaveEverythingBehind(file)` leaves visible in its own file. */
export const planted = (file: string): Bag => ({
  global: file,
  prototype: file,
  node: file,
  hash: `#${PROBE}`,
  storage: file,
  fetch: file,
  store: 'ready',
});
