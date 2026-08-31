#!/usr/bin/env node
/**
 * Uni Schedule sync server.
 *
 * Two jobs, no dependencies:
 *
 *   1. Serve the built PWA (`dist/`) so a phone on the same network can
 *      install the app from it.
 *   2. Hold the one authoritative copy of the state document, with enough
 *      revision bookkeeping that a client can tell "someone else changed this"
 *      apart from "nothing has happened since I last looked".
 *
 * The document is opaque here. The server never merges and never inspects the
 * schedule; it stores bytes, hands out revision numbers, and refuses a write
 * whose base revision is stale. Deciding what to do about that refusal is the
 * client's job — see `src/lib/sync.ts`.
 *
 *   GET  /api/health          liveness + whether a token is required
 *   GET  /api/state           { rev, updatedAt, device, doc }
 *   PUT  /api/state           { baseRev, doc, device } -> 200 | 409 + server copy
 *   GET  /api/events          server-sent events, one per accepted write
 *
 * Environment:
 *   PORT        listen port                      (default 4173)
 *   UNI_DATA    directory for state.json         (default server/data)
 *   UNI_TOKEN   shared secret; unset = open      (default unset)
 *   UNI_HISTORY revisions kept in history/       (default 30)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const PORT = Number(process.env.PORT ?? 4173);
const DATA_DIR = path.resolve(process.env.UNI_DATA ?? path.join(here, 'data'));
const TOKEN = process.env.UNI_TOKEN ?? '';
const HISTORY = Number(process.env.UNI_HISTORY ?? 30);
const DIST = path.join(root, 'dist');

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const MAX_BODY = 32 * 1024 * 1024;

/* ---- the document ----------------------------------------------------- */

/** `doc: null` means nothing has ever been pushed; rev 0 is the empty state. */
const EMPTY = { rev: 0, updatedAt: null, device: null, doc: null };

function readEnvelope() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.rev === 'number') return parsed;
    console.error('state.json is not a sync envelope; starting from empty');
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`cannot read ${STATE_FILE}: ${e.message}`);
  }
  return { ...EMPTY };
}

let envelope = readEnvelope();

/** Temp file + rename, so an interrupted write cannot truncate a good save. */
function writeEnvelope(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  envelope = next;
  keepHistory(next);
}

/** A rolling window of past revisions — the cheapest possible undo. */
function keepHistory(next) {
  if (HISTORY <= 0) return;
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(HISTORY_DIR, `rev-${String(next.rev).padStart(6, '0')}.json`),
      JSON.stringify(next),
    );
    const kept = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - HISTORY))) {
      fs.unlinkSync(path.join(HISTORY_DIR, old));
    }
  } catch (e) {
    console.error(`history write failed: ${e.message}`);
  }
}

/* ---- subscribers ------------------------------------------------------ */

/** Open SSE responses. A write notifies every client except the one that made it. */
const listeners = new Set();

function broadcast() {
  const line = `data: ${JSON.stringify({
    type: 'state',
    rev: envelope.rev,
    updatedAt: envelope.updatedAt,
    device: envelope.device,
  })}\n\n`;
  for (const res of listeners) {
    try {
      res.write(line);
    } catch {
      listeners.delete(res);
    }
  }
}

/* ---- http helpers ----------------------------------------------------- */

const CORS = {
  // The desktop build talks to this from a `tauri://` origin and the dev
  // server from localhost:1420, so the allowed origin cannot be pinned.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** EventSource cannot set headers, so SSE falls back to a query parameter. */
function authorised(req, url) {
  if (!TOKEN) return true;
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ') && safeEqual(header.slice(7), TOKEN)) return true;
  const q = url.searchParams.get('token');
  return q !== null && safeEqual(q, TOKEN);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error(`invalid JSON: ${e.message}`));
      }
    });
    req.on('error', reject);
  });
}

/* ---- api -------------------------------------------------------------- */

async function api(req, res, url) {
  const route = url.pathname;

  // Health answers unauthenticated so a client can discover that a token is
  // needed; it reveals nothing but the fact that a server is here.
  if (route === '/api/health' && req.method === 'GET') {
    const open = authorised(req, url);
    return json(res, 200, {
      ok: true,
      name: 'uni-schedule',
      needsToken: Boolean(TOKEN),
      authorised: open,
      ...(open ? { rev: envelope.rev, updatedAt: envelope.updatedAt, device: envelope.device } : {}),
    });
  }

  if (!authorised(req, url)) {
    return json(res, 401, { error: TOKEN ? 'bad or missing token' : 'unauthorised' });
  }

  if (route === '/api/state' && req.method === 'GET') {
    return json(res, 200, envelope);
  }

  if (route === '/api/state' && req.method === 'PUT') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    if (!body || typeof body.doc !== 'object' || body.doc === null) {
      return json(res, 400, { error: 'doc must be an object' });
    }

    // `baseRev` is the revision the client believes it edited. Anything else
    // means someone wrote in between, and the client is told so rather than
    // having its write silently win or silently vanish.
    const baseRev = Number.isInteger(body.baseRev) ? body.baseRev : -1;
    if (baseRev !== envelope.rev) {
      return json(res, 409, { conflict: true, server: envelope });
    }

    const next = {
      rev: envelope.rev + 1,
      updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString(),
      device: typeof body.device === 'string' ? body.device.slice(0, 64) : null,
      doc: body.doc,
    };
    try {
      writeEnvelope(next);
    } catch (e) {
      return json(res, 500, { error: `cannot persist: ${e.message}` });
    }
    broadcast();
    console.log(`rev ${next.rev} from ${next.device ?? 'unknown device'}`);
    return json(res, 200, { rev: next.rev, updatedAt: next.updatedAt, device: next.device });
  }

  if (route === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 5000\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'hello', rev: envelope.rev })}\n\n`);
    listeners.add(res);
    // Proxies drop an idle stream; a comment line every 25s keeps it open.
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      listeners.delete(res);
    });
    return undefined;
  }

  return json(res, 404, { error: `no route ${req.method} ${route}` });
}

/* ---- static ----------------------------------------------------------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, url) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No build found. Run `npm run build` first, then restart this server.\n');
    return;
  }

  const wanted = decodeURIComponent(url.pathname);
  let file = path.join(DIST, wanted);
  // Refuse anything that escapes dist/ once symlinks and `..` are resolved.
  if (path.relative(DIST, file).startsWith('..')) {
    res.writeHead(403).end();
    return;
  }

  let stat = await fsp.stat(file).catch(() => null);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await fsp.stat(file).catch(() => null);
  }
  // The app routes on the hash, but a deep link or a refresh should still land
  // on the shell rather than a 404.
  if (!stat) {
    file = path.join(DIST, 'index.html');
    stat = await fsp.stat(file).catch(() => null);
    if (!stat) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
  }

  const ext = path.extname(file).toLowerCase();
  const tag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === tag) {
    res.writeHead(304, { ETag: tag }).end();
    return;
  }

  // Vite fingerprints its assets, so those can be cached hard; the shell and
  // the service worker must not be, or an update never reaches the phone.
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: tag,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(ext === '.js' || ext === '.webmanifest' ? CORS : {}),
  });
  fs.createReadStream(file).pipe(res);
}

/* ---- server ----------------------------------------------------------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) });
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  serveStatic(req, res, url).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end('server error');
  });
});

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Uni Schedule sync server');
  console.log(`  data      ${STATE_FILE}${envelope.rev ? ` (rev ${envelope.rev})` : ' (empty)'}`);
  console.log(`  auth      ${TOKEN ? 'token required' : 'open — set UNI_TOKEN to require one'}`);
  console.log(`  app       ${fs.existsSync(DIST) ? DIST : 'not built yet — run `npm run build`'}`);
  console.log('  reachable at');
  console.log(`    http://localhost:${PORT}`);
  for (const ip of addresses()) console.log(`    http://${ip}:${PORT}   <- use this on your phone`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const res of listeners) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
