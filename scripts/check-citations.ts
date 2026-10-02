/**
 * Check that every `file:line` citation in ARCHITECTURE.md still points at code.
 *
 * The doc's contract is that every claim carries a `file:line`. Appending to a
 * source file shifts every citation below it, so citations rot silently — 16 of
 * 77 had drifted onto blank lines, closing braces and comment markers before this
 * script existed. A citation landing on nothing is a claim nobody can check.
 *
 * Two kinds are checked. LINKED citations — `[label](path:line)` — are the doc's
 * norm. PLAIN ones — a bare `file.ts:N`, mostly in the ASCII flow diagrams — were
 * once skipped as false positives; an audit found 7 of
 * the 23 had drifted onto wrong code, so they are checked too. A bare file name is
 * resolved against the tracked files and must match exactly one.
 *
 * What this CANNOT see is a citation that slipped onto plausible wrong code: it only
 * catches one that landed on a blank line, a brace or a comment marker (a third of the
 * drift the audit found). After editing a cited file, still read every moved citation.
 *
 * Exits 1 if anything is suspect, so it can gate a commit.
 *
 *   node --experimental-strip-types scripts/check-citations.ts [doc.md]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DOC = process.argv[2] ?? 'ARCHITECTURE.md';

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

/** Every tracked source file, to resolve a bare `turn.ts` to `src/play/turn.ts`. */
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split(/\r?\n/).filter((f) => /\.(ts|tsx|sql)$/.test(f));
/** A plain citation's file: a path as written, else the one tracked file with that name, else why not. */
const resolvePlain = (name: string): { path: string } | { error: string } => {
  if (existsSync(name)) return { path: name };
  const hits = tracked.filter((f) => f === name || f.endsWith('/' + name));
  if (hits.length === 1) return { path: hits[0] };
  return { error: hits.length === 0 ? 'file does not exist' : `ambiguous file name (${hits.join(', ')})` };
};

// LINKED: `[label](path:line)`.
const LINKED = /\[[^\]]+\]\(([A-Za-z0-9_\-./]+\.(?:ts|tsx|sql))(?::(\d+))?\)/g;
// PLAIN: what is left once every markdown link is removed — `file.ts:N`, or a range `file.ts:N–M`.
const PLAIN = /([A-Za-z0-9_\-./]+\.(?:ts|tsx|sql)):(\d+)(?:[–-](\d+))?/g;

let linked = 0;
let plain = 0;
const problems: string[] = [];
let section = '(preamble)';

/** Judge one cited line; push a problem if it landed on nothing. */
const judge = (at: number, file: string, src: string[], n: number, kind: string) => {
  if (n > src.length) {
    problems.push(`${DOC}:${at}  ${file}:${n}  — past EOF (${src.length} lines)${kind}  [${section}]`);
    return;
  }
  const text = (src[n - 1] ?? '').trim();
  if (EMPTY.has(text)) {
    problems.push(`${DOC}:${at}  ${file}:${n}  — lands on ${text === '' ? 'a blank line' : `\`${text}\``}${kind}  [${section}]`);
  }
};

doc.forEach((line, i) => {
  if (line.startsWith('## ')) section = line.slice(3).trim();
  const at = i + 1;

  for (const m of line.matchAll(LINKED)) {
    const [, file, lineNo] = m;
    const src = readSource(file);
    if (!src) {
      problems.push(`${DOC}:${at}  ${file}  — file does not exist  [${section}]`);
      continue;
    }
    if (!lineNo) continue; // file-only citation, nothing to drift
    linked++;
    judge(at, file, src, Number(lineNo), '');
  }

  for (const m of line.replace(/\[[^\]]*\]\([^)]*\)/g, ' ').matchAll(PLAIN)) {
    const [, name, first, last] = m;
    const found = resolvePlain(name);
    if ('error' in found) {
      problems.push(`${DOC}:${at}  ${name}:${first}  — ${found.error} (plain)  [${section}]`);
      continue;
    }
    const src = readSource(found.path);
    if (!src) continue;
    plain++;
    judge(at, name, src, Number(first), ' (plain)');
    if (last) judge(at, name, src, Number(last), ' (plain, range end)');
  }
});

console.log(`${linked} linked and ${plain} plain line-citations checked in ${DOC}`);
if (problems.length === 0) {
  console.log('all resolve to real code');
  process.exit(0);
}
console.log(`\n${problems.length} suspect:`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
