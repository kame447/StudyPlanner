import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.cross-browser.config.mjs';
import { buildCaptureDiagnostic } from './support/wpe-capture-diagnostic.mjs';

// Opt-in, independent diagnostic only. Never selected by the normal workflows.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export default defineConfig(buildCaptureDiagnostic(baseConfig, {
  slot: process.env.LAPLANS_CAPTURE_DIAGNOSTIC_SLOT,
  artifactsDir: path.join(root, 'artifacts'),
}));
