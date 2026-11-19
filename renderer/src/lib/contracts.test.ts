// Contract test: every committed artifact validates against the shared JSON
// Schemas in ../contracts — the same schemas main/ validates against.
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTRACTS = resolve(__dirname, '../../../contracts');
const ARTIFACTS = resolve(__dirname, '../../../artifacts');

function ajv() {
  const a = new Ajv2020({ allErrors: true, strict: false });
  for (const f of readdirSync(CONTRACTS).filter((f) => f.endsWith('.schema.json'))) {
    const s = JSON.parse(readFileSync(resolve(CONTRACTS, f), 'utf8'));
    a.addSchema(s, f);
  }
  return a;
}

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
