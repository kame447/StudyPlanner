import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import worker from './traceWorker';

const { vars } = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const paths = [
  '/chat/completions', '/planning-attachment', '/planning-transcription',
  '/weekly-planning-trace/health', '/material-metadata/search',
  '/observability/events', '/observability/admin/overview',
];

function preflight(path: string, origin: string) {
  return worker.fetch(new Request(`https://proxy.example${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  }), vars);
}

afterEach(() => vi.restoreAllMocks());

it('allows the current and legacy public origins through every deployed API boundary', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
  for (const origin of ['https://laplance.com', 'https://studyplannner.pages.dev']) {
    for (const path of paths) {
      const response = await preflight(path, origin);
      expect(response.status, `${origin}${path}`).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('does not extend the domain addition to other schemes, ports, subdomains or lookalikes', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
  for (const origin of [
    'http://laplance.com', 'https://laplance.com:8443', 'https://www.laplance.com',
    'https://laplance.com.invalid', 'https://notlaplance.com', 'null',
  ]) {
    for (const path of paths) {
      const response = await preflight(path, origin);
      expect(response.status, `${origin}${path}`).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('still requires authentication after accepting the new origin', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
  const response = await worker.fetch(new Request('https://proxy.example/chat/completions', {
    method: 'POST',
    headers: { Origin: 'https://laplance.com', 'Content-Type': 'application/json' },
    body: '{}',
  }), { ...vars, OPENAI_API_KEY: 'unused-test-key' });
  expect(response.status).toBe(401);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://laplance.com');
  expect(fetchSpy).not.toHaveBeenCalled();
});
