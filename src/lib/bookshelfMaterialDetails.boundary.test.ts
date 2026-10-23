import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps material activity/progress rules independent of browser persistence', () => {
  const domain = readFileSync(new URL('./bookshelfMaterialDetails.ts', import.meta.url), 'utf8');
  expect(domain).not.toMatch(/\b(?:window|localStorage|sessionStorage)\b/);
  expect(domain).not.toMatch(/from\s+['"][^'"]*(?:repositories|services)\//);
  expect(domain).not.toMatch(/(?:load|save)MaterialDetailPreferences/);
  const repository = readFileSync(new URL('../repositories/materialDetailPreferencesRepository.ts', import.meta.url), 'utf8');
  expect(repository).toContain("from '../lib/bookshelfMaterialDetails'");
  expect(repository).not.toMatch(/from\s+['"][^'"]*components\//);
});
