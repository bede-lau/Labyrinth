// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { Plugin, PluginOption } from 'vite';
import config, { DEFAULT_MAX_TEST_WORKERS, copyArtifacts, resolveArtifactRequest, serveArtifacts, testMaxWorkers } from '../../vite.config';
import isolationConfig, { PROBE_FILES } from './isolation/isolation.config';
import { LOG_ENV } from './isolation/isolationProbe';

const ARTIFACTS = resolve(__dirname, '../../../artifacts');
const RENDERER = resolve(__dirname, '../..');

type Hook = (this: unknown, ...args: unknown[]) => unknown;
const call = (h: unknown, ...args: unknown[]) => (typeof h === 'function' ? (h as Hook) : (h as { handler: Hook }).handler).call({}, ...args);

const flat = (opts: PluginOption[] | undefined): Plugin[] =>
  (opts ?? []).flatMap((p) => (Array.isArray(p) ? flat(p) : p && typeof p === 'object' && 'name' in p ? [p as Plugin] : []));

test('A5 static build copies artifacts/*.json into <outDir>/artifacts so replay needs no backend', () => {
  // The real config registers the build-only copier.
  const plugin = flat(config.plugins as PluginOption[]).find((p) => p.name === 'labyrinth-artifacts');
  expect(plugin).toBeDefined();
  expect(plugin?.apply).toBe('build');

  // Run its hooks against a temporary outDir and compare byte for byte with ../artifacts.
  const root = mkdtempSync(join(tmpdir(), 'lab-build-'));
  try {
    const p = copyArtifacts();
    call(p.configResolved, { root, build: { outDir: 'dist' } });
    call(p.closeBundle);
    const expected = readdirSync(ARTIFACTS).filter((f) => f.endsWith('.json')).sort();
    expect(expected).toEqual(expect.arrayContaining(['manifest.json', 'geometry.json', 'spatial.json']));
    const copied = readdirSync(join(root, 'dist', 'artifacts')).filter((f) => f.endsWith('.json')).sort();
    expect(copied).toEqual(expected);
    for (const f of expected) {
      expect(readFileSync(join(root, 'dist', 'artifacts', f), 'utf8')).toBe(readFileSync(join(ARTIFACTS, f), 'utf8'));
    }
    // And a missing source fails the build loudly instead of shipping an empty replay.
    const broken = copyArtifacts(join(root, 'does-not-exist'));
    call(broken.configResolved, { root, build: { outDir: 'dist2' } });
    expect(() => call(broken.closeBundle)).toThrow(/not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---- dev middleware for /artifacts (FE-10) --------------------------------------------------- */
type Handler = (req: { url?: string }, res: PassThrough & { setHeader: (k: string, v: string) => void; statusCode?: number }, next: (e?: unknown) => void) => void;

/** Run a serve plugin's /artifacts middleware once and report what it did. */
async function request(plugin: Plugin, url: string) {
  let handler: Handler | null = null;
  let mount = '';
  call(plugin.configureServer, { middlewares: { use: (path: string, fn: Handler) => ((mount = path), (handler = fn)) } });
  expect(mount).toBe('/artifacts');
  const headers: Record<string, string> = {};
  const res = Object.assign(new PassThrough(), { setHeader: (k: string, v: string) => void (headers[k] = v) });
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  const next = vi.fn();
  const done = new Promise<void>((r) => {
    res.on('end', r);
    next.mockImplementation(() => r());
  });
  handler!({ url }, res, next);
  await Promise.race([done, new Promise((r) => setTimeout(r, 500))]);
  return { next, headers, body: Buffer.concat(chunks).toString('utf8') };
}

test('FE-10 the dev middleware serves only regular files inside ../artifacts (real config plugin)', async () => {
  const plugin = flat(config.plugins as PluginOption[]).find((p) => p.name === 'labyrinth-artifacts-serve');
  expect(plugin?.apply).toBe('serve');
  // A real artifact is streamed as JSON, byte for byte.
  const ok = await request(plugin!, '/spatial.json?t=1');
  expect(ok.next).not.toHaveBeenCalled();
  expect(ok.headers['Content-Type']).toBe('application/json');
  expect(ok.body).toBe(readFileSync(join(ARTIFACTS, 'spatial.json'), 'utf8'));
  // GET /artifacts/ is the directory itself: it used to be piped (EISDIR). It must fall through untouched.
  for (const url of ['/', '', '/?x=1', '/.']) {
    const dir = await request(plugin!, url);
    expect(dir.next, `url ${JSON.stringify(url)}`).toHaveBeenCalledTimes(1);
    expect(dir.next).toHaveBeenCalledWith();
    expect(dir.headers).toEqual({});
    expect(dir.body).toBe('');
  }
  // Missing files and anything outside the folder fall through as well.
  for (const url of ['/nope.json', '/../package.json', '/../renderer/package.json', '/..%2f..%2fCLAUDE.md']) {
    const out = await request(plugin!, url);
    expect(out.next, `url ${url}`).toHaveBeenCalledWith();
    expect(out.headers).toEqual({});
  }
});

test('FE-10 path containment is by whole path segments, not by string prefix: a sibling "artifacts-*" folder is not served', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lab-serve-'));
  try {
    const root = join(base, 'artifacts');
    mkdirSync(join(root, 'sub'), { recursive: true });
    mkdirSync(join(base, 'artifacts-private'));
    writeFileSync(join(root, 'a.json'), '{"a":1}');
    writeFileSync(join(root, 'sub', 'b.json'), '{"b":2}');
    writeFileSync(join(base, 'artifacts-private', 'secret.json'), '{"secret":true}');
    writeFileSync(join(base, 'outside.json'), '{"outside":true}');

    expect(resolveArtifactRequest(root, '/a.json')).toBe(join(root, 'a.json'));
    expect(resolveArtifactRequest(root, '/a.json?cache=1')).toBe(join(root, 'a.json'));
    expect(resolveArtifactRequest(root, '/sub/b.json')).toBe(join(root, 'sub', 'b.json'));
    // The sibling shares the string prefix "<base>/artifacts" — the old startsWith() check admitted it.
    expect(join(base, 'artifacts-private', 'secret.json').startsWith(root)).toBe(true);
    expect(resolveArtifactRequest(root, '/../artifacts-private/secret.json')).toBeNull();
    expect(resolveArtifactRequest(root, '/../outside.json')).toBeNull();
    expect(resolveArtifactRequest(root, '/')).toBeNull(); // the folder itself
    expect(resolveArtifactRequest(root, '/sub')).toBeNull(); // a directory
    expect(resolveArtifactRequest(root, '/sub/')).toBeNull();
    expect(resolveArtifactRequest(root, '/missing.json')).toBeNull();
    expect(resolveArtifactRequest(root, undefined)).toBeNull();

    const plugin = serveArtifacts(root);
    const leak = await request(plugin, '/../artifacts-private/secret.json');
    expect(leak.next).toHaveBeenCalledWith();
    expect(leak.body).toBe('');
    expect((await request(plugin, '/sub/b.json')).body).toBe('{"b":2}');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('F13 FA-5 test workers: VITEST_MAX_WORKERS wins, otherwise at most 4 and one core left free; files keep their own VM context', () => {
  expect(testMaxWorkers({ VITEST_MAX_WORKERS: '2' }, 16)).toBe(2);
  expect(testMaxWorkers({ VITEST_MAX_WORKERS: '12' }, 16)).toBe(12); // an explicit request is honoured
  // Unset or unusable: the cap, never one worker per core.
  for (const value of [undefined, '', '0', '-3', 'four', '2.5', '50%']) {
    expect(testMaxWorkers({ VITEST_MAX_WORKERS: value }, 16), String(value)).toBe(DEFAULT_MAX_TEST_WORKERS);
  }
  expect(DEFAULT_MAX_TEST_WORKERS).toBe(4);
  expect(testMaxWorkers({}, 3)).toBe(2);
  expect(testMaxWorkers({}, 1)).toBe(1);
  // The real config: a VM-context pool (per-file isolation, one jsdom per worker), capped, with a memory limit.
  const test = (config as { test?: { pool?: string; maxWorkers?: number; vmMemoryLimit?: string; isolate?: boolean } }).test;
  expect(test?.pool).toBe('vmThreads');
  expect(test?.isolate).not.toBe(false);
  expect(test?.maxWorkers).toBe(testMaxWorkers());
  expect(test?.vmMemoryLimit).toBe('1024MB');
});

/** Run vitest in a child process (async: this worker keeps answering its own runner meanwhile). */
function childVitest(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [join(RENDERER, 'node_modules', 'vitest', 'vitest.mjs'), ...args],
      { cwd: RENDERER, env, timeout: 150_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout}\n${stderr}` }),
    );
  });
}

test('F13 FA-5 FE2-7 per-file isolation under the pool, deterministically: two probe files in ONE worker see nothing of each other', async () => {
  // In the main run two files may land in different workers, which would prove nothing, so the probe pair is
  // not part of it (*.probe.ts). Here it runs alone, in one worker, with the main config's pool and environment
  // (isolation.config.ts): the second file runs in the worker where the first left everything behind.
  expect(isolationConfig.test?.pool).toBe(config.test?.pool);
  expect(isolationConfig.test?.environment).toBe(config.test?.environment);
  expect(isolationConfig.test?.include).toEqual(PROBE_FILES);
  const dir = mkdtempSync(join(tmpdir(), 'lab-iso-'));
  try {
    const log = join(dir, 'workers.jsonl');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('VITEST')) env[k] = v;
    const run = await childVitest(['run', '--config', 'src/shell/isolation/isolation.config.ts'], {
      ...env,
      VITEST_MAX_WORKERS: '1',
      NO_COLOR: '1',
      [LOG_ENV]: log,
    });
    expect(run.code, run.out).toBe(0);
    expect(run.out.replace(/\u001b\[[0-9;]*m/g, '')).toMatch(/Test Files\s+2 passed \(2\)/);
    const rows = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { file: string; pid: number; threadId: number });
    expect(rows.map((r) => r.file).sort()).toEqual(['isolationA', 'isolationB']);
    expect(new Set(rows.map((r) => `${r.pid}/${r.threadId}`)).size, JSON.stringify(rows)).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 180_000);

test('FE-10 a read error after the checks is handed to next(err) instead of crashing the dev server', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lab-serve-'));
  try {
    writeFileSync(join(base, 'a.json'), '{"a":1}');
    const boom = new Error('EIO: i/o error, read');
    // The file passes the checks, then the stream fails (deleted or unreadable in between).
    const failing = () => new Readable({ read() { this.destroy(boom); } });
    const out = await request(serveArtifacts(base, failing as never), '/a.json');
    expect(out.next).toHaveBeenCalledTimes(1);
    expect(out.next).toHaveBeenCalledWith(boom);
    expect(out.body).toBe('');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
