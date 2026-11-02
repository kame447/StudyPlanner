// These assert the old semantic pipeline/isolated-turn protocol itself. Product
// contracts, including chat/reset/preview, remain on the default VNext project.
export const stableV5Specs = [
  '**/ai-planning-jev-first-authority.spec.mjs',
  '**/weekly-planning-module-recovery.spec.mjs',
];

export const stableV5HarnessServer = repoRoot => ({
  command: 'node ./node_modules/vite/bin/vite.js --config tests/e2e/harness/stable-v5.vite.config.mjs',
  cwd: repoRoot,
  url: 'http://127.0.0.1:4177/full-planner-recovery.html',
  reuseExistingServer: !process.env.CI,
  timeout: 30_000,
});
