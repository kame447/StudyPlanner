import { expect, test } from '@playwright/test';

const CASES = [
  {
    name: 'study',
    type: 'study',
    sourceType: 'manual',
    title: 'アルゴリズム演習',
    expected: 'study',
  },
  {
    name: 'class',
    type: 'study',
    sourceType: 'timetable',
    title: '情報資源総論',
    expected: 'class',
  },
  {
    name: 'other',
    type: 'other',
    sourceType: 'manual',
    title: '部屋の掃除',
    expected: 'other',
  },
];

async function seedHome(page, planCase) {
  await page.addInitScript(({ planCase: seed }) => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const user = {
      id: 'home-visual-user',
      email: 'home-visual@example.com',
      username: 'home-visual-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: `home-visual-${seed.name}`,
      seriesId: `home-visual-${seed.name}`,
      userId: user.id,
      title: seed.title,
      subject: '情報科学',
      type: seed.type,
      sourceType: seed.sourceType,
      date: today,
      startTime: '13:30',
      endTime: '15:00',
      memo: '',
      recurrence: null,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  }, { planCase });
}

for (const planCase of CASES) {
  test(`next-plan uses the ${planCase.expected} visual for ${planCase.name}`, async ({ page }) => {
    await seedHome(page, planCase);
    await page.goto('/');

    const card = page.locator('.home-next-card');
    const image = card.locator('.home-study-scene-image');

    await expect(card).toHaveAttribute('data-next-plan-visual', planCase.expected);
    await expect(image).toHaveAttribute(
      'src',
      `/assets/home/next-plan-${planCase.expected}.webp`,
    );
    await expect.poll(
      () => image.evaluate((element) => element.complete && element.naturalWidth > 0),
    ).toBe(true);
  });
}
