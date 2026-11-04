import { defineConfig } from '@playwright/test';
import base from '../playwright.cross-browser.config.mjs';

const mobile = base.projects.find(project => project.name === 'webkit-mobile');
if (!mobile) throw new Error('The existing webkit-mobile project is unavailable');

export default defineConfig({
  ...base,
  projects: [{
    ...mobile,
    name: 'webkit-mobile-v5-scratch',
    testMatch: ['**/scratch/v5-double-touch-pending.spec.mjs'],
  }],
});
