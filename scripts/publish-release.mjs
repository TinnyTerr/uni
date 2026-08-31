#!/usr/bin/env node
/**
 * Create (or reuse) a release on the Gitea repo and attach files to it.
 *
 * Gitea's API is close enough to GitHub's for this to work against either, but
 * neither ships a CLI on the runner by default, so this talks to the REST API
 * directly rather than adding a dependency to the release path.
 *
 *   node scripts/publish-release.mjs --tag v0.2.0 --notes "..." dist/*.deb
 *   node scripts/publish-release.mjs --tag latest --recreate latest.json
 *
 * Environment:
 *   RELEASE_TOKEN     API token with write access to the repo (required)
 *   GITHUB_SERVER_URL instance base URL, e.g. https://git.tinnyterr.com
 *   GITHUB_REPOSITORY owner/repo
 */
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

function fail(message) {
  console.error(`publish-release: ${message}`);
  process.exit(1);
}

async function call(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

const existing = await call(`/releases/tags/${encodeURIComponent(tag)}`);

if (existing && recreate) {
  console.log(`replacing existing "${tag}" release`);
  await call(`/releases/${existing.id}`, { method: 'DELETE' });
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
  const res = await fetch(`${api}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: `token ${token}` },
    body: form,
  });
  if (!res.ok) fail(`uploading ${name} -> ${res.status} ${await res.text()}`);
  console.log(`uploaded ${name}`);
}

console.log(`${server}/${repo}/releases/tag/${encodeURIComponent(tag)}`);
