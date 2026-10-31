import { format } from 'node:util';
import { expect, test } from '@playwright/test';
import { fillSecret } from './support/fill-secret.mjs';

const credentials = [
  { label: 'email', value: 'issue932-dummy@example.test', type: 'email' },
  { label: 'password', value: 'issue932-dummy-password', type: 'password' },
  { label: 'access key', value: 'issue932-dummy-access-key', type: 'text' },
];

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => route.abort());
  page.setDefaultTimeout(250);
});

test('disabled credential fill reproduces raw exposure and hides it at the boundary', async ({ page }) => {
  await page.setContent('<input aria-label="password" type="password" disabled>');
  const input = page.getByLabel('password');
  const dummy = credentials[1].value;
  const rawError = await input.fill(dummy).catch((caught) => caught);
  expect(rawError).toBeInstanceOf(Error);
  expect(rawError.message).toContain(dummy);

  const error = await fillSecret(input, dummy, 'password').catch((caught) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('Could not enter the password.');
  expect(format(error)).not.toContain(dummy);
  expect(error.cause).toBeUndefined();
});

test('successful credential fills keep their values', async ({ page }) => {
  await page.setContent(credentials.map(({ label, type }) => `<input aria-label="${label}" type="${type}">`).join(''));
  for (const credential of credentials) {
    const input = page.getByLabel(credential.label);
    await fillSecret(input, credential.value, credential.label);
    await expect(input).toHaveValue(credential.value);
  }
});
