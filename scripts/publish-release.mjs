#!/usr/bin/env bun
/**
 * Create (or reuse) a release on the Gitea repo and attach files to it.
 *
 * Gitea's API is close enough to GitHub's for this to work against either, but
 * neither ships a CLI on the runner by default, so this talks to the REST API
 * directly rather than adding a dependency to the release path.
 *
 *   bun scripts/publish-release.mjs --tag v0.2.0 --ensure      create it, once
 *   bun scripts/publish-release.mjs --tag v0.2.0 --dir out     attach everything in out/
 *   bun scripts/publish-release.mjs --tag v0.2.0 --download-sigs sigs
 *   bun scripts/publish-release.mjs --tag latest --recreate latest.json
 *
 * The `--ensure` / `--dir` / `--download-sigs` trio is how one manifest ends up
 * covering platforms built on different runners: one job opens the release,
 * each build attaches its own bundles and signatures, and a final job collects
 * every signature back out of it.
 *
 * Environment:
 *   RELEASE_TOKEN     API token with write access to the repo (required)
 *   GITHUB_SERVER_URL instance base URL, e.g. https://git.tinnyterr.com
 *   GITHUB_REPOSITORY owner/repo
 */
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = args[i + 1];
  args.splice(i, value && !value.startsWith('--') ? 2 : 1);
  return value ?? '';
}

const tag = flag('tag');
const notes = flag('notes') ?? '';
const title = flag('title');
const downloadSigs = flag('download-sigs');
// Naming a directory rather than globbing it: the release also runs on a
// Windows runner, where the shell cannot be relied on to expand `out/*` at all.
const uploadDir = flag('dir');
// Several build jobs share one release, so creating it is a separate step that
// runs once; the builds only ever attach to what is already there.
const ensureOnly = args.includes('--ensure') && args.splice(args.indexOf('--ensure'), 1);
// `latest` is a moving pointer, so it is thrown away and rebuilt each release
// rather than accumulating stale manifests.
const recreate = args.includes('--recreate') && args.splice(args.indexOf('--recreate'), 1);
const prerelease = args.includes('--prerelease') && args.splice(args.indexOf('--prerelease'), 1);
const files = args.filter((a) => !a.startsWith('--'));

const token = process.env.RELEASE_TOKEN;
const server = (process.env.GITHUB_SERVER_URL ?? '').replace(/\/+$/, '');
const repo = process.env.GITHUB_REPOSITORY ?? '';

if (!tag) fail('--tag is required');
if (!token) fail('RELEASE_TOKEN is not set');
if (!server || !repo) fail('GITHUB_SERVER_URL and GITHUB_REPOSITORY must be set');

const api = `${server}/api/v1/repos/${repo}`;

if (uploadDir) {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  if (!existsSync(uploadDir)) fail(`no such directory: ${uploadDir}`);
  for (const name of readdirSync(uploadDir)) {
    const full = join(uploadDir, name);
    if (statSync(full).isFile()) files.push(full);
  }
  if (files.length === 0) fail(`${uploadDir} has no files to attach`);
}

function fail(message) {
  console.error(`publish-release: ${message}`);
  process.exit(1);
}

/** A DNS or TLS failure should read like a message, not a stack trace. */
async function reach(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    fail(`cannot reach ${server}: ${e instanceof Error ? (e.cause?.message ?? e.message) : e}`);
  }
}

/** `allow404` distinguishes "asked whether it exists" from "something is wrong". */
async function call(path, init = {}, allow404 = false) {
  const res = await reach(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

const existing = await call(`/releases/tags/${encodeURIComponent(tag)}`, {}, true);

// Pulling the signatures back out of the release, rather than creating anything.
if (downloadSigs) {
  if (!existing) fail(`no release tagged ${tag} to collect signatures from`);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(downloadSigs, { recursive: true });
  const sigs = (existing.assets ?? []).filter((a) => a.name.endsWith('.sig'));
  if (sigs.length === 0) fail(`release ${tag} has no .sig assets — did the builds sign anything?`);
  for (const asset of sigs) {
    const res = await reach(asset.browser_download_url, {
      headers: { Authorization: `token ${token}` },
    });
    if (!res.ok) fail(`downloading ${asset.name} -> ${res.status}`);
    const { join } = await import('node:path');
    await writeFile(join(downloadSigs, asset.name), Buffer.from(await res.arrayBuffer()));
    console.log(`collected ${asset.name}`);
  }
  process.exit(0);
}

if (existing && recreate) {
  console.log(`replacing existing "${tag}" release`);
  await call(`/releases/${existing.id}`, { method: 'DELETE' });
}

if (existing && ensureOnly) {
  console.log(`release ${tag} already exists (#${existing.id})`);
  process.exit(0);
}

let release = existing && !recreate ? existing : null;
if (!release) {
  release = await call('/releases', {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: title ?? tag,
      body: notes,
      draft: false,
      prerelease: Boolean(prerelease),
    }),
  });
  console.log(`created release ${tag} (#${release.id})`);
} else {
  console.log(`reusing release ${tag} (#${release.id})`);
  if (notes) {
    await call(`/releases/${release.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: notes, name: title ?? tag }),
    });
  }
}

const { readFile } = await import('node:fs/promises');
const { basename } = await import('node:path');

for (const file of files) {
  const name = basename(file);
  // Re-running a release must not fail on an asset that is already there.
  const clash = (release.assets ?? []).find((a) => a.name === name);
  if (clash) {
    await call(`/releases/${release.id}/assets/${clash.id}`, { method: 'DELETE' });
    console.log(`replaced existing asset ${name}`);
  }

  const form = new FormData();
  form.append('attachment', new Blob([await readFile(file)]), name);
  const res = await reach(`${api}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: `token ${token}` },
    body: form,
  });
  if (!res.ok) fail(`uploading ${name} -> ${res.status} ${await res.text()}`);
  console.log(`uploaded ${name}`);
}

console.log(`${server}/${repo}/releases/tag/${encodeURIComponent(tag)}`);
