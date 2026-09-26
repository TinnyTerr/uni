#!/usr/bin/env bun
/**
 * Sets one version in the three places that must agree.
 *
 * The tag, the app's reported version and the updater manifest all come from
 * different files; if they drift, an installed copy either never sees an update
 * or downloads one it thinks it already has. The release workflow refuses to
 * build when they disagree, so this is how you keep them together.
 *
 *   bun scripts/bump-version.mjs 0.2.0
 */
import fs from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: bump-version.mjs <major.minor.patch>');
  process.exit(1);
}

function editJson(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const doc = JSON.parse(raw);
  const was = doc.version;
  doc.version = version;
  // Two-space JSON with a trailing newline, matching what npm itself writes.
  fs.writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${path}: ${was} -> ${version}`);
}

editJson('package.json');
editJson('src-tauri/tauri.conf.json');

const cargo = 'src-tauri/Cargo.toml';
const text = fs.readFileSync(cargo, 'utf8');
// Only the first `version =` line, which belongs to [package]; dependency
// versions further down must not be touched.
const next = text.replace(/^version = ".*"$/m, `version = "${version}"`);
if (next === text) {
  console.error(`${cargo}: no package version line found`);
  process.exit(1);
}
fs.writeFileSync(cargo, next);
console.log(`${cargo}: -> ${version}`);

console.log(`\nNext: git commit -am "release ${version}" && git tag v${version} && git push --follow-tags`);
