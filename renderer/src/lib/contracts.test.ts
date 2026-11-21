// @vitest-environment node
// Contract test: every committed artifact validates against the shared JSON
// Schemas in ../contracts — the same schemas main/ validates against.
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTRACTS = resolve(__dirname, '../../../contracts');
const ARTIFACTS = resolve(__dirname, '../../../artifacts');

function ajv(edit: Record<string, (schema: any) => void> = {}) {
  const a = new Ajv2020({ allErrors: true, strict: false });
  for (const f of readdirSync(CONTRACTS).filter((f) => f.endsWith('.schema.json'))) {
    const s = JSON.parse(readFileSync(resolve(CONTRACTS, f), 'utf8'));
    edit[f]?.(s);
    a.addSchema(s, f);
  }
  return a;
}

/** Parsed JSON, edited in place by the negative cases. */
type Json = any;
const readArtifact = (path: string): Json => JSON.parse(readFileSync(resolve(ARTIFACTS, path), 'utf8'));
const PROVENANCE_KINDS = JSON.parse(readFileSync(resolve(CONTRACTS, 'common.schema.json'), 'utf8')).$defs.provenance.properties.kind
  .enum as string[];

test('D-028 heatfield: ajv rejects every provenance kind but model and every geometryProvenance kind but derived (the allOf pins)', () => {
  // The renderer's validator must read the pins as main/'s jsonschema does (RV-BE-M2): $ref beside a properties
  // const inside allOf.
  const a = ajv();
  const art = readArtifact('heatfield.json');
  const valid = (x: Json) => a.validate('heatfield.schema.json', x) as boolean;
  expect(valid(art), JSON.stringify(a.errors?.slice(0, 3))).toBe(true);
  expect(PROVENANCE_KINDS).toEqual(expect.arrayContaining(['model', 'derived', 'archive', 'prd-reported', 'live', 'rehearsal']));
  for (const kind of [...PROVENANCE_KINDS, 'measured']) {
    const p = structuredClone(art);
    p.provenance.kind = kind;
    expect(valid(p), `provenance.kind = ${kind}`).toBe(kind === 'model');
    const g = structuredClone(art);
    g.geometryProvenance.kind = kind;
    expect(valid(g), `geometryProvenance.kind = ${kind}`).toBe(kind === 'derived');
  }
  // Both swapped at once: model output labelled as data and the VMEC geometry labelled as model.
  const swapped = structuredClone(art);
  swapped.provenance.kind = 'derived';
  swapped.geometryProvenance.kind = 'model';
  expect(valid(swapped)).toBe(false);
  // Negative control: without the pins (only the $ref left in each allOf) the same swap passes, so the cases above
  // test the pins and nothing else.
  const unpinned = ajv({
    'heatfield.schema.json': (s) => {
      for (const k of ['provenance', 'geometryProvenance']) s.properties[k].allOf = s.properties[k].allOf.filter((p: any) => '$ref' in p);
    },
  });
  expect(unpinned.validate('heatfield.schema.json', swapped)).toBe(true);
});

test('D-028 forecast errorStats: ajv holds every value null exactly when n = 0 (the if/then/else), in both directions', () => {
  const a = ajv();
  const art = readArtifact('forecast.json');
  const real = art.errorStats.persistence;
  expect(real.n).toBeGreaterThan(0);
  const withStat = (stat: Json) => {
    const c = structuredClone(art);
    c.errorStats.persistence = stat;
    return a.validate('forecast.schema.json', c) as boolean;
  };
  const nulls = { mse: null, rmse: null, squaredErrorRange: null, errorRange: null };
  expect(withStat(real)).toBe(true);
  expect(withStat({ ...real, n: 0 }), 'n = 0 with numbers').toBe(false);
  expect(withStat({ n: 8, ...nulls }), 'n = 8 with every value null').toBe(false);
  expect(withStat({ n: 0, ...nulls }), 'the n = 0 shape').toBe(true);
  // One wrong field, either way round.
  for (const k of Object.keys(nulls)) {
    expect(withStat({ ...real, [k]: null }), `n = ${real.n} with ${k} null`).toBe(false);
    expect(withStat({ n: 0, ...nulls, [k]: real[k] }), `n = 0 with ${k} set`).toBe(false);
  }
  // Negative control: without the if/then/else, numbers at n = 0 pass, so the cases above test that rule.
  const loose = ajv({
    'forecast.schema.json': (s) => {
      delete s.$defs.errorStat.if;
      delete s.$defs.errorStat.then;
      delete s.$defs.errorStat.else;
    },
  });
  const c = structuredClone(art);
  c.errorStats.persistence = { ...real, n: 0 };
  expect(loose.validate('forecast.schema.json', c)).toBe(true);
});

test('artifacts/manifest.json validates and every listed artifact validates', () => {
  const a = ajv();
  const manifest = JSON.parse(readFileSync(resolve(ARTIFACTS, 'manifest.json'), 'utf8'));
  expect(a.validate('manifest.schema.json', manifest), JSON.stringify(a.errors)).toBe(true);
  for (const entry of manifest.artifacts as { path: string; schema: string }[]) {
    const p = resolve(ARTIFACTS, entry.path);
    expect(existsSync(p)).toBe(true);
    const ok = a.validate(entry.schema, JSON.parse(readFileSync(p, 'utf8')));
    expect(ok, `${entry.path}: ${JSON.stringify(a.errors?.slice(0, 3))}`).toBe(true);
  }
});
