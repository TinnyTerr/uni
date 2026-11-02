#!/usr/bin/env bun
/**
 * Gathers the bundles a `tauri build` just produced into one flat directory.
 *
 * This is deliberately Node rather than `find … -exec cp`: the release runs on
 * a Windows runner as well as a Linux one, and a self-hosted Windows runner
 * cannot be relied on to have bash and the GNU tools in its PATH.
 *
 * The signatures come along too — the manifest job reads them back off the
 * release, which is the only place the two platforms meet.
 *
 *   bun scripts/collect-artifacts.mjs out
 */
import fs from 'node:fs';
import path from 'node:path';

const dest = process.argv[2] ?? 'out';
// A universal macOS build lands under its own target triple.
const sources = [
  path.join('src-tauri', 'target', 'release', 'bundle'),
  path.join('src-tauri', 'target', 'universal-apple-darwin', 'release', 'bundle'),
];

const WANTED = [/\.deb$/, /\.rpm$/, /\.AppImage$/, /-setup\.exe$/, /\.msi$/, /\.dmg$/, /\.app\.tar\.gz$/, /\.sig$/];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

fs.mkdirSync(dest, { recursive: true });

let found = 0;
for (const file of sources.flatMap((d) => [...walk(d)])) {
  const name = path.basename(file);
  if (!WANTED.some((re) => re.test(name))) continue;
  fs.copyFileSync(file, path.join(dest, name));
  console.log(`${name}  (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
  found++;
}

if (found === 0) {
  console.error(`nothing to collect under ${sources.join(' or ')} — did the bundle step run?`);
  process.exit(1);
}
console.log(`\n${found} file(s) in ${dest}`);
