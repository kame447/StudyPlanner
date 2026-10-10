// Appended to the exact helper prefix of the candidate live spec by prepare-offline-replay.py.
// No live driver, APIRequestContext, model request, or generated model response is executed.
const recorded = JSON.parse(readFileSync(REPLAY_ARTIFACT, 'utf8'));
expect(digest(readFileSync(REPLAY_ARTIFACT))).toBe('34876646a37f92e17ad62a47ba722cc59737b03d99f8445baa00e9590156157d');
const recordedCheckpoint = recorded.observations.find(row => row.kind === 'observed-checkpoint').checkpoint;
const recordedRenderer = recorded.observations.find(row => row.kind === 'renderer-observation').renderer;

test('offline recorded checkpoint: actual App chat, v2 preview, explicit local save and reload', async ({ browser }) => {
  const context = await newFixedClockContext(browser, { viewport: { width: 1280, height: 844 }, serviceWorkers: 'block' });
  const observations = [];
  const requests = [];
  const webSockets = [];
  const scenario = { id: 'offline-recorded-first-turn' };
  const evidenceDir = REPLAY_OUTPUT;
  mkdirSync(evidenceDir, { recursive: true });
  let failure = null;
  const budget = { deadline: Date.now() + LIMITS.caseMs, turnDeadline: null };
  const cancel = guardDeadline(context, budget.deadline, message => { failure ??= message; }, 'Offline UI replay deadline reached.');
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    const allowed = url.origin === 'ws://127.0.0.1:4174' && url.pathname === '/';
    webSockets.push({ origin: url.origin, pathname: url.pathname, decision: allowed ? 'loopback_hmr' : 'blocked' });
    if (allowed) return socket.connectToServer();
    return socket.close({ code: 1008, reason: 'Offline fixture permits only local dev HMR.' });
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4174' && !url.pathname.startsWith('/__issue488_real_api/')) return route.continue();
    requests.push({ origin: url.origin, providerPath: url.pathname.startsWith('/__issue488_real_api/') });
    return route.abort();
  });
  try {
    const page = await context.newPage();
    pageBudgets.set(page, budget);
    page.setDefaultTimeout(5_000);
    await page.goto(HARNESS, { timeout: uiTimeout(page, 30_000) });
    await expect(nav(page)).toBeVisible({ timeout: uiTimeout(page) });
    // Restore the artifact's exact durable checkpoint. Only the navigation index is constructed
    // from its owner/week/conversation, using the production version-1 index contract.
    await page.evaluate(snapshot => {
      localStorage.setItem(`studyplanner.weeklyPlanning.stableV5.${snapshot.ownerId}.${snapshot.weekStartDate}`, JSON.stringify(snapshot));
      localStorage.setItem(`studyplanner.weeklyPlanning.activeSession.${snapshot.ownerId}`, JSON.stringify({
        version: 1, ownerId: snapshot.ownerId, weekStartDate: snapshot.weekStartDate, conversationId: snapshot.conversationId,
      }));
      sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true');
    }, recordedCheckpoint);
    await page.reload({ timeout: uiTimeout(page, 30_000) });
    await expect(nav(page)).toBeVisible({ timeout: uiTimeout(page) });
    await nav(page).getByRole('button', { name: 'AI計画', exact: true }).click({ timeout: uiTimeout(page) });
    await expect(composer(page)).toBeEnabled({ timeout: uiTimeout(page) });
    const restored = await checkpoint(page);
    expect(restored.graph).toEqual(recordedCheckpoint.graph);
    expect(restored.planningState.messages).toEqual(recordedCheckpoint.planningState.messages);
    expect(restored.planningState.previewCandidates).toEqual(recordedCheckpoint.planningState.previewCandidates);
    const candidates = assertExpectedFacts(restored, { amount: 20, pace: 3, session: 30, durations: [30, 30], start: '2026-08-24', end: '2026-08-30' });
    const lastText = restored.planningState.messages.at(-1).content;
    // Artifact lineage is compared offline. It is not a new model/trace/outbox execution.
    assertAdoptedRendererReceipt(recordedRenderer, recorded.receipts);
    expect(recordedRenderer.response.renderedText).toBe(lastText);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await captureUiEvidence(page, scenario, `restored-chat-${width}`, evidenceDir, observations);
      await expect(planningView(page)).toBeVisible({ timeout: uiTimeout(page) });
      await expect(assistantMessages(page)).toHaveCount(restored.planningState.messages.filter(row => row.role === 'assistant').length);
      await expect(assistantMessages(page).last()).toBeVisible({ timeout: uiTimeout(page) });
      await expect(assistantMessages(page).last()).toHaveText(lastText, { timeout: uiTimeout(page) });
      observations.push({ kind: 'offline-restored-chat', width, text: await assistantMessages(page).last().innerText({ timeout: uiTimeout(page) }) });
    }
    // A typing row must not become the chosen assistant. This is an explicit DOM-only counterexample.
    await planningView(page).locator('.ai-planning-conversation').evaluate(root => {
      const row = document.createElement('div'); row.className = 'ai-planning-message-row assistant'; row.dataset.offlineProbe = 'typing';
      const bubble = document.createElement('div'); bubble.className = 'ai-planning-bubble ai-planning-typing'; bubble.textContent = 'offline typing probe';
      row.append(bubble); root.append(row);
    });
    await expect(assistantMessages(page).last()).toHaveText(lastText);
    await planningView(page).locator('[data-offline-probe="typing"]').evaluate(row => row.remove());
    // A hidden last bubble must fail the visibility oracle, even though its text still matches.
    await assistantMessages(page).last().evaluate(element => { element.style.visibility = 'hidden'; });
    let hiddenRejected = false;
    try { await expect(assistantMessages(page).last()).toBeVisible({ timeout: 150 }); } catch { hiddenRejected = true; }
    expect(hiddenRejected).toBe(true);
    await assistantMessages(page).last().evaluate(element => { element.style.removeProperty('visibility'); });
    // The original wrong selector now fails promptly, with already-retained DOM/screenshot evidence.
    let oldSelectorRejected = false;
    const oldWaitStarted = Date.now();
    try { await page.locator('.weekly-planning-chat-message--assistant p').last().innerText({ timeout: 150 }); } catch { oldSelectorRejected = true; }
    expect(oldSelectorRejected).toBe(true);
    expect(Date.now() - oldWaitStarted).toBeLessThan(2_000);
    expect(observations.some(row => row.kind === 'ui-diagnostic' && row.dom?.planningViewVisible && row.screenshot)).toBe(true);
    await inspectPreview(page, candidates, { id: `${scenario.id}-initial` }, evidenceDir, observations);
    await preview(page).getByRole('button', { name: '閉じる', exact: true }).click({ timeout: uiTimeout(page) });
    await expect(preview(page)).toHaveCount(0, { timeout: uiTimeout(page) });
    await inspectPreview(page, candidates, scenario, evidenceDir, observations);
    // Require all natural initial/reopened captures to carry the new stability proof.
    const settled = observations.filter(row => row.kind === 'preview-stability');
    expect(settled.map(({ scenario: id, width }) => ({ scenario: id, width }))).toEqual([
      { scenario: `${scenario.id}-initial`, width: 1280 }, { scenario: `${scenario.id}-initial`, width: 390 },
      { scenario: scenario.id, width: 1280 }, { scenario: scenario.id, width: 390 },
    ]);
    for (const row of settled) {
      expect(row.stableFrames).toBe(3);
      expect(row.allAncestorOpacities.every(value => value === 1)).toBe(true);
      expect(row.measuredRectangles).toBeGreaterThan(candidates.length);
    }
    // Same-value opacity isolates finite animation state from changing rect/opacity.
    // The test waits for natural completion; it never finishes a production animation.
    const finiteProbe = await preview(page).evaluateHandle(root => root.animate(
      [{ opacity: 1 }, { opacity: 1 }], { duration: 1_000, fill: 'forwards' },
    ));
    try {
      const before = await finiteProbe.evaluate(animation => ({ pending: animation.pending, state: animation.playState }));
      expect(before.pending || before.state === 'running').toBe(true);
      await waitForPreviewStability(page, { id: 'offline-preview-finite-control' }, 390, observations);
      expect(await finiteProbe.evaluate(animation => animation.playState)).toBe('finished');
      expect(observations.at(-1).finiteAnimationCount).toBeGreaterThan(0);
      observations.push({ kind: 'offline-finite-animation-natural-completion', before, after: 'finished' });
    } finally {
      await finiteProbe.evaluate(animation => animation.cancel());
      await finiteProbe.dispose();
    }
    // A paused finite animation with unchanged geometry must fail under a shorter
    // existing-style turn budget, without changing the enclosing case deadline.
    const pausedProbe = await preview(page).evaluateHandle(async root => {
      const animation = root.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1_000, fill: 'forwards' });
      animation.pause();
      await animation.ready;
      return animation;
    });
    const previousTurnDeadline = budget.turnDeadline;
    const pausedStarted = Date.now();
    let pausedError = null;
    try {
      expect(await pausedProbe.evaluate(animation => animation.playState)).toBe('paused');
      budget.turnDeadline = Math.min(budget.deadline, pausedStarted + 200);
      try { await waitForPreviewStability(page, { id: 'offline-preview-paused-control' }, 390, observations); }
      catch (error) { pausedError = error; }
      expect(pausedError?.name).toBe('TimeoutError');
      expect(Date.now() - pausedStarted).toBeLessThan(2_000);
      expect(observations.some(row => row.kind === 'preview-stability' && row.scenario === 'offline-preview-paused-control')).toBe(false);
      observations.push({ kind: 'offline-paused-animation-rejected', errorName: pausedError.name, elapsedMs: Date.now() - pausedStarted });
    } finally {
      budget.turnDeadline = previousTurnDeadline;
      await pausedProbe.evaluate(animation => animation.cancel());
      await pausedProbe.dispose();
    }
    await saveAndReload(page, candidates, observations, scenario);
    // Explicit negative control: routeWebSocket must close this before any server connection.
    const deniedSocket = await page.evaluate(() => new Promise(resolve => {
      const timeout = setTimeout(() => resolve({ event: 'timeout' }), 2_000);
      const socket = new WebSocket('wss://example.invalid/issue488-offline-denied');
      socket.onopen = () => { clearTimeout(timeout); socket.close(); resolve({ event: 'opened' }); };
      socket.onclose = event => { clearTimeout(timeout); resolve({ event: 'closed', code: event.code }); };
    }));
    expect(deniedSocket).toEqual({ event: 'closed', code: 1008 });
    expect(webSockets.filter(row => row.decision === 'blocked')).toEqual([
      { origin: 'wss://example.invalid', pathname: '/issue488-offline-denied', decision: 'blocked' },
    ]);
    observations.push({ kind: 'offline-external-websocket-denied', ...deniedSocket });
    expect(requests, 'offline App replay must make zero provider/external requests').toEqual([]);
    expect(failure).toBeNull();
    observations.push({ kind: 'offline-replay-completed', modelCalls: 0, storage: 'production local repository / ScheduleEvent only' });
  } finally {
    cancel();
    writeFileSync(path.join(evidenceDir, 'offline-observations.json'), JSON.stringify({ sourceRun: 38057573433,
      replayKind: 'exact recorded checkpoint into actual App; no new model call; no new runtime trace assertion', failure, requests, webSockets, observations }, null, 2));
    await context.close();
  }
});

test('offline deadline guard interrupts a blocked real-browser wait', async ({ browser }) => {
  const context = await newFixedClockContext(browser, { serviceWorkers: 'block' });
  const page = await context.newPage();
  const started = Date.now();
  let failure = null;
  const budget = { deadline: started + 10_000, turnDeadline: started + 200 };
  pageBudgets.set(page, budget);
  expect(uiTimeout(page)).toBeLessThanOrEqual(200);
  const cancel = guardDeadline(context, budget.turnDeadline, message => { failure = message; }, 'offline expected turn timeout');
  let rejected = false;
  try { await page.locator('#deliberately-absent').innerText({ timeout: 10_000 }); } catch { rejected = true; }
  finally { cancel(); await context.close(); }
  expect(rejected).toBe(true);
  expect(failure).toBe('offline expected turn timeout');
  expect(Date.now() - started).toBeLessThan(2_000);
});
