// Branch-local patch executor. Removed before PR review.
import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const current = fs.readFileSync(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`Expected pattern not found in ${path}: ${before.slice(0, 120)}`);
  }
  const next = current.replace(before, after);
  fs.writeFileSync(path, next);
}

replaceOnce(
  'src/components/BookshelfView.tsx',
  "import { useEffect, useMemo, useState } from 'react';",
  "import { useEffect, useMemo, useRef, useState } from 'react';",
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  "  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(null);",
  "  const [expandedSubjectIds, setExpandedSubjectIds] = useState<Set<string>>(() => new Set());\n  const didInitializeExpandedSubjectsRef = useRef(false);",
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  `  useEffect(() => {\n    if (\n      expandedSubjectId === null ||\n      !subjectsWithFallback.some((subject) => subject.id === expandedSubjectId)\n    ) {\n      setExpandedSubjectId(subjectsWithFallback[0]?.id ?? null);\n    }\n  }, [expandedSubjectId, subjectsWithFallback]);`,
  `  useEffect(() => {\n    const validSubjectIds = new Set(subjectsWithFallback.map((subject) => subject.id));\n\n    setExpandedSubjectIds((current) => {\n      const next = new Set(\n        Array.from(current).filter((subjectId) => validSubjectIds.has(subjectId)),\n      );\n\n      if (!didInitializeExpandedSubjectsRef.current && subjectsWithFallback.length > 0) {\n        next.add(subjectsWithFallback[0].id);\n        didInitializeExpandedSubjectsRef.current = true;\n      }\n\n      const unchanged =\n        next.size === current.size && Array.from(next).every((subjectId) => current.has(subjectId));\n      return unchanged ? current : next;\n    });\n  }, [subjectsWithFallback]);`,
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  `  function openMaterialMenu(material: StudyMaterial) {\n    setMenuMaterialId(material.id);\n  }`,
  `  function setSubjectExpanded(subjectId: string, expanded: boolean) {\n    setExpandedSubjectIds((current) => {\n      const next = new Set(current);\n      if (expanded) {\n        next.add(subjectId);\n      } else {\n        next.delete(subjectId);\n      }\n      return next;\n    });\n  }\n\n  function openMaterialMenu(material: StudyMaterial) {\n    setMenuMaterialId(material.id);\n  }`,
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  `                  setActiveSubjectId(subject.id);\n                  setExpandedSubjectId(subject.id);`,
  `                  setActiveSubjectId(subject.id);\n                  setSubjectExpanded(subject.id, true);`,
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  `              const expanded = expandedSubjectId === subject.id;`,
  `              const expanded = expandedSubjectIds.has(subject.id);`,
);

replaceOnce(
  'src/components/BookshelfView.tsx',
  `                    onClick={() => setExpandedSubjectId(expanded ? null : subject.id)}\n                    type="button"`,
  `                    onClick={() => setSubjectExpanded(subject.id, !expanded)}\n                    type="button"\n                    aria-expanded={expanded}`,
);

replaceOnce(
  'src/components/AiPlanningView.tsx',
  `  useEffect(() => {\n    inputRef.current?.focus();\n  }, []);\n\n`,
  '',
);

replaceOnce(
  'src/styles/schedule-redesign.css',
  `.schedule-record-sheet {\n  max-height: 88dvh;\n  overflow: auto;\n}`,
  `.modal-card.daily-detail-modal.schedule-action-sheet,\n.modal-card.daily-detail-modal.schedule-record-sheet {\n  grid-template-rows: auto auto minmax(0, 1fr);\n}\n\n.modal-card.daily-detail-modal.schedule-record-sheet {\n  max-height: 88dvh;\n  overflow: hidden;\n}`,
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

fs.writeFileSync(
  'tests/e2e/mobile-record-sheet.spec.mjs',
  `import { expect, test } from '@playwright/test';\n\nasync function seedSchedule(page) {\n  await page.addInitScript(() => {\n    const today = new Date().toISOString().slice(0, 10);\n    const now = new Date().toISOString();\n    const user = {\n      id: 'mobile-record-sheet-user',\n      email: 'mobile-record-sheet@example.com',\n      username: 'mobile-record-sheet',\n      avatar: '',\n      createdAt: now,\n    };\n    const plan = {\n      id: 'mobile-record-sheet-plan',\n      seriesId: 'mobile-record-sheet-plan',\n      userId: user.id,\n      title: '研究室ミーティング',\n      subject: '研究',\n      date: today,\n      startTime: '09:00',\n      endTime: '10:00',\n      repeat: 'none',\n      repeatUntil: null,\n      excludedDates: [],\n      recurrenceRules: [],\n      type: 'other',\n      memo: '',\n      sourceType: 'manual',\n      createdAt: now,\n      updatedAt: now,\n    };\n\n    localStorage.setItem('studyplanner.users', JSON.stringify([user]));\n    localStorage.setItem('studyplanner.session', user.id);\n    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));\n    localStorage.setItem('studyplanner.actuals', '[]');\n    localStorage.setItem('studyplanner.todos.v1', '[]');\n    localStorage.setItem('studyplanner.studySubjects.v1', '[]');\n    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');\n  });\n}\n\ntest.describe('mobile record sheet layout', () => {\n  test.use({\n    viewport: { width: 390, height: 844 },\n    screen: { width: 390, height: 844 },\n    deviceScaleFactor: 3,\n    isMobile: true,\n    hasTouch: true,\n  });\n\n  test('keeps the close control separate from the record editor content', async ({ page }) => {\n    await seedSchedule(page);\n    await page.goto('/');\n    await expect(page.locator('.primary-bottom-nav')).toBeVisible();\n    await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();\n\n    const dayTab = page.locator('.schedule-view-tabs').getByRole('tab', { name: '日', exact: true });\n    if ((await dayTab.getAttribute('aria-selected')) !== 'true') await dayTab.click();\n\n    const planBlock = page.locator('.timeline-plan-block').filter({ hasText: '研究室ミーティング' });\n    await expect(planBlock).toBeVisible();\n    await planBlock.click();\n    await page.locator('.schedule-action-item').filter({ hasText: '記録を保存' }).click();\n\n    const sheet = page.locator('.schedule-record-sheet');\n    const header = sheet.locator('.daily-detail-modal-header');\n    const close = header.getByRole('button', { name: '閉じる' });\n    const editor = sheet.locator('.actual-editor-card');\n    await expect(sheet).toBeVisible();\n    await expect(close).toBeVisible();\n    await expect(editor).toBeVisible();\n\n    const geometry = await page.evaluate(() => {\n      const rect = (selector) => {\n        const element = document.querySelector(selector);\n        if (!(element instanceof HTMLElement)) return null;\n        const box = element.getBoundingClientRect();\n        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };\n      };\n      return {\n        header: rect('.schedule-record-sheet .daily-detail-modal-header'),\n        close: rect('.schedule-record-sheet .schedule-action-close'),\n        editor: rect('.schedule-record-sheet .actual-editor-card'),\n      };\n    });\n\n    expect(geometry.header).not.toBeNull();\n    expect(geometry.close).not.toBeNull();\n    expect(geometry.editor).not.toBeNull();\n    expect(geometry.editor.top).toBeGreaterThanOrEqual(geometry.header.bottom - 1);\n    const overlapsClose =\n      geometry.close.left < geometry.editor.right &&\n      geometry.close.right > geometry.editor.left &&\n      geometry.close.top < geometry.editor.bottom &&\n      geometry.close.bottom > geometry.editor.top;\n    expect(overlapsClose).toBe(false);\n  });\n});\n`,
);
