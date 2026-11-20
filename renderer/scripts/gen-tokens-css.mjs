// Writes everything that is generated from src/design/tokens.ts (the single source of truth):
//   1. src/design/tokens.css
//   2. the "Token reference" tables of src/design/DESIGN.md, between the tokens:begin / tokens:end markers
// Usage: npm --prefix renderer run tokens        (exit 2 if DESIGN.md has lost its markers)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tokens = await import(new URL('../src/design/tokens.ts', import.meta.url).href);

const cssPath = fileURLToPath(new URL('../src/design/tokens.css', import.meta.url));
writeFileSync(cssPath, tokens.renderTokensCss());
console.log(`wrote ${cssPath}`);

const docPath = fileURLToPath(new URL('../src/design/DESIGN.md', import.meta.url));
const doc = readFileSync(docPath, 'utf8');
const begin = doc.indexOf('<!-- tokens:begin');
const end = doc.indexOf('<!-- tokens:end -->');
if (begin < 0 || end < begin) {
  console.error(`${docPath}: the tokens:begin / tokens:end markers are missing; the token reference was not updated`);
  process.exit(2);
}
const afterBeginLine = doc.indexOf('\n', begin) + 1;
const next = `${doc.slice(0, afterBeginLine)}\n${tokens.renderTokenReferenceMd()}\n\n${doc.slice(end)}`;
if (next !== doc) writeFileSync(docPath, next);
console.log(`${next === doc ? 'unchanged' : 'wrote'} ${docPath} (token reference)`);
