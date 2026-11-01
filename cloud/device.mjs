import { EventEmitter } from 'node:events';
import sdk from 'aws-iot-device-sdk';

const base = 'https://prod-sleep.hatchbaby.com/';
const delay = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref(); });
async function request(url, { token, json, headers = {}, fetcher = fetch } = {}) {
  let response;
  try {
    response = await fetcher(url, {
      method: json ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', USER_AGENT: 'hatch_rest_api', ...(token ? { 'X-HatchBaby-Auth': token } : {}), ...headers },
      body: json ? JSON.stringify(json) : undefined,
    });
  } catch { throw new Error('Hatch authentication network request failed.'); }
  if (!response.ok) throw new Error(`Hatch authentication request failed (HTTP ${response.status}).`);
  try { return await response.json(); } catch { throw new Error('Hatch authentication returned an invalid response.'); }
}
export async function authenticate({ email, password }, fetcher = fetch) {
  const login = await request(base + 'public/v1/login', { json: { email, password }, fetcher });
  if (login.status === 'failure' || typeof login.token !== 'string') throw new Error('Hatch sign-in failed; check the server credentials.');
  const api = async endpoint => (await request(base + endpoint, { token: login.token, fetcher })).payload;
  const devices = await api('service/app/iotDevice/v2/fetch?iotProducts=restBaby');
  if (!Array.isArray(devices)) throw new Error('Hatch returned an invalid device list.');
  const babies = devices.filter(device => device.product === 'restBaby');
  if (babies.length !== 1) throw new Error('Exactly one restBaby device is required; device selection is not configured.');
  const device = babies[0];
  if (typeof device.thingName !== 'string' || !device.thingName) throw new Error('Hatch device identity is missing.');
  const iot = await api('service/app/restPlus/token/v1/fetch');
  if (!iot || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(iot.region)) throw new Error('Hatch returned an invalid AWS region.');
  let host;
  try { host = new URL(iot.endpoint.startsWith('https://') ? iot.endpoint : 'https://' + iot.endpoint).hostname; } catch { throw new Error('Hatch returned an invalid IoT endpoint.'); }
  if (!host.endsWith('.amazonaws.com')) throw new Error('Hatch returned an unsupported IoT endpoint.');
  const { Credentials: aws } = await request(`https://cognito-identity.${iot.region}.amazonaws.com`, {
    json: { IdentityId: iot.identityId, Logins: { 'cognito-identity.amazonaws.com': iot.token } }, fetcher,
    headers: { 'content-type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityService.GetCredentialsForIdentity' },
  });
  const expiry = typeof aws?.Expiration === 'number' ? aws.Expiration * 1000 : Date.parse(aws?.Expiration);
  if (!aws?.AccessKeyId || !aws?.SecretKey || !aws?.SessionToken || !Number.isFinite(expiry) || expiry < Date.now() + 60000) throw new Error('AWS credentials are incomplete or expire too soon.');
  const fetchFavorites = async () => {
    if (typeof device.macAddress !== 'string' || !device.macAddress) throw new Error('Hatch favorite discovery is unavailable.');
    const routines = await api('service/app/routine/v2/fetch?macAddress=' + encodeURIComponent(device.macAddress));
    if (!Array.isArray(routines)) throw new Error('Hatch returned an invalid favorites list.');
    return routines;
  };
  const fetchSounds = async () => {
    const content = await api('service/app/content/v1/fetchByProduct?product=restBaby&contentTypes=sound');
    if (!Array.isArray(content?.contentItems)) throw new Error('Hatch returned an invalid sound catalog.');
    return content.contentItems;
  };
  return { device, expiry, fetchFavorites, fetchSounds, options: { protocol: 'wss', host, region: iot.region, accessKeyId: aws.AccessKeyId, secretKey: aws.SecretKey, sessionToken: aws.SessionToken, offlineQueueing: false, keepalive: 30 } };
}
function merge(target, patch) {
  if (!patch || typeof patch !== 'object') return patch;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) target[key] = merge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    else target[key] = value;
  }
  return target;
}
export class HatchDevice extends EventEmitter {
  constructor(config, { authenticateSession = () => authenticate(config), createClient = options => new sdk.thingShadow(options) } = {}) {
    super(); Object.assign(this, { authenticateSession, createClient });
    this.closed = false; this.online = false; this.lastReadAt = 0; this.shadow = null; this.chain = Promise.resolve();
  }
  get ready() { return this.online && this.shadow?.state?.reported?.connected === true && Date.now() - this.lastReadAt < 35000; }
  start() { this.loopPromise = this.loop(); }
  async loop() {
    let retry = 5000;
    while (!this.closed) {
      try {
        const session = await this.authenticateSession();
        if (this.closed) break;
        this.device = session.device;
        await this.session(session);
        retry = 5000;
      } catch {
        // Never log provider response bodies, credentials, device IDs, or URLs.
        this.emit('notice', 'Hatch cloud connection unavailable; waiting to reconnect.');
      }
      if (!this.closed) { await delay(retry); retry = Math.min(60000, retry * 2); }
    }
  }
  async session(session) {
    this.device = session.device;
    this.accountSession = session;
    const client = this.createClient(session.options);
    this.client = client;
    let poll, refresh, timeout, finished = false;
    await new Promise((resolve, reject) => {
      const finish = error => {
        if (finished) return;
        finished = true; clearInterval(poll); clearTimeout(refresh); clearTimeout(timeout);
        this.online = false; this.lastReadAt = 0; this.emit('unavailable');
        if (this.accountSession === session) this.accountSession = null;
        client.end(true);
        error ? reject(error) : resolve();
      };
      this.endSession = finish;
      for (const event of ['error', 'offline', 'close', 'reconnect']) client.on(event, () => finish(new Error('Cloud transport interrupted.')));
      client.on('foreignStateChange', (name, method, update) => {
        if (finished || name !== this.device.thingName || method !== 'update' || !update?.state) return;
        if (this.shadow?.version && update.version && update.version < this.shadow.version) return;
        this.shadow = merge(this.shadow ?? {}, structuredClone(update));
        this.emit('shadow', update, this.shadow);
      });
      timeout = setTimeout(() => finish(new Error('Cloud connect timed out.')), 25000);
      client.once('connect', () => {
        if (finished) return;
        client.register(this.device.thingName, { ignoreDeltas: true }, async error => {
          if (error || finished) return finish(new Error('Device shadow registration failed.'));
          try {
            this.online = true;
            await this.read();
            if (finished) return;
            clearTimeout(timeout);
            poll = setInterval(() => { this.read().catch(() => finish(new Error('Live device read failed.'))); }, 15000);
            poll.unref();
            refresh = setTimeout(() => finish(), Math.max(1000, session.expiry - Date.now() - 5 * 60000));
            refresh.unref();
          } catch { finish(new Error('Initial live device read failed.')); }
        });
      });
    });
    if (this.client === client) this.client = null;
  }
  enqueue(fn) {
    if (!this.online) return Promise.reject(new Error('Hatch cloud is disconnected; command was not queued.'));
    const generation = this.client;
    const next = this.chain.then(() => { if (!this.online || generation !== this.client) throw new Error('Hatch cloud disconnected before the operation; no retry.'); return fn(); });
    this.chain = next.catch(() => {});
    return next;
  }
  async accountRead(method) {
    const session = this.accountSession;
    if (!session?.[method]) throw new Error('Hatch account is reconnecting. Try syncing again shortly.');
    const result = await session[method]();
    if (this.accountSession !== session) throw new Error('Hatch session changed during sync. Try again.');
    return result;
  }
  fetchFavorites() { return this.accountRead('fetchFavorites'); }
  fetchSounds() { return this.accountRead('fetchSounds'); }
  operation(method, patch) {
    const client = this.client, name = this.device.thingName;
    return new Promise((resolve, reject) => {
      let token, done = false;
      const finish = (error, value) => {
        if (done) return; done = true; clearTimeout(timer);
        client.removeListener('status', status); client.removeListener('timeout', expired);
        for (const event of ['error', 'offline', 'close', 'reconnect']) client.removeListener(event, lost);
        error ? reject(error) : resolve(value);
      };
      const lost = () => finish(new Error('Cloud connection interrupted; command result is unknown and will not retry.'));
      const status = (thing, result, responseToken, value) => {
        if (thing === name && responseToken === token) finish(result === 'accepted' ? null : new Error('Hatch shadow operation was rejected.'), value);
      };
      const expired = (thing, responseToken) => { if (thing === name && token === responseToken) finish(new Error('Hatch operation timed out; it will not retry.')); };
      const timer = setTimeout(() => finish(new Error('Hatch operation timed out; it will not retry.')), 16000);
      client.on('status', status); client.on('timeout', expired);
      for (const event of ['error', 'offline', 'close', 'reconnect']) client.on(event, lost);
      try {
        if (!this.online || client !== this.client) return lost();
        token = method === 'get' ? client.get(name) : client.update(name, { state: { desired: patch } });
        if (!token) finish(new Error('Hatch operation could not be sent; it will not retry.'));
      } catch { finish(new Error('Hatch operation failed; it will not retry.')); }
    });
  }
  read() {
    return this.enqueue(async () => {
      const shadow = await this.operation('get');
      if (!shadow?.state?.reported) throw new Error('Hatch returned no reported state.');
      if (this.shadow?.version && shadow.version && shadow.version < this.shadow.version) throw new Error('Hatch returned an older device state.');
      this.shadow = structuredClone(shadow); this.lastReadAt = Date.now();
      this.emit('shadow', shadow, shadow);
      return shadow;
    });
  }
  write(patch, { guard } = {}) {
    return this.enqueue(async () => {
      if (!this.ready) throw new Error('Device is unavailable or its reported state is stale; no command sent.');
      // Evaluate cancellation/ownership after all queued reads, immediately before dispatch.
      // No await may separate this guard from the synchronous MQTT update below.
      if (guard && guard(this.shadow) !== true) return { skipped: true };
      return this.operation('update', patch);
    });
  }
  async close() { this.closed = true; this.endSession?.(); }
}
