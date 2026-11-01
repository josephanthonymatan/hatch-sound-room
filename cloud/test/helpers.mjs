import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../store.mjs';
import { seedLibrary } from '../media.mjs';
import { HatchService } from '../service.mjs';
import { createServer } from '../server.mjs';

export class FakeDevice extends EventEmitter {
  constructor() {
    super(); this.online = true; this.lastReadAt = Date.now(); this.writes = []; this.device = { product: 'restBaby', hardwareVersion: '11.0.0' };
    this.shadow = { state: { reported: { connected: true, deviceInfo: { f: '11.1.645' }, current: { playing: 'none', paused: false, sound: { v: 20000 }, color: { r: 0, g: 0, b: 0, w: 0, i: 0 } } }, desired: {} } };
  }
  get ready() { return this.online && this.shadow.state.reported.connected; }
  async fetchFavorites() { return structuredClone(this.favorites ?? []); }
  async fetchSounds() { return structuredClone(this.sounds ?? []); }
  async read() { if (!this.online) throw new Error('offline'); this.lastReadAt = Date.now(); this.emit('shadow', this.shadow, this.shadow); return structuredClone(this.shadow); }
  async write(patch, { guard } = {}) { if (guard && guard(this.shadow) !== true) return { skipped: true }; this.writes.push(structuredClone(patch)); if (this.onWrite) await this.onWrite(patch); return { version: 1 }; }
  report(current) { this.shadow.state.reported.current = structuredClone(current); this.emit('shadow', { state: { reported: { current } } }, this.shadow); }
}
export async function fixture(t, { now } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hatch-cloud-test-'));
  const store = await Store.open(directory); await seedLibrary(store, directory);
  const device = new FakeDevice();
  const config = { email: 'owner@example.test', password: 'test password', token: 'a'.repeat(64), origin: 'http://127.0.0.1', dataDir: directory };
  const service = new HatchService({ store, device, origin: config.origin, dataDir: directory, now });
  t.after(async () => { service.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, device, service, config };
}
export async function httpFixture(t, options) {
  const result = await fixture(t, options);
  const server = createServer({ service: result.service, config: result.config });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const call = (route, init = {}) => fetch(base + route, { ...init, headers: { authorization: `Bearer ${result.config.token}`, ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  return { ...result, base, call };
}
export const alarm = (now = Date.now()) => ({ label: 'Wake up', trackId: 'bach-allemanda', scheduledAt: new Date(now + 10000).toISOString(), timeZone: 'America/Los_Angeles', volume: 35, light: { color: '#ff8800', from: 3, to: 100, rampSeconds: 20 } });
