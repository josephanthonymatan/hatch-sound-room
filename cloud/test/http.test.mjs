import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createServer } from '../server.mjs';
import path from 'node:path';
import { fixture, httpFixture } from './helpers.mjs';
import { runProcess, mediaPath } from '../media.mjs';

test('only health/audio capabilities are public; state and library redact storage internals', async t => {
  const f = await httpFixture(t);
  assert.equal((await fetch(f.base + '/healthz')).status, 200);
  for (const route of ['/v1/state', '/v1/library', '/api/hatch/state', '/v1/alarms']) assert.equal((await fetch(f.base + route)).status, 401);
  const state = await (await f.call('/v1/state')).json();
  assert.equal(state.ready, true); assert.equal(state.library[0].id, 'bach-allemanda');
  const serialized = JSON.stringify(state);
  for (const value of ['audioCapability', 'filename', f.config.password, f.config.token, 'thingName']) assert.equal(serialized.includes(value), false);
});
test('owner login enables cookie API, mutations require Origin and logout expires the cookie', async t => {
  const f = await httpFixture(t); f.config.ownerName = 'Owner';
  const login = await fetch(f.base + '/auth/login', { method: 'POST', headers: { origin: f.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: f.config.email, password: f.config.password }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.doesNotMatch(cookie, /Secure/);
  const signedIn = await login.json();
  assert.equal(signedIn.authenticated, true); assert.equal(signedIn.displayName, 'Owner');
  assert.equal(signedIn.room.library[0].id, 'bach-allemanda');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await (await fetch(f.base + '/auth/session', { headers: { cookie } })).json(), { authenticated: true, displayName: 'Owner' });
  assert.equal((await fetch(f.base + '/api/hatch/state', { headers: { cookie } })).status, 200);
  const init = { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: '{"volume":22}' };
  assert.equal((await fetch(f.base + '/api/hatch/volume', init)).status, 403);
  assert.equal(f.device.writes.length, 0);
  assert.equal((await fetch(f.base + '/api/hatch/volume', { ...init, headers: { ...init.headers, origin: f.config.origin } })).status, 200);
  assert.equal(f.device.writes[0].current.sound.v, Math.ceil(.22 * 65535));
  const logout = await fetch(f.base + '/auth/logout', { method: 'POST', headers: { origin: f.config.origin, cookie } });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});
test('bootstrap includes fresh public room data only for a valid owner cookie and never caches it', async t => {
  const f = await httpFixture(t);
  let reads = 0;
  const read = f.device.read.bind(f.device);
  f.device.read = async () => { reads++; return read(); };
  for (const headers of [{}, { authorization: 'Bearer ' + f.config.token }, { cookie: 'hatch_owner=invalid' }]) {
    const response = await fetch(f.base + '/auth/bootstrap', { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { authenticated: false });
  }
  assert.equal(reads, 0);
  const login = await fetch(f.base + '/auth/login', { method: 'POST', headers: { origin: f.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: f.config.email, password: f.config.password }) });
  const cookie = login.headers.get('set-cookie');
  assert.equal(reads, 1);
  const loggedIn = await login.json();
  const response = await fetch(f.base + '/auth/bootstrap', { headers: { cookie } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const bootstrapped = await response.json();
  assert.equal(reads, 2);
  assert.equal(bootstrapped.authenticated, true);
  assert.equal(bootstrapped.room.library[0].id, loggedIn.room.library[0].id);
  for (const payload of [loggedIn, bootstrapped]) {
    const serialized = JSON.stringify(payload);
    for (const value of ['audioCapability', 'filename', f.config.password, f.config.token, 'thingName']) assert.equal(serialized.includes(value), false);
  }
  f.device.online = false;
  const offline = await fetch(f.base + '/auth/bootstrap', { headers: { cookie } });
  assert.equal(offline.status, 200); assert.equal((await offline.json()).room.ready, false);
  assert.equal(f.device.writes.length, 0);
});
test('login is rate limited with generic errors and no credential reflection', async t => {
  const f = await httpFixture(t);
  for (let i = 0; i < 10; i++) {
    const response = await fetch(f.base + '/auth/login', { method: 'POST', headers: { origin: f.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: f.config.email, password: 'incorrect' }) });
    assert.equal(response.status, 401); assert.equal((await response.text()).includes(f.config.email), false);
  }
  const response = await fetch(f.base + '/auth/login', { method: 'POST', headers: { origin: f.config.origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 429);
});
test('API rejects malformed controls, calendar values, JSON and oversized requests without device writes', async t => {
  const f = await httpFixture(t);
  for (const [route, method, body, status] of [
    ['/v1/volume', 'PATCH', '{"volume":101}', 400], ['/v1/volume', 'PATCH', '{"volume":"22"}', 400],
    ['/v1/light', 'PATCH', '{"color":"red","brightness":20}', 400], ['/v1/play', 'POST', '{"trackId":"missing"}', 404],
    ['/v1/stop', 'POST', '{oops', 400], ['/v1/stop', 'POST', JSON.stringify({ data: 'x'.repeat(17000) }), 413],
  ]) assert.equal((await f.call(route, { method, body })).status, status);
  assert.equal(f.device.writes.length, 0);
  assert.equal((await f.call('/v1/library/bach-allemanda', { method: 'DELETE' })).status, 409);
});
test('capability media supports HEAD, byte ranges and rejects traversal/missing tokens', async t => {
  const f = await httpFixture(t); const track = f.store.value.tracks[0]; const url = f.base + '/audio/' + track.audioCapability + '.mp3';
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), 2905277);
  const range = await fetch(url, { headers: { range: 'bytes=10-19' } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 10);
  assert.equal((await fetch(url, { headers: { range: 'bytes=99999999-' } })).status, 416);
  assert.equal((await fetch(f.base + '/audio/' + '0'.repeat(64) + '.mp3')).status, 404);
  assert.throws(() => mediaPath(f.directory, '../../secrets.mp3'), /Invalid/);
});
test('MP3/WAV upload normalizes real audio, ignores filenames, retains metadata and rejects invalid formats', async t => {
  const f = await httpFixture(t);
  const wav = path.join(f.directory, 'input.wav');
  await runProcess('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:a', 'pcm_s16le', wav]);
  const form = new FormData(); form.set('file', new Blob([await readFile(wav)], { type: 'audio/wav' }), '../../shell-$(touch nope).wav');
  form.set('category', ' nature '); form.set('title', 'A safe title'); form.set('kind', 'field-recording'); form.set('tags', 'outside,birds'); form.set('license', 'Owner recording');
  const response = await f.call('/v1/library', { method: 'POST', body: form });
  assert.equal(response.status, 201, await response.clone().text()); const { track } = await response.json();
  assert.equal(track.category, 'Nature'); assert.equal(track.title, 'A safe title'); assert.equal(track.source, 'User upload'); assert.equal(track.license, 'Owner recording'); assert.deepEqual(track.tags, ['outside', 'birds']);
  const saved = f.store.value.tracks.find(item => item.id === track.id); assert.match(saved.filename, /^[a-f\d-]{36}\.mp3$/);
  const probe = JSON.parse(await runProcess('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', mediaPath(f.directory, saved.filename)]));
  assert.deepEqual(probe.streams[0], { codec_name: 'mp3', sample_rate: '44100', channels: 1 });
  assert.deepEqual(await readdir(path.join(f.directory, 'tmp')), []);
  assert.equal((await f.call('/v1/library/' + track.id, { method: 'DELETE' })).status, 200);
  const invalid = new FormData(); invalid.set('file', new Blob(['bad']), 'attack.m3u'); invalid.set('title', 'Bad'); invalid.set('kind', 'music');
  assert.equal((await f.call('/v1/library', { method: 'POST', body: invalid })).status, 400);
  const corrupt = new FormData(); corrupt.set('file', new Blob(['not audio']), 'corrupt.wav'); corrupt.set('category', 'Water'); corrupt.set('title', 'Bad'); corrupt.set('kind', 'music');
  assert.equal((await f.call('/v1/library', { method: 'POST', body: corrupt })).status, 422);
  assert.deepEqual(await readdir(path.join(f.directory, 'tmp')), []);
});

test('uploads require a nonempty category of at most 60 characters before normalization', async t => {
  const f = await httpFixture(t);
  for (const category of [undefined, '', '   ', 'x'.repeat(61)]) {
    const form = new FormData();
    form.set('file', new Blob(['fake audio']), 'sound.mp3');
    form.set('title', 'No category'); form.set('kind', 'music');
    if (category !== undefined) form.set('category', category);
    const response = await f.call('/v1/library', { method: 'POST', body: form });
    assert.equal(response.status, 400); assert.match((await response.json()).error, /Category/);
    assert.equal(f.store.value.tracks.length, 1);
    assert.deepEqual(await readdir(path.join(f.directory, 'tmp')), []);
  }
});

test('an actual MP3 upload persists and is selectable for playback and an alarm', async t => {
  const f = await httpFixture(t), seed = f.store.value.tracks[0];
  const form = new FormData(); form.set('file', new Blob([await readFile(mediaPath(f.directory, seed.filename))], { type: 'audio/mpeg' }), 'bach-copy.mp3');
  form.set('category', 'Classical'); form.set('title', 'My uploaded MP3'); form.set('kind', 'music'); form.set('license', 'CC0');
  const upload = await f.call('/api/hatch/library', { method: 'POST', body: form }); assert.equal(upload.status, 201);
  const { track } = await upload.json(); assert.equal(track.category, 'Classical'); assert.equal(f.store.value.tracks.find(item => item.id === track.id).category, 'Classical'); assert.ok(track.durationSeconds > 180);
  assert.equal((await f.call('/v1/play', { method: 'POST', body: JSON.stringify({ trackId: track.id, volume: 30 }) })).status, 200);
  assert.equal(f.device.writes.at(-1).current.sound.until, 'indefinite');
  const scheduled = await f.call('/v1/alarms', { method: 'POST', body: JSON.stringify({ label: 'MP3 alarm', trackId: track.id, scheduledAt: new Date(Date.now() + 60000).toISOString(), timeZone: 'America/Los_Angeles', volume: 30, light: { color: '#ff8800', from: 3, to: 100, rampSeconds: 60 } }) });
  assert.equal(scheduled.status, 201); assert.equal((await scheduled.json()).alarm.trackId, track.id);
  assert.equal((await f.call('/v1/library/' + track.id, { method: 'DELETE' })).status, 409);
  assert.ok((await (await f.call('/v1/state')).json()).library.some(item => item.id === track.id));
});

test('upload advertised size is bounded before receiving or processing a file', async t => {
  const f = await httpFixture(t);
  const result = await new Promise((resolve, reject) => {
    const request = http.request(f.base + '/v1/library', { method: 'POST', headers: { authorization: 'Bearer ' + f.config.token, 'content-type': 'multipart/form-data; boundary=test', 'content-length': 50 * 1024 * 1024 + 65537 } }, response => { response.resume(); response.on('end', () => { resolve(response.statusCode); request.destroy(); }); });
    request.on('error', reject); request.end();
  });
  assert.equal(result, 413); assert.deepEqual(await readdir(path.join(f.directory, 'tmp')), []);
});
test('SPA hosting serves assets, uses HTML fallback only for navigation and rejects escaped symlinks', async t => {
  const f = await fixture(t), root = path.join(f.directory, 'dist'); await mkdir(root);
  await writeFile(path.join(root, 'index.html'), '<html>Hatch app</html>'); await writeFile(path.join(root, 'asset.js'), 'console.log("asset")');
  await writeFile(path.join(f.directory, 'private.txt'), 'private'); await symlink(path.join(f.directory, 'private.txt'), path.join(root, 'escape.txt'));
  const server = createServer({ service: f.service, config: f.config, frontendDist: root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })); const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base + '/', { headers: { accept: 'text/html' } })).text(), '<html>Hatch app</html>');
  assert.equal((await fetch(base + '/settings', { headers: { accept: 'text/html' } })).status, 200);
  assert.equal((await fetch(base + '/asset.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(base + '/missing.js', { headers: { accept: 'text/html' } })).status, 404);
  assert.equal((await fetch(base + '/missing', { headers: { accept: 'application/json' } })).status, 404);
  assert.equal((await fetch(base + '/escape.txt')).status, 404);
  assert.equal((await fetch(base + '/api/hatch/library')).status, 401);
});

test('only fingerprinted build assets receive immutable caching; HTML and unversioned files revalidate', async t => {
  const f = await fixture(t), root = path.join(f.directory, 'dist');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  for (const file of ['index.html', 'favicon.svg', 'outside-aBcD1234.js', 'assets/app.js', 'assets/index-aBcD1234.js', 'assets/index-Xy_Z-123.css', 'assets/inter-tight-latin-wght-normal-AbCdE123.woff2']) {
    await writeFile(path.join(root, file), file);
  }
  const server = createServer({ service: f.service, config: f.config, frontendDist: root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const file of ['/', '/favicon.svg', '/outside-aBcD1234.js', '/assets/app.js']) {
    const response = await fetch(base + file);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-cache');
  }
  for (const file of ['/assets/index-aBcD1234.js', '/assets/index-Xy_Z-123.css', '/assets/inter-tight-latin-wght-normal-AbCdE123.woff2']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(base + file, { method });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(Number(response.headers.get('content-length')), file.length - 1);
      assert.equal((await response.text()).length, method === 'HEAD' ? 0 : file.length - 1);
    }
  }
  const missing = await fetch(base + '/assets/missing-aBcD1234.js');
  assert.equal(missing.status, 404); assert.equal(missing.headers.get('cache-control'), 'no-store');
  const api = await fetch(base + '/api/hatch/state');
  assert.equal(api.status, 401); assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('library quota preserves disk headroom for durable alarm claims', async t => {
  const f = await httpFixture(t);
  f.store.change(state => { state.tracks[0].bytes = 750 * 1024 * 1024; });
  const form = new FormData(); form.set('file', new Blob(['data']), 'audio.mp3'); form.set('title', 'Track'); form.set('kind', 'music');
  const response = await f.call('/v1/library', { method: 'POST', body: form });
  assert.equal(response.status, 409); assert.match((await response.json()).error, /750 MiB/); assert.deepEqual(await readdir(path.join(f.directory, 'tmp')), []);
});

test('deletion protects an accepted play whose desired URL has not reached reported playback', async t => {
  const f = await httpFixture(t);
  f.store.change(state => state.tracks.push({ ...structuredClone(state.tracks[0]), id: 'pending-upload', seeded: false, audioCapability: 'b'.repeat(64) }));
  f.device.onWrite = patch => { f.device.shadow.state.desired.current = structuredClone(patch.current); };
  const played = await f.call('/v1/play', { method: 'POST', body: JSON.stringify({ trackId: 'pending-upload', volume: 30 }) });
  assert.equal(played.status, 200); assert.equal(f.device.shadow.state.reported.current.playing, 'none');
  const deleted = await f.call('/v1/library/pending-upload', { method: 'DELETE' });
  assert.equal(deleted.status, 409); assert.match((await deleted.json()).error, /pending playback/);
  assert.ok(f.store.value.tracks.some(track => track.id === 'pending-upload'));
  assert.ok((await readFile(mediaPath(f.directory, f.store.value.tracks[0].filename))).length > 0);
});
