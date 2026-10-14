import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./schedule-month-event-polish.css', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../components/MonthEventDialog.tsx', import.meta.url), 'utf8');

it('gives a recurring edit confirmation its own shrinkable scroll row before the input body', () => {
  expect(editor).toContain('className="assistant-feedback-card month-event-edit-scope"');
  const confirmedLayout = css.match(/\.modal-card\.month-event-modal:has\(> \.month-event-edit-scope\) \{([^}]+)\}/)?.[1];
  expect(confirmedLayout).toContain('grid-template-rows: auto minmax(0, auto) minmax(0, 1fr) auto');
  const confirmation = css.match(/\.month-event-edit-scope \{([^}]+)\}/)?.[1];
  expect(confirmation).toContain('min-height: 0');
  expect(confirmation).toContain('overflow-y: auto');
  expect(confirmation).not.toMatch(/pointer-events:\s*none|z-index:/);
});
