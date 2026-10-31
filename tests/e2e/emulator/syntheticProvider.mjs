// Synthetic AI provider for the isolated E2E target (#947), on 127.0.0.1:18790. It is not a model: it
// returns only what a test supplies. A test either queues fixed responses per route, or answers each held
// request itself after reading it (GET /__synthetic/next, POST /__synthetic/respond), which lets a reply
// echo ids from the actual request. A request nobody answers fails loudly (503) instead of inventing an
// answer, and every request the Worker made can be read back. Real-model behavior is evaluated separately
// by the real-API workflows; this server only proves the real network path.
import http from 'node:http';

const PORT = 18790;
const HOLD_MS = 20_000;
const ROUTES = {
  '/v1/chat/completions': 'chat',
  '/openrouter/api/alpha/decisions': 'decision',
};
const scripts = { chat: [], decision: [] };
const received = [];
const held = [];
const waiters = [];
let nextId = 1;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function offer(entry) {
  held.push(entry);
  const waiter = waiters.findIndex((candidate) => candidate.route === entry.route);
  if (waiter < 0) return;
  const [{ response }] = waiters.splice(waiter, 1);
  entry.taken = true;
  send(response, 200, { id: entry.id, route: entry.route, body: entry.body });
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const body = await readBody(request);
  if (url.pathname === '/__synthetic/health') return send(response, 200, { status: 'ok' });
  if (url.pathname === '/__synthetic/script' && request.method === 'POST') {
    const { route, responses } = JSON.parse(body);
    if (!(route in scripts) || !Array.isArray(responses)) return send(response, 400, { error: 'route and responses[] required' });
    scripts[route].push(...responses);
    return send(response, 200, { queued: scripts[route].length });
  }
  if (url.pathname === '/__synthetic/next') {
    const route = url.searchParams.get('route');
    const index = held.findIndex((entry) => entry.route === route && !entry.taken);
    if (index >= 0) {
      held[index].taken = true;
      return send(response, 200, { id: held[index].id, route, body: held[index].body });
    }
    return waiters.push({ route, response });
  }
  if (url.pathname === '/__synthetic/respond' && request.method === 'POST') {
    const { id, status, body: answer } = JSON.parse(body);
    const index = held.findIndex((entry) => entry.id === id);
    if (index < 0) return send(response, 404, { error: `no held request ${id}` });
    const [entry] = held.splice(index, 1);
    clearTimeout(entry.timer);
    send(entry.response, status ?? 200, answer);
    return send(response, 200, { answered: id });
  }
  if (url.pathname === '/__synthetic/requests') return send(response, 200, { received });
  if (url.pathname === '/__synthetic/reset' && request.method === 'POST') {
    scripts.chat.length = 0;
    scripts.decision.length = 0;
    received.length = 0;
    return send(response, 200, { status: 'reset' });
  }
  const route = ROUTES[url.pathname];
  if (!route) return send(response, 404, { error: `unknown synthetic route ${url.pathname}` });
  const parsed = JSON.parse(body || 'null');
  received.push({ route, body: parsed });
  const next = scripts[route].shift();
  if (next) return send(response, next.status ?? 200, next.body);
  const entry = { id: nextId++, route, body: parsed, response, taken: false };
  entry.timer = setTimeout(() => {
    const index = held.indexOf(entry);
    if (index >= 0) held.splice(index, 1);
    send(response, 503, { error: `unanswered synthetic ${route} call` });
  }, HOLD_MS);
  offer(entry);
}).listen(PORT, '127.0.0.1');
