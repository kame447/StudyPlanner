import { web } from '@e2e-dev/web';

export const weeklyWebEngine = web({
  browser: 'chromium',
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
});
