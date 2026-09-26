#!/usr/bin/env bun
/**
 * Builds the updater manifest from signed build artefacts.
 *
 * Tauri writes a detached signature next to each updater artefact; the
 * manifest is the map from platform to (download URL, signature) that the
 * running app fetches to decide whether there is anything newer. Scanning a
 * directory rather than hard-coding filenames keeps this honest when a version
 * number or a bundle target changes.
 *
 * Platforms are built on different runners, so this can be pointed either at a
 * fresh bundle directory or at a directory of signatures collected from a
 * release that several jobs have already uploaded to.
 *
 *   bun scripts/latest-json.mjs --base-url https://.../download/v0.2.0
 *   bun scripts/latest-json.mjs --base-url ... --dir sigs --notes "..."
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, value && !value.startsWith('--') ? 2 : 1);
  return value ?? fallback;
}

const baseUrl = flag('base-url');
const dir = flag('dir', 'src-tauri/target/release/bundle');
const notes = flag('notes', '');

if (!baseUrl) {
  console.error('usage: latest-json.mjs --base-url <url> [--dir <path>] [--notes <text>]');
  process.exit(1);
}

const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));

/**
 * Which updater platform key an artefact belongs to, and which artefact wins
 * when a platform produces more than one. Tauri's Windows updater wants the
 * NSIS installer, so the .msi never displaces it.
 */
const PLATFORMS = [
  { match: /_amd64\.AppImage$/, key: 'linux-x86_64', rank: 0 },
  { match: /_aarch64\.AppImage$/, key: 'linux-aarch64', rank: 0 },
  { match: /_x64-setup\.exe$/, key: 'windows-x86_64', rank: 0 },
  { match: /_x64_[a-zA-Z-]+\.msi$/, key: 'windows-x86_64', rank: 1 },
  { match: /_arm64-setup\.exe$/, key: 'windows-aarch64', rank: 0 },
  { match: /_x64\.app\.tar\.gz$/, key: 'darwin-x86_64', rank: 0 },
  { match: /_aarch64\.app\.tar\.gz$/, key: 'darwin-aarch64', rank: 0 },
  { match: /\.app\.tar\.gz$/, key: 'darwin-universal', rank: 2 },
];

function* walk(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const platforms = {};
const ranks = {};

for (const file of walk(dir)) {
  // The signature is the marker: an artefact without one cannot be verified,
  // so it has no business in the manifest.
  if (!file.endsWith('.sig')) continue;
  const name = path.basename(file).slice(0, -4);
  const hit = PLATFORMS.find((p) => p.match.test(name));
  if (!hit) {
    console.error(`skipping unrecognised artefact: ${name}`);
    continue;
  }
  if (hit.key in ranks && ranks[hit.key] <= hit.rank) continue;
  ranks[hit.key] = hit.rank;
  platforms[hit.key] = {
    signature: fs.readFileSync(file, 'utf8').trim(),
    url: `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(name)}`,
  };
}

if (Object.keys(platforms).length === 0) {
  console.error(`no signed artefacts under ${dir} — was the build run with a signing key?`);
  process.exit(1);
}

console.error(`manifest covers: ${Object.keys(platforms).sort().join(', ')}`);

process.stdout.write(
  `${JSON.stringify(
    {
      version: conf.version,
      notes: notes || `Uni Schedule ${conf.version}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
);
