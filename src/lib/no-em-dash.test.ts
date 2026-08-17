import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Recursively collect all .ts/.tsx files under src (skipping this guard test itself). */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (/\.(ts|tsx)$/.test(entry) && entry !== 'no-em-dash.test.ts') out.push(p);
  }
  return out;
}

describe('no em dashes in source', () => {
  const srcRoot = join(__dirname, '..');
  const files = collect(srcRoot);

  it('scans a sane number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no U+2014 em dash remains in any src/**/*.ts(x) file', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (text.includes('\u2014')) offenders.push(relative(srcRoot, f));
    }
    expect(offenders).toEqual([]);
  });
});
