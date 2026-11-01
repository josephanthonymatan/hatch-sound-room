import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { authenticate, HatchDevice } from '../device.mjs';

const fakeSession = expiry => ({ device: { product: 'restBaby', thingName: 'test-thing' }, expiry, options: { offlineQueueing: false } });
class Client extends EventEmitter {
  constructor() { super(); this.count = 0; this.ended = false; queueMicrotask(() => this.emit('connect')); }
  register(name, options, done) { this.options = options; queueMicrotask(done); }
  get() { const token = 'get-' + ++this.count; queueMicrotask(() => this.emit('status', 'test-thing', 'accepted', token, { version: this.count, state: { reported: { connected: true, current: { playing: 'none' } } } })); return token; }
  update(name, value) { const token = 'write-' + ++this.count; this.lastWrite = value; queueMicrotask(() => this.emit('status', name, 'accepted', token, { version: this.count })); return token; }
  end() { this.ended = true; this.emit('close'); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('server auth uses injected credentials, Cognito expiry and disables offline queuing', async () => {
  const calls = [], secret = { email: 'owner@example.test', password: 'private-password' };
  const results = [
    { token: 'private-hatch-token' },
    { payload: [{ product: 'restBaby', thingName: 'test-thing' }] },
    { payload: { region: 'us-east-1', endpoint: 'abc.iot.us-east-1.amazonaws.com', identityId: 'identity', token: 'private-cognito' } },
    { Credentials: { AccessKeyId: 'access', SecretKey: 'secret', SessionToken: 'session', Expiration: Date.now() / 1000 + 3600 } },
  ];
  const session = await authenticate(secret, async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => results.shift() }; });
  assert.deepEqual(JSON.parse(calls[0].options.body), secret);
  assert.equal(calls[1].options.headers['X-HatchBaby-Auth'], 'private-hatch-token');
  assert.equal(session.options.offlineQueueing, false); assert.equal(session.options.protocol, 'wss');
  assert.equal(session.options.host, 'abc.iot.us-east-1.amazonaws.com'); assert.ok(session.expiry > Date.now() + 3500000);
});
test('MQTT session observes a fresh live state, accepts each command once and rejects disconnected writes', async () => {
  let client; const device = new HatchDevice({}, { createClient: () => client = new Client() });
  const running = device.session(fakeSession(Date.now() + 3600000));
  await settle(); assert.equal(device.ready, true); assert.equal(client.options.ignoreDeltas, true);
  await device.write({ current: { sound: { v: 1000 } } }); assert.equal(client.count, 2);
  client.emit('offline'); await running.catch(() => {});
  assert.equal(device.ready, false); assert.equal(client.ended, true);
  await assert.rejects(device.write({ current: { playing: 'remote' } }), /disconnected/);
});
test('credential renewal ends the transport before AWS expiry and marks it unready', async () => {
  let client; const device = new HatchDevice({}, { createClient: () => client = new Client() });
  const started = Date.now(), running = device.session(fakeSession(Date.now() + 5 * 60000 + 10));
  await settle(); assert.equal(device.ready, true);
  await running;
  assert.equal(client.ended, true); assert.equal(device.ready, false); assert.ok(Date.now() - started < 2000);
});
test('queued operations from a disconnected generation never migrate to a new connection', async () => {
  const device = new HatchDevice({}); device.online = true; device.client = {};
  let release; device.chain = new Promise(resolve => { release = resolve; });
  let calls = 0; const pending = device.enqueue(() => { calls++; });
  device.client = {}; release(); await assert.rejects(pending, /disconnected/); assert.equal(calls, 0);
});

test('favorites and sound discovery use authenticated GETs and remain bound to their session', async () => {
  const calls = [];
  const results = [
    { token: 'private-hatch-token' },
    { payload: [{ product: 'restBaby', thingName: 'test-thing', macAddress: 'fake-mac' }] },
    { payload: { region: 'us-east-1', endpoint: 'abc.iot.us-east-1.amazonaws.com', identityId: 'identity', token: 'private-cognito' } },
    { Credentials: { AccessKeyId: 'access', SecretKey: 'secret', SessionToken: 'session', Expiration: Date.now() / 1000 + 3600 } },
    { payload: [{ id: 73 }] }, { payload: { contentItems: [{ id: 10543 }] } },
  ];
  const session = await authenticate({ email: 'test@example.test', password: 'fake' }, async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => results.shift() }; });
  assert.deepEqual(await session.fetchFavorites(), [{ id: 73 }]);
  assert.deepEqual(await session.fetchSounds(), [{ id: 10543 }]);
  for (const call of calls.slice(4)) { assert.equal(call.options.method, 'GET'); assert.equal(call.options.headers['X-HatchBaby-Auth'], 'private-hatch-token'); }
  assert.match(calls[4].url, /routine\/v2\/fetch\?macAddress=fake-mac$/);
  assert.match(calls[5].url, /product=restBaby&contentTypes=sound$/);
  const device = new HatchDevice({});
  let release;
  device.accountSession = { fetchFavorites: () => new Promise(resolve => { release = resolve; }) };
  const pending = device.fetchFavorites(); device.accountSession = null; release([]);
  await assert.rejects(pending, /session changed/);
  await assert.rejects(device.fetchFavorites(), /reconnecting/);
});
