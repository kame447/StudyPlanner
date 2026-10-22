import base from './playwright.cross-browser.config.mjs';
export default {
  ...base,
  projects: base.projects.filter(project => project.name === 'webkit-mobile').map(project => ({
    ...project,
    testMatch: ['**/pixel-grid-equivalence.diagnostic.mjs'],
  })),
};
