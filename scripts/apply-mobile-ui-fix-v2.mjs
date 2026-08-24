// Branch-local patch executor. Removed before PR review.
import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const current = fs.readFileSync(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`Expected pattern not found in ${path}: ${before.slice(0, 120)}`);
  }
  fs.writeFileSync(path, current.replace(before, after));
}

replaceOnce(
  'src/components/BookshelfView.tsx',
  "import { useEffect, useMemo, useState } from 'react';",
  "import { useEffect, useMemo, useRef, useState } from 'react';",
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  "  const [expandedSubjectIds, setExpandedSubjectIds] = useState<string[]>([]);",
  "  const [expandedSubjectIds, setExpandedSubjectIds] = useState<string[]>([]);\n  const didInitializeExpandedSubjectsRef = useRef(false);",
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  `  useEffect(() => {\n    if (initialAction === 'add-material') {\n      setEditingMaterial(null);\n      onInitialActionHandled?.();\n    }\n  }, [initialAction, onInitialActionHandled]);\n\n  useEffect(() => {\n    if (\n      selectedMaterialId &&`,
  `  useEffect(() => {\n    if (initialAction === 'add-material') {\n      setEditingMaterial(null);\n      onInitialActionHandled?.();\n    }\n  }, [initialAction, onInitialActionHandled]);\n\n  useEffect(() => {\n    const validSubjectIds = new Set(subjectsWithFallback.map((subject) => subject.id));\n    setExpandedSubjectIds((current) => {\n      let next = current.filter((subjectId) => validSubjectIds.has(subjectId));\n      if (!didInitializeExpandedSubjectsRef.current && subjectsWithFallback.length > 0) {\n        const firstSubjectId = subjectsWithFallback[0].id;\n        next = next.includes(firstSubjectId) ? next : [firstSubjectId, ...next];\n        didInitializeExpandedSubjectsRef.current = true;\n      }\n      const unchanged =\n        next.length === current.length && next.every((subjectId, index) => subjectId === current[index]);\n      return unchanged ? current : next;\n    });\n  }, [subjectsWithFallback]);\n\n  useEffect(() => {\n    if (\n      selectedMaterialId &&`,
);

replaceOnce(
  'src/styles/schedule-redesign.css',
  `.schedule-record-sheet {\n  max-height: 88dvh;\n  overflow: auto;\n}`,
  `.modal-card.daily-detail-modal.schedule-action-sheet,\n.modal-card.daily-detail-modal.schedule-record-sheet {\n  grid-template-rows: auto auto minmax(0, 1fr);\n}\n\n.modal-card.daily-detail-modal.schedule-record-sheet {\n  max-height: 88dvh;\n  overflow: hidden;\n}`,
);

replaceOnce(
  'src/styles/home.css',
  `.home-time-dot::after {\n  content: '';\n  position: absolute;\n  top: 18px;\n  left: 8px;\n  height: 45px;\n  border-left: 1px dashed #cbd5e4;\n}\n\n.home-schedule-row:last-of-type .home-time-dot::after {\n  display: none;\n}`,
  `.home-schedule-row::before {\n  content: '';\n  position: absolute;\n  z-index: 1;\n  top: -1px;\n  bottom: -1px;\n  left: 18px;\n  border-left: 1px dashed #cbd5e4;\n  pointer-events: none;\n}\n\n.home-schedule-row:first-child::before {\n  top: 50%;\n}\n\n.home-schedule-row:not(:has(~ .home-schedule-row))::before {\n  bottom: 50%;\n}\n\n.home-time-dot {\n  z-index: 2;\n}`,
);

replaceOnce(
  'src/styles/theme-surface-contract.css',
  `:root[data-theme='dark'] .home-time-dot::after {\n  border-color: color-mix(in srgb, var(--text-muted) 32%, transparent);\n}`,
  `:root[data-theme='dark'] .home-schedule-row::before {\n  border-color: color-mix(in srgb, var(--text-muted) 32%, transparent);\n}`,
);

replaceOnce(
  'tests/e2e/bookshelf-surface.spec.mjs',
  `    const material = {`,
  `    const secondSubject = {\n      ...subject,\n      id: 'bookshelf-e2e-subject-2',\n      name: '研究',\n      color: '#2f9a74',\n    };\n    const material = {`,
);

replaceOnce(
  'tests/e2e/bookshelf-surface.spec.mjs',
  `    const secondMaterial = {\n      ...material,\n      id: 'bookshelf-e2e-material-2',\n      name: 'ネットワーク演習',\n      currentUnit: 30,\n    };`,
  `    const secondMaterial = {\n      ...material,\n      id: 'bookshelf-e2e-material-2',\n      name: '卒業研究ノート',\n      subjectId: secondSubject.id,\n      subjectName: secondSubject.name,\n      color: secondSubject.color,\n      currentUnit: 30,\n    };`,
);

replaceOnce(
  'tests/e2e/bookshelf-surface.spec.mjs',
  `    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));`,
  `    localStorage.setItem(\n      'studyplanner.studySubjects.v1',\n      JSON.stringify([subject, secondSubject]),\n    );`,
);

replaceOnce(
  'tests/e2e/bookshelf-surface.spec.mjs',
  `test.describe('mobile bookshelf containment', () => {`,
  `test('closes subject sections independently and allows multiple open sections', async ({ page }) => {\n  await seedBookshelf(page);\n  await openBookshelf(page);\n\n  const information = page.locator('.bookshelf-subject-toggle').filter({ hasText: '情報科学' });\n  const research = page.locator('.bookshelf-subject-toggle').filter({ hasText: '研究' });\n\n  await expect(information).toHaveAttribute('aria-expanded', 'true');\n  await information.click();\n  await expect(information).toHaveAttribute('aria-expanded', 'false');\n  await expect(page.locator('.bookshelf-material-list-row').filter({ hasText: 'アルゴリズム問題集' })).toHaveCount(0);\n\n  await information.click();\n  await research.click();\n  await expect(information).toHaveAttribute('aria-expanded', 'true');\n  await expect(research).toHaveAttribute('aria-expanded', 'true');\n  await expect(page.locator('.bookshelf-material-list-row').filter({ hasText: 'アルゴリズム問題集' })).toBeVisible();\n  await expect(page.locator('.bookshelf-material-list-row').filter({ hasText: '卒業研究ノート' })).toBeVisible();\n});\n\ntest.describe('mobile bookshelf containment', () => {`,
);

replaceOnce(
  'tests/e2e/ai-planning-surface.spec.mjs',
  `  await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();`,
  `  const composer = page.locator('.ai-planning-composer textarea');\n  await expect(composer).toBeVisible();\n  await expect(composer).not.toBeFocused();`,
);

replaceOnce(
  'tests/e2e/home-layout-responsive.spec.mjs',
  `for (const viewport of VIEWPORTS) {`,
  `test('keeps the today schedule timeline connector continuous in dark mode', async ({ page }) => {\n  await page.setViewportSize({ width: 390, height: 844 });\n  await seedHomeState(page, 4);\n  await page.goto('/');\n  await page.evaluate(() => {\n    document.documentElement.dataset.theme = 'dark';\n  });\n\n  const rows = page.locator('.home-schedule-row');\n  await expect(rows).toHaveCount(4);\n\n  const geometry = await rows.evaluateAll((elements) =>\n    elements.map((element) => {\n      const row = element.getBoundingClientRect();\n      const marker = element.querySelector('.home-time-dot')?.getBoundingClientRect();\n      const connector = getComputedStyle(element, '::before');\n      const top = Number.parseFloat(connector.top);\n      const bottom = Number.parseFloat(connector.bottom);\n      const left = Number.parseFloat(connector.left);\n      return {\n        rowTop: row.top,\n        rowBottom: row.bottom,\n        connectorTop: row.top + top,\n        connectorBottom: row.bottom - bottom,\n        connectorX: row.left + left,\n        markerCenterX: marker ? marker.left + marker.width / 2 : null,\n        markerCenterY: marker ? marker.top + marker.height / 2 : null,\n        color: connector.borderLeftColor,\n      };\n    }),\n  );\n\n  expect(geometry[0].connectorTop).toBeCloseTo(geometry[0].markerCenterY, 0);\n  expect(geometry.at(-1).connectorBottom).toBeCloseTo(geometry.at(-1).markerCenterY, 0);\n  for (const item of geometry) {\n    expect(item.connectorX).toBeCloseTo(item.markerCenterX, 0);\n    expect(item.color).not.toBe('rgba(0, 0, 0, 0)');\n  }\n  for (let index = 0; index < geometry.length - 1; index += 1) {\n    expect(geometry[index].connectorBottom).toBeGreaterThanOrEqual(\n      geometry[index + 1].connectorTop - 2,\n    );\n  }\n});\n\nfor (const viewport of VIEWPORTS) {`,
);

fs.writeFileSync(
  'tests/e2e/mobile-record-sheet.spec.mjs',
  `import { expect, test } from '@playwright/test';\n\nasync function seedSchedule(page) {\n  await page.addInitScript(() => {\n    const today = new Date().toISOString().slice(0, 10);\n    const now = new Date().toISOString();\n    const user = {\n      id: 'mobile-record-sheet-user',\n      email: 'mobile-record-sheet@example.com',\n      username: 'mobile-record-sheet',\n      avatar: '',\n      createdAt: now,\n    };\n    const plan = {\n      id: 'mobile-record-sheet-plan',\n      seriesId: 'mobile-record-sheet-plan',\n      userId: user.id,\n      title: '研究室ミーティング',\n      subject: '研究',\n      date: today,\n      startTime: '09:00',\n      endTime: '10:00',\n      repeat: 'none',\n      repeatUntil: null,\n      excludedDates: [],\n      recurrenceRules: [],\n      type: 'other',\n      memo: '',\n      sourceType: 'manual',\n      createdAt: now,\n      updatedAt: now,\n    };\n\n    localStorage.setItem('studyplanner.users', JSON.stringify([user]));\n    localStorage.setItem('studyplanner.session', user.id);\n    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));\n    localStorage.setItem('studyplanner.actuals', '[]');\n    localStorage.setItem('studyplanner.todos.v1', '[]');\n    localStorage.setItem('studyplanner.studySubjects.v1', '[]');\n    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');\n  });\n}\n\ntest.describe('mobile record sheet layout', () => {\n  test.use({\n    viewport: { width: 390, height: 844 },\n    screen: { width: 390, height: 844 },\n    deviceScaleFactor: 3,\n    isMobile: true,\n    hasTouch: true,\n  });\n\n  test('keeps the close control separate from the record editor content', async ({ page }) => {\n    await seedSchedule(page);\n    await page.goto('/');\n    await expect(page.locator('.primary-bottom-nav')).toBeVisible();\n    await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();\n\n    const dayTab = page.locator('.schedule-view-tabs').getByRole('tab', { name: '日', exact: true });\n    if ((await dayTab.getAttribute('aria-selected')) !== 'true') await dayTab.click();\n\n    const planBlock = page.locator('.timeline-plan-block').filter({ hasText: '研究室ミーティング' });\n    await expect(planBlock).toBeVisible();\n    await planBlock.click();\n    await page.locator('.schedule-action-item').filter({ hasText: '記録を保存' }).click();\n\n    const sheet = page.locator('.schedule-record-sheet');\n    const header = sheet.locator('.daily-detail-modal-header');\n    const close = header.getByRole('button', { name: '閉じる' });\n    const editor = sheet.locator('.actual-editor-card');\n    await expect(sheet).toBeVisible();\n    await expect(close).toBeVisible();\n    await expect(editor).toBeVisible();\n\n    const geometry = await page.evaluate(() => {\n      const rect = (selector) => {\n        const element = document.querySelector(selector);\n        if (!(element instanceof HTMLElement)) return null;\n        const box = element.getBoundingClientRect();\n        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };\n      };\n      return {\n        header: rect('.schedule-record-sheet .daily-detail-modal-header'),\n        close: rect('.schedule-record-sheet .schedule-action-close'),\n        editor: rect('.schedule-record-sheet .actual-editor-card'),\n      };\n    });\n\n    expect(geometry.header).not.toBeNull();\n    expect(geometry.close).not.toBeNull();\n    expect(geometry.editor).not.toBeNull();\n    expect(geometry.editor.top).toBeGreaterThanOrEqual(geometry.header.bottom - 1);\n    const overlapsClose =\n      geometry.close.left < geometry.editor.right &&\n      geometry.close.right > geometry.editor.left &&\n      geometry.close.top < geometry.editor.bottom &&\n      geometry.close.bottom > geometry.editor.top;\n    expect(overlapsClose).toBe(false);\n  });\n});\n`,
);
