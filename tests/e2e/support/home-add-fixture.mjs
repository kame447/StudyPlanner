export async function seedHomeAdd(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('home-touch-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'home-touch-user', email: 'home-touch@example.test', username: 'Homeタッチ検証', avatar: '', createdAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.monthEvents.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
    // Keep the ordinary dashboard available while Today's schedule starts empty.
    // A completely empty account opens GettingStartedSection instead of Today.
    localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{
      id: 'home-touch-todo', userId: user.id, title: 'タッチ検証の未予定課題', subject: '', type: 'study',
      estimatedMinutes: 30, dueDate: null, dueTime: null, memo: '', status: 'open', scheduledPlanId: null,
      createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('home-touch-seeded', 'true');
  });
}

export async function collectHomeAddActionEvents(page) {
  await page.evaluate(() => {
    window.homeAddTouchEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'blur', 'focusout', 'click']) {
      document.addEventListener(type, event => {
        if (!event.target.closest?.('.home-inline-add')) return;
        window.homeAddTouchEvents.push({ type, trusted: event.isTrusted, pointerType: event.pointerType ?? null,
          target: event.target.closest('button')?.textContent ?? '', relatedTarget: event.relatedTarget?.tagName ?? null });
      }, true);
    }
  });
}
