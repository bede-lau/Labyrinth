// Writes src/design/tokens.css from src/design/tokens.ts (the single source of truth).
// Usage: npm --prefix renderer run tokens
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tokens = await import(new URL('../src/design/tokens.ts', import.meta.url).href);
const out = fileURLToPath(new URL('../src/design/tokens.css', import.meta.url));
writeFileSync(out, tokens.renderTokensCss());
console.log(`wrote ${out}`);
