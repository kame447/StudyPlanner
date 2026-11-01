import { defineConfig } from 'vite';
import base from './vite.config.mjs';

// Historical semantic-pipeline regressions get their own local compilation.
// The default harness and the production preview always exercise VNext.
export default defineConfig({
  ...base,
  define: { ...base.define, 'import.meta.env.VITE_WEEKLY_PLANNING_CORE': JSON.stringify('stable_v5') },
  server: { ...base.server, port: 4177 },
});
