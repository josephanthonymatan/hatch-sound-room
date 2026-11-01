import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, jsonRequest } from '../src/components/types.ts';

test('HTTP validation, conflict and authentication failures are definitive rejections', async t => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Fixture rejection' }), { status }));
    await assert.rejects(api('/light', jsonRequest('PATCH', { brightness: 50 })), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.definitiveRejection, true);
      assert.equal(error.message, 'Fixture rejection');
      return true;
    });
    t.mock.restoreAll();
  }
});

test('timeouts and server failures leave the command outcome uncertain', async t => {
  for (const status of [408, 499, 500, 503]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status }));
    await assert.rejects(api('/play', jsonRequest('POST', { trackId: 'fixture' })), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.definitiveRejection, false);
      return true;
    });
    t.mock.restoreAll();
  }
});

test('network loss and aborted requests stay explicit and never replay writes', async t => {
  for (const failure of [new TypeError('Fixture connection loss'), new DOMException('Fixture timeout', 'AbortError')]) {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => { requests++; throw failure; });
    await assert.rejects(api('/play', jsonRequest('POST', { trackId: 'fixture' })), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.definitiveRejection, false);
      assert.match(error.message, /refresh/i);
      return true;
    });
    assert.equal(requests, 1);
    t.mock.restoreAll();
  }
});

test('an unreadable success response cannot establish whether a write took effect', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not-json', { status: 200 }));
  await assert.rejects(api('/stop', jsonRequest('POST')), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.definitiveRejection, false);
    assert.match(error.message, /unreadable/);
    return true;
  });
});
