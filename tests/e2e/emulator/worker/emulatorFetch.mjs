// Outbound-request policy shared by the isolated E2E Workers (#947). Auth, Firestore and Google's token
// exchange always go to the local emulators. AI providers go to the synthetic provider ('synthetic') or, for the
// explicit real-API workflow, only api.openai.com ('real-openai'); every other host is refused, so
// nothing this Worker does can reach another production service.
// Ports from firebase.emulator-e2e.json and tests/e2e/playwright.emulator.config.mjs.
const AUTH_EMULATOR = 'http://127.0.0.1:9199';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8180';
const SYNTHETIC_PROVIDER = 'http://127.0.0.1:18790';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

const originalFetch = globalThis.fetch.bind(globalThis);

function redirected(request, mode) {
  const url = new URL(request.url);
  const rest = `${url.pathname}${url.search}`;
  if (url.hostname === 'identitytoolkit.googleapis.com') return new Request(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com${rest}`, request);
  if (url.hostname === 'firestore.googleapis.com') {
    const next = new Request(`${FIRESTORE_EMULATOR}${rest}`, request);
    next.headers.set('Authorization', 'Bearer owner');
    return next;
  }
  if (mode === 'synthetic' && url.hostname === 'openrouter.ai') return new Request(`${SYNTHETIC_PROVIDER}/openrouter${rest}`, request);
  if (mode === 'real-openai' && url.hostname === 'api.openai.com') return request;
  if (LOCAL_HOSTS.has(url.hostname)) return request;
  return null;
}

export function installEmulatorFetch(mode) {
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'oauth2.googleapis.com') {
      return Response.json({ access_token: 'owner', token_type: 'Bearer', expires_in: 3600 });
    }
    const target = redirected(request, mode);
    if (!target) throw new Error(`The isolated E2E Worker refuses an outbound request to ${url.hostname}.`);
    return originalFetch(target);
  };
}
