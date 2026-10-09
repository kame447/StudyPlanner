import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';
import { FaqView } from './FaqView';
import { LegalPage } from './LegalPage';
import { StudyPlannerLogo } from './StudyPlannerLogo';

describe('Laplans display names', () => {
  it('uses the product name for the page title and iOS launch title', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<title>Laplans</title>');
    expect(html).toContain('<meta name="application-name" content="Laplans" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Laplans" />');
  });

  it('gives the shared brand lockup the current accessible product name', () => {
    const html = renderToStaticMarkup(<StudyPlannerLogo />);
    expect(html).toContain('aria-label="Laplans"');
    expect(html).toContain('alt="Laplans"');
    expect(html).toContain('laplans-wordmark.jpeg');
    expect(html).not.toContain('studyplanner-logo.png');
  });

  it('preserves the supplied Laplans wordmark bytes', () => {
    const image = readFileSync(new URL('../assets/laplans-wordmark.jpeg', import.meta.url));
    expect(createHash('sha256').update(image).digest('hex')).toBe('dbc1abe3e2a7948c6da42d6cc61b12f12e124d55f6ca122fd429ff7f64535bea');
  });

  it.each([
    ['FAQ', <FaqView />],
    ['support', <AppSettingsSupportPanel />],
    ['terms', <LegalPage kind="terms" />],
    ['privacy', <LegalPage kind="privacy" />],
    ['contact', <LegalPage kind="contact" />],
  ])('uses Laplans in the visible %s content', (_surface, element) => {
    const text = renderToStaticMarkup(element).replace(/<[^>]+>/g, '');
    expect(text).toContain('Laplans');
    expect(text).not.toMatch(/Study\s?Planner/);
  });
});
