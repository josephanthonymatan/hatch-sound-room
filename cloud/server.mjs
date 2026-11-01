import http from 'node:http';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { OwnerAuth } from './auth.mjs';
import { fail, HttpError, readConfig } from './core.mjs';
import { Store } from './store.mjs';
import { HatchDevice } from './device.mjs';
import { HatchService } from './service.mjs';
import { seedLibrary, serveAudio, uploadTrack } from './media.mjs';

function json(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  response.end(body);
}
export async function readJSON(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) fail('Use Content-Type: application/json.', 415);
  if (Number(request.headers['content-length']) > 16384) fail('JSON request is too large.', 413);
  let buffer = '';
  for await (const chunk of request) { buffer += chunk; if (Buffer.byteLength(buffer) > 16384) fail('JSON request is too large.', 413); }
  let value;
  try { value = JSON.parse(buffer); } catch { fail('Request body must contain valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Request JSON must be an object.');
  return value;
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp' };
async function serveFrontend(request, response, root, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) fail('Route not found.', 404);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { fail('Malformed path.'); }
  if (decoded.includes('\0') || decoded.includes('\\')) fail('Invalid path.');
  let file = path.resolve(root, '.' + decoded);
  if (!file.startsWith(root + path.sep) && file !== root) fail('Route not found.', 404);
  let info;
  try { info = await stat(file); if (info.isDirectory()) { file = path.join(file, 'index.html'); info = await stat(file); } } catch {}
  if (!info?.isFile()) {
    if (!request.headers.accept?.includes('text/html') || path.extname(decoded)) fail('Route not found.', 404);
    file = path.join(root, 'index.html');
    try { info = await stat(file); } catch { fail('The web app build is unavailable. Build web/dist before starting the service.', 503); }
  }
  const resolved = await realpath(file), resolvedRoot = await realpath(root);
  if (!resolved.startsWith(resolvedRoot + path.sep)) fail('Route not found.', 404);
  // Vite fingerprints these build assets; unversioned files must revalidate.
  const immutable = /^\/assets\/[^/]+-[\w-]{8}\.(?:js|css|woff2|svg|png|jpe?g|ico|webp)$/.test(decoded);
  response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'content-length': info.size, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' });
  if (request.method === 'HEAD') return response.end();
  try { await pipeline(createReadStream(file), response); } catch { response.destroy(); }
}
export function createServer({ service, config, normalizeAudio, frontendDist = config.frontendDist ?? fileURLToPath(new URL('../web/dist/', import.meta.url)) }) {
  const auth = new OwnerAuth(config); let uploading = false;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, config.origin), pathname = url.pathname;
      if (pathname === '/healthz' && request.method === 'GET') return json(response, 200, { ok: true, ready: service.device.ready });
      const audio = /^\/audio\/([a-f\d]{64})\.mp3$/.exec(pathname);
      if (audio && ['GET', 'HEAD'].includes(request.method)) {
        const file = service.audioFile(audio[1]); if (!file) fail('Audio not found.', 404);
        return await serveAudio(request, response, config.dataDir, file);
      }
      if (pathname === '/auth/session' && request.method === 'GET') return json(response, 200, auth.session(request) ? { authenticated: true, displayName: auth.displayName } : { authenticated: false });
      if (pathname === '/auth/bootstrap' && request.method === 'GET') {
        if (!auth.session(request)) return json(response, 200, { authenticated: false });
        return json(response, 200, { authenticated: true, displayName: auth.displayName, room: await service.state() });
      }
      if (pathname === '/auth/login' && request.method === 'POST') {
        auth.sameOrigin(request); auth.checkRate(request);
        const cookie = auth.login(await readJSON(request));
        return json(response, 200, { authenticated: true, displayName: auth.displayName, room: await service.state() }, { 'set-cookie': cookie });
      }
      if (pathname === '/auth/logout' && request.method === 'POST') {
        auth.sameOrigin(request);
        return json(response, 200, { authenticated: false }, { 'set-cookie': auth.logout() });
      }
      if (pathname.startsWith('/auth/') || pathname.startsWith('/audio/')) fail('Route not found.', 404);
      if (pathname === '/v1' || pathname.startsWith('/v1/') || pathname === '/api/hatch' || pathname.startsWith('/api/hatch/')) {
        auth.require(request);
        const route = pathname.startsWith('/api/hatch') ? '/v1' + pathname.slice('/api/hatch'.length) : pathname;
        if (request.method === 'GET' && route === '/v1/state') return json(response, 200, await service.state());
        if (request.method === 'GET' && route === '/v1/library') return json(response, 200, service.library());
        if (request.method === 'GET' && route === '/v1/alarms') return json(response, 200, service.alarms());
        if (request.method === 'POST' && route === '/v1/light-sequence') {
          const { recipe, ticket } = service.prepareLightSequence(await readJSON(request));
          return json(response, 200, { ok: true, lightSequence: await service.run(() => service.startLightSequence(recipe, ticket)) });
        }
        if (request.method === 'DELETE' && route === '/v1/light-sequence') {
          // Invalidate before waiting behind a pending tick/read/write. This is
          // cancellation only: stopping a sequence sends no device command.
          service.stopLightSequence();
          return json(response, 200, { ok: true, lightSequence: await service.run(() => service.lightSequence.state()) });
        }
        if (request.method === 'POST' && route === '/v1/hatch/sync') { await readJSON(request); return json(response, 200, await service.run(() => service.syncHatch())); }
        if (request.method === 'POST' && route === '/v1/sounds/save-current') { const input = await readJSON(request); return json(response, 201, await service.run(() => service.saveCurrent(input))); }
        if (request.method === 'POST' && route === '/v1/library') {
          if (uploading) fail('Another audio upload is processing. Try again after it finishes.', 409);
          uploading = true;
          try { return json(response, 201, { track: await uploadTrack(request, service.store, config.dataDir, { normalizeAudio }) }); }
          finally { uploading = false; }
        }
        const alarm = /^\/v1\/alarms\/([^/]+)$/.exec(route), track = /^\/v1\/library\/([^/]+)$/.exec(route), scene = /^\/v1\/scenes\/([^/]+)\/play$/.exec(route);
        if (request.method === 'DELETE' && alarm) {
          service.invalidateAlarm(alarm[1]);
          await service.run(() => service.deleteAlarm(alarm[1])); return json(response, 200, { ok: true });
        }
        if (request.method === 'PATCH' && alarm) {
          const input = await readJSON(request), prepared = service.prepareAlarmUpdate(alarm[1], input);
          return json(response, 200, await service.run(() => service.updateAlarmSettings(alarm[1], input, prepared)));
        }
        if (request.method === 'DELETE' && track) { await service.run(() => service.deleteTrack(track[1])); return json(response, 200, { ok: true }); }
        if (request.method === 'POST' && route === '/v1/alarms') { const input = await readJSON(request); return json(response, 201, await service.run(() => service.createAlarm(input))); }
        if (request.method === 'POST' && scene) { await readJSON(request); await service.run(() => service.scene(scene[1])); return json(response, 200, { ok: true }); }
        const control = { 'POST /v1/play': 'play', 'POST /v1/stop': 'stop', 'PATCH /v1/volume': 'volume', 'PATCH /v1/light': 'light' }[request.method + ' ' + route];
        if (control) { const input = await readJSON(request); await service.run(() => service[control](input)); return json(response, 200, { ok: true }); }
        fail('API route not found.', 404);
      }
      return await serveFrontend(request, response, path.resolve(frontendDist), pathname);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      // Do not serialize arbitrary provider or filesystem errors.
      json(response, error instanceof HttpError ? error.status : 503, { error: error instanceof HttpError ? error.message : 'The operation failed or its result is unknown. Check device state before retrying.' });
    }
  });
  server.requestTimeout = 135000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  return server;
}
export async function main() {
  const config = readConfig();
  config.frontendDist = process.env.FRONTEND_DIST;
  config.sessionSecret = process.env.SESSION_SECRET;
  if (config.sessionSecret && config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 random characters.');
  const store = await Store.open(config.dataDir);
  await seedLibrary(store, config.dataDir);
  const device = new HatchDevice(config), service = new HatchService({ store, device, origin: config.origin, audioOrigin: config.audioOrigin, dataDir: config.dataDir });
  const server = createServer({ service, config });
  device.on('notice', message => console.warn(message));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '0.0.0.0', resolve); });
  device.start(); service.start();
  console.log('Hatch service listening; cloud reported state and physical playback require verification.');
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    service.close(); await device.close();
    server.close(() => { store.close(); process.exit(0); });
    setTimeout(() => { store.close(); process.exit(1); }, 10000).unref();
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Hatch service startup failed. Verify required environment, writable DATA_DIR, build files, and single-instance configuration.'); process.exitCode = 1; });
