import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import postcss from 'postcss';

it('keeps Day occurrence time inputs readable outside the mobile-only focus policy', () => {
  const css = postcss.parse(readFileSync(new URL('./modals.css', import.meta.url), 'utf8'));
  const rules: postcss.Rule[] = [];
  css.walkRules('.modal-card.daily-detail-modal .day-timetable-time-fields input', rule => {
    rules.push(rule);
  });

  expect(rules).toHaveLength(1);
  expect(rules[0].parent?.type).toBe('root');
  const fontSize = rules[0].nodes.find(node => node.type === 'decl' && node.prop === 'font-size');
  expect(fontSize?.type === 'decl' ? fontSize.value : undefined).toBe('max(1rem, 16px)');
});
