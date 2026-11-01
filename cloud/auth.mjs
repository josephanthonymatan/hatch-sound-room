import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { authorized, fail } from './core.mjs';

const cookieName = 'hatch_owner';
const lifetime = 8 * 3600;
const digest = value => createHash('sha256').update(value).digest();
const equalText = (a, b) => timingSafeEqual(digest(a), digest(b));
export class OwnerAuth {
  constructor(config, now = Date.now) { this.config = config; this.now = now; this.attempts = new Map(); }
  get displayName() { return this.config.ownerName ?? 'Owner'; }
  get secure() { return new URL(this.config.origin).protocol === 'https:'; }
  sameOrigin(request) { if (request.headers.origin !== this.config.origin) fail('This action requires a request from the app origin.', 403); }
  sign(payload) { return createHmac('sha256', this.config.sessionSecret ?? this.config.token).update('hatch-session.v1.' + payload).digest('base64url'); }
  cookie(value, seconds) { return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.secure ? '; Secure' : ''}`; }
  session(request) {
    const cookies = request.headers.cookie;
    if (typeof cookies !== 'string' || cookies.length > 8192) return false;
    const value = cookies.split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!value || value.length > 1024) return false;
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined || !equalText(signature, this.sign(payload))) return false;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const now = Math.floor(this.now() / 1000);
      return session.v === 1 && Number.isInteger(session.iat) && Number.isInteger(session.exp) && session.iat <= now && session.exp > now && session.exp - session.iat === lifetime;
    } catch { return false; }
  }
  require(request) {
    if (authorized(request.headers.authorization, this.config.token)) return 'bearer';
    if (!this.session(request)) fail('Sign in to control your Hatch.', 401);
    if (!['GET', 'HEAD'].includes(request.method)) this.sameOrigin(request);
    return 'session';
  }
  checkRate(request) {
    const now = this.now(), key = request.socket.remoteAddress ?? 'unknown';
    for (const [address, entry] of this.attempts) if (entry.until <= now) this.attempts.delete(address);
    const entry = this.attempts.get(key) ?? { count: 0, until: now + 15 * 60000 };
    if (entry.count >= 10 || this.attempts.size >= 1000 && !this.attempts.has(key)) fail('Too many sign-in attempts. Wait 15 minutes before trying again.', 429);
    entry.count++; this.attempts.set(key, entry);
  }
  login(input) {
    const host = new URL(this.config.origin).hostname;
    if (!this.secure && !['localhost', '127.0.0.1', '[::1]'].includes(host)) fail('Owner sign-in requires HTTPS; use a secure public origin.', 503);
    const email = typeof input.email === 'string' && input.email.length <= 320 ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' && input.password.length <= 4096 ? input.password : '';
    const emailOK = equalText(email, this.config.email.trim().toLowerCase());
    const passwordOK = equalText(password, this.config.password);
    if (!emailOK || !passwordOK) fail('The email or password is incorrect.', 401);
    const iat = Math.floor(this.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ v: 1, iat, exp: iat + lifetime, nonce: randomBytes(24).toString('base64url') })).toString('base64url');
    return this.cookie(payload + '.' + this.sign(payload), lifetime);
  }
  logout() { return this.cookie('', 0); }
}
