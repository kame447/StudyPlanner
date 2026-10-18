import { test } from './support/fixed-clock.mjs';
import { verifyHomeAddMotion } from './support/home-add-motion-checks.mjs';

// The mobile WebKit project normally reduces motion; this shared check explicitly
// opts into normal motion and samples the real intermediate width/transforms.
test('Home add reveals and reverses smoothly in mobile WebKit', async ({ page }, testInfo) => {
  await verifyHomeAddMotion(page, testInfo, { width: 390, appearance: 'pixel', theme: 'dark', count: 1 });
});
