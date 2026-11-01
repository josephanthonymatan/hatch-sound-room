import test from 'node:test';
import assert from 'node:assert/strict';
import { alarmInput, authorized, lightPatch, playPatch, readConfig } from '../core.mjs';
import { OwnerAuth } from '../auth.mjs';
import { Store } from '../store.mjs';
import { fixture, alarm } from './helpers.mjs';

test('bearer comparison rejects missing, partial, malformed and unequal-length tokens', () => {
  assert.equal(authorized(undefined, 'secret'), false);
  for (const value of ['secret', 'Bearer secre', 'bearer secret', 'Bearer secretx', 'Bearer secret\n']) assert.equal(authorized(value, 'secret'), false);
  assert.equal(authorized('Bearer secret', 'secret'), true);
});
test('config requires secrets, a clean origin and bounded port', () => {
  const env = { HATCH_EMAIL: 'x', HATCH_PASSWORD: 'y', API_TOKEN: 'a'.repeat(32), PUBLIC_ORIGIN: 'https://hatch.example.test', DATA_DIR: '/data' };
  assert.equal(readConfig(env).origin, env.PUBLIC_ORIGIN);
  assert.equal(readConfig(env).audioOrigin, env.PUBLIC_ORIGIN);
  assert.equal(readConfig({ ...env, AUDIO_ORIGIN: 'http://192.0.2.10:3001', OWNER_NAME: 'Owner' }).audioOrigin, 'http://192.0.2.10:3001');
  assert.equal(readConfig({ ...env, OWNER_NAME: 'Owner' }).ownerName, 'Owner');
  for (const patch of [{ API_TOKEN: 'short' }, { PUBLIC_ORIGIN: 'https://user:pass@example.test' }, { PUBLIC_ORIGIN: 'https://example.test/path' }, { PORT: '99999' }, { DATA_DIR: '' }, { AUDIO_ORIGIN: 'https://example.test/path' }, { AUDIO_ORIGIN: 'file:///tmp' }, { OWNER_NAME: '' }]) assert.throws(() => readConfig({ ...env, ...patch }));
});
test('calendar, offset, future range and actual control bounds are validated', () => {
  const now = Date.parse('2026-10-25T10:00:00Z'), input = alarm(now);
  assert.equal(alarmInput(input, now).scheduledAt, input.scheduledAt);
  for (const patch of [{ scheduledAt: '2027-02-30T10:00:00Z' }, { scheduledAt: '2026-10-25T11:00:00' }, { scheduledAt: '2026-10-25T11:00:00+24:00' }, { scheduledAt: new Date(now + 4000).toISOString() }, { timeZone: 'Mars/City' }, { volume: '35' }, { volume: -1 }, { light: { ...input.light, to: 101 } }, { light: { ...input.light, from: 99, to: 10 } }]) assert.throws(() => alarmInput({ ...input, ...patch }, now));
});
test('patches preserve indefinite native looping and scene sound; percent is 16-bit', () => {
  const patch = playPatch('https://media.example.test/test.mp3', 100);
  assert.equal(patch.current.sound.id, 10543); assert.equal(patch.current.sound.v, 65535); assert.equal(patch.current.sound.until, 'indefinite'); assert.equal(patch.current.sound.duration, 0);
  assert.deepEqual(lightPatch({ color: '#ff8800', brightness: 100 }, { current: { playing: 'routine' } }), { current: { playing: 'remote', color: { id: 9999, r: 65535, g: 34952, b: 0, w: 0, i: 65535, until: 'indefinite', duration: 0 } } });
  assert.equal(lightPatch({ color: '#ff8800', brightness: 0 }).nightlightOn, false);
});
test('SQLite persists completed claims and rejects a concurrent instance', async t => {
  const { store, directory } = await fixture(t);
  store.change(state => state.alarms.push({ id: 'claimed', status: 'starting' }));
  assert.throws(() => store.change(async () => {}), /synchronous/);
  await assert.rejects(Store.open(directory), /locked/);
  assert.equal(JSON.parse(store.db.prepare('SELECT json FROM state').get().json).alarms[0].status, 'starting');
});
test('owner session is signed, expiring, HttpOnly and Strict; HTTPS adds Secure', () => {
  let now = 100000000;
  const config = { email: 'Owner@example.test', password: 'private', token: 'a'.repeat(64), origin: 'https://app.example.test' };
  const auth = new OwnerAuth(config, () => now);
  const cookie = auth.login({ email: 'owner@example.test', password: 'private' });
  assert.match(cookie, /HttpOnly; SameSite=Strict/); assert.match(cookie, /; Secure$/);
  assert.equal(auth.session({ headers: { cookie } }), true);
  assert.equal(auth.session({ headers: { cookie: cookie.replace('hatch_owner=', 'hatch_owner=x') } }), false);
  assert.throws(() => auth.login({ email: 'owner@example.test', password: 'wrong' }), /incorrect/);
  now += 8 * 3600000; assert.equal(auth.session({ headers: { cookie } }), false);
  assert.throws(() => new OwnerAuth({ ...config, origin: 'http://192.0.2.1' }).login({ email: config.email, password: config.password }), /HTTPS/);
});


test('optional session signing secret is validated and reaches runtime authentication', () => {
  const env={HATCH_EMAIL:'owner@example.test',HATCH_PASSWORD:'fixture password',API_TOKEN:'a'.repeat(64),PUBLIC_ORIGIN:'https://example.test',DATA_DIR:'/tmp/fixture'};
  assert.equal(readConfig(env).sessionSecret,undefined);
  assert.throws(()=>readConfig({...env,SESSION_SECRET:'short'}),/SESSION_SECRET/);
  const first=readConfig({...env,SESSION_SECRET:'b'.repeat(64)}), second=readConfig({...env,SESSION_SECRET:'c'.repeat(64)});
  assert.equal(first.sessionSecret,'b'.repeat(64));
  const cookie=new OwnerAuth(first).login({email:env.HATCH_EMAIL,password:env.HATCH_PASSWORD});
  assert.equal(new OwnerAuth(first).session({headers:{cookie}}),true);
  assert.equal(new OwnerAuth(second).session({headers:{cookie}}),false);
});
