// Merges a downloaded public password list into data/breached-passwords.txt (ADR-0005 S4).
// Usage: pnpm --filter @kenisha/api passwords:update <path-to-downloaded-list.txt>
//
// Keeps only entries the policy could otherwise accept (12-128 characters), lowercased,
// deduplicated and sorted. Reads a local file only: download the list yourself from a
// source you trust, and review the diff before committing.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN = 12;
const MAX = 128;
const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data/breached-passwords.txt',
);

const source = process.argv[2];
if (!source) {
  console.error('Usage: pnpm --filter @kenisha/api passwords:update <path-to-list.txt>');
  process.exit(1);
}

const current = readFileSync(target, 'utf8').split(/\r?\n/);
const header = current.filter((line) => line.startsWith('#'));
const entries = new Set(current.filter((line) => line && !line.startsWith('#')));
const before = entries.size;

for (const raw of readFileSync(source, 'utf8').split(/\r?\n/)) {
  const line = raw.trim().toLowerCase();
  // Characters outside printable ASCII are skipped: the file stays plain and reviewable.
  if (
    line.length >= MIN &&
    line.length <= MAX &&
    /^[\x20-\x7e]+$/.test(line) &&
    !line.startsWith('#')
  ) {
    entries.add(line);
  }
}

writeFileSync(target, [...header, ...[...entries].sort(), ''].join('\n'));
process.stdout.write(`breached-passwords.txt: ${before} -> ${entries.size} entries\n`);
