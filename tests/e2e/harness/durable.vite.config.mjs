import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import base from './vite.config.mjs';

// Reuse the real weekly UI. Unlike the ordinary UI fixture, leave the gateway,
// controller and renderer unaliased. Only authentication is synthetic.
export default defineConfig({
  ...base,
  plugins: [{
    name: 'durable-turn-synthetic-auth',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.endsWith('/lib/firebaseClient')
        && importer?.split('?')[0].endsWith('/weeklyPlanningDurableTurnClient.ts')) return '\0durable-synthetic-auth';
    },
    load(id) {
      if (id === '\0durable-synthetic-auth') return `export function getFirebaseAuth() {
        return { currentUser: { uid: 'browser-real-weekly-user', getIdToken: async () => 'synthetic-only' } };
      }`;
    },
  }, react()],
  define: { ...base.define,
    'import.meta.env.VITE_DURABLE_WEEKLY_TURNS': JSON.stringify('enabled'),
    'import.meta.env.VITE_CLOUDFLARE_AI_PROXY_URL': JSON.stringify('http://127.0.0.1:4175'),
  },
  server: { ...base.server, port: 4175 },
});
