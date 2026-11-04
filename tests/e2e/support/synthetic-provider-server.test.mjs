import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class Response extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  statusCode = 200;
  body;
  writeHead(status) { this.statusCode = status; }
  end(body) {
    if (this.destroyed) return;
    this.body = JSON.parse(body);
    this.writableEnded = true;
    this.emit('close');
  }
  disconnect() { this.destroyed = true; this.emit('close'); }
}

function harness() {
  let handler;
  let nextTimer = 0;
  const timers = new Map();
  const source = readFileSync(new URL('../emulator/syntheticProvider.mjs', import.meta.url), 'utf8');
  // Execute the real handler; replace only the HTTP module and timer ports, without opening its shared port.
  vm.runInNewContext(source.replace("import http from 'node:http';", ''), {
    URL, Buffer,
    http: { createServer(callback) { handler = callback; return { listen() {} }; } },
    setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, { filename: 'syntheticProvider.mjs' });
  return { timers, async call(url, method = 'GET', body) {
    const request = Object.assign(new EventEmitter(), { url, method });
    const response = new Response();
    const pending = handler(request, response);
    if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)));
    request.emit('end');
    await pending;
    return response;
  } };
}

test('a disconnected nextCall cannot take the provider request from the current waiter', async () => {
  const h = harness();
  const stale = await h.call('/__synthetic/next?route=chat');
  stale.disconnect(); // The same response close that a timed-out HTTP client causes.
  const current = await h.call('/__synthetic/next?route=chat');
  const upstream = await h.call('/v1/chat/completions', 'POST', { model: 'synthetic', marker: 'current-turn' });
  assert.equal(current.writableEnded, true);
  assert.equal(current.body.body.marker, 'current-turn');
  assert.equal(stale.body, undefined);
  assert.equal(upstream.writableEnded, false);
  assert.deepEqual([...h.timers.values()].map(timer => timer.ms), [20_000]);
  await h.call('/__synthetic/respond', 'POST', { id: current.body.id, status: 200, body: { accepted: true } });
  assert.equal(upstream.statusCode, 200);
  assert.deepEqual(upstream.body, { accepted: true });
  assert.equal(h.timers.size, 0);
});

test('reset settles and clears held requests, waiting readers, scripts and hold timers', async () => {
  const h = harness();
  const oldUpstream = await h.call('/v1/chat/completions', 'POST', { marker: 'old-chat' });
  const oldWaiter = await h.call('/__synthetic/next?route=decision');
  await h.call('/__synthetic/script', 'POST', { route: 'decision', responses: [{ status: 200, body: { stale: true } }] });
  const reset = await h.call('/__synthetic/reset', 'POST');
  assert.equal(reset.statusCode, 200);
  assert.equal(oldUpstream.writableEnded, true);
  assert.equal(oldUpstream.statusCode, 503);
  assert.equal(oldWaiter.writableEnded, true);
  assert.equal(oldWaiter.statusCode, 503);
  assert.equal(h.timers.size, 0);
  assert.deepEqual((await h.call('/__synthetic/requests')).body.received, []);

  const chat = await h.call('/__synthetic/next?route=chat');
  const decision = await h.call('/__synthetic/next?route=decision');
  await h.call('/v1/chat/completions', 'POST', { marker: 'new-chat' });
  await h.call('/openrouter/api/alpha/decisions', 'POST', { marker: 'new-decision' });
  assert.equal(chat.writableEnded, true);
  assert.equal(chat.body.body.marker, 'new-chat');
  assert.equal(decision.writableEnded, true);
  assert.equal(decision.body.body.marker, 'new-decision');
  assert.equal(oldWaiter.body.error, 'synthetic provider reset');
});
