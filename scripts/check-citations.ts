/**
 * Check that every `file:line` citation in ARCHITECTURE.md still points at code.
 *
 * The doc's contract is that every claim carries a `file:line`. Appending to a
 * source file shifts every citation below it, so citations rot silently — 16 of
 * 77 had drifted onto blank lines, closing braces and comment markers before this
 * script existed. A citation landing on nothing is a claim nobody can check.
 *
 * Exits 1 if anything is suspect, so it can gate a commit.
 *
 *   node --experimental-strip-types scripts/check-citations.ts
 */
import { readFileSync, existsSync } from 'node:fs';

const DOC = 'ARCHITECTURE.md';

/** Lines that mean the citation has slipped off whatever it named. */
const EMPTY = new Set(['', '}', '};', '{', ')', '*', '*/', '/**']);

const doc = readFileSync(DOC, 'utf8').split(/\r?\n/);
const sources = new Map<string, string[]>();
const readSource = (f: string): string[] | null => {
  if (!sources.has(f)) {
    if (!existsSync(f)) return null;
    sources.set(f, readFileSync(f, 'utf8').split(/\r?\n/));
  }
  return sources.get(f) ?? null;
};

// Markdown links only: `[label](path:line)`. A bare `path:line` in prose or in an
// ASCII diagram is not a citation, and matching those produces false positives.
const CITE = /\[[^\]]+\]\(([A-Za-z0-9_\-./]+\.(?:ts|tsx|sql))(?::(\d+))?\)/g;

let checked = 0;
const problems: string[] = [];
let section = '(preamble)';

doc.forEach((line, i) => {
  if (line.startsWith('## ')) section = line.slice(3).trim();
  for (const m of line.matchAll(CITE)) {
    const [, file, lineNo] = m;
    const src = readSource(file);
    if (!src) {
      problems.push(`${DOC}:${i + 1}  ${file}  — file does not exist  [${section}]`);
      continue;
    }
    if (!lineNo) continue; // file-only citation, nothing to drift
    checked++;
    const n = Number(lineNo);
    if (n > src.length) {
      problems.push(`${DOC}:${i + 1}  ${file}:${n}  — past EOF (${src.length} lines)  [${section}]`);
      continue;
    }
    const text = (src[n - 1] ?? '').trim();
    if (EMPTY.has(text)) {
      problems.push(`${DOC}:${i + 1}  ${file}:${n}  — lands on ${text === '' ? 'a blank line' : `\`${text}\``}  [${section}]`);
    }
  }
});

console.log(`${checked} line-citations checked in ${DOC}`);
if (problems.length === 0) {
  console.log('all resolve to real code');
  process.exit(0);
}
console.log(`\n${problems.length} suspect:`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
