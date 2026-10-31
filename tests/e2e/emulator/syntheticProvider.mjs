// Synthetic AI provider for the isolated E2E target (#947), on 127.0.0.1:18790. It is not a model: each
// test scripts the exact responses it expects, in order, per route, and can read back every request the
// Worker made. An unscripted call fails loudly instead of inventing an answer. Real-model behavior is
// evaluated separately by the real-API workflows; this server only proves the real network path.
import http from 'node:http';

const PORT = 18790;
const ROUTES = {
  '/v1/chat/completions': 'chat',
  '/openrouter/api/alpha/decisions': 'decision',
};
const scripts = { chat: [], decision: [] };
const received = [];

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
  if (url.pathname === '/__synthetic/requests') return send(response, 200, { received });
  if (url.pathname === '/__synthetic/reset' && request.method === 'POST') {
    scripts.chat.length = 0;
    scripts.decision.length = 0;
    received.length = 0;
    return send(response, 200, { status: 'reset' });
  }
  const route = ROUTES[url.pathname];
  if (!route) return send(response, 404, { error: `unknown synthetic route ${url.pathname}` });
  received.push({ route, body: JSON.parse(body || 'null') });
  const next = scripts[route].shift();
  if (!next) return send(response, 503, { error: `unscripted synthetic ${route} call` });
  return send(response, next.status ?? 200, next.body);
}).listen(PORT, '127.0.0.1');
