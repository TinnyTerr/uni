#!/usr/bin/env node
/**
 * Builds the updater manifest from whatever `tauri build` just produced.
 *
 * Tauri writes a detached signature next to each updater artifact; the
 * manifest is the map from platform to (download URL, signature) that the
 * running app fetches to decide whether there is anything newer. Scanning the
 * bundle directory rather than hard-coding filenames keeps this honest when a
 * version number or a bundle target changes.
 *
 *   node scripts/latest-json.mjs <base-download-url> [notes] > latest.json
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , baseUrl, ...noteParts] = process.argv;
if (!baseUrl) {
  console.error('usage: latest-json.mjs <base-download-url> [release notes]');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const bundleDir = 'src-tauri/target/release/bundle';

/** Which updater platform key an artifact belongs to. */
const PLATFORMS = [
  { match: /_amd64\.AppImage$/, key: 'linux-x86_64' },
  { match: /_aarch64\.AppImage$/, key: 'linux-aarch64' },
  { match: /_x64-setup\.exe$/, key: 'windows-x86_64' },
  { match: /_x64_en-US\.msi$/, key: 'windows-x86_64' },
  { match: /_x64\.app\.tar\.gz$/, key: 'darwin-x86_64' },
  { match: /_aarch64\.app\.tar\.gz$/, key: 'darwin-aarch64' },
  { match: /\.app\.tar\.gz$/, key: 'darwin-universal' },
];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const platforms = {};
for (const file of walk(bundleDir)) {
  // The signature is the marker: an artifact without one cannot be verified,
  // so it has no business in the manifest.
  if (!file.endsWith('.sig')) continue;
  const artifact = file.slice(0, -4);
  const name = path.basename(artifact);
  const hit = PLATFORMS.find((p) => p.match.test(name));
  if (!hit) {
    console.error(`skipping unrecognised artifact: ${name}`);
    continue;
  }
  platforms[hit.key] = {
    signature: fs.readFileSync(file, 'utf8').trim(),
    url: `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(name)}`,
  };
}

if (Object.keys(platforms).length === 0) {
  console.error(`no signed artifacts under ${bundleDir} — was the build run with a signing key?`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      version: pkg.version,
      notes: noteParts.join(' ') || `Uni Schedule ${pkg.version}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
);
