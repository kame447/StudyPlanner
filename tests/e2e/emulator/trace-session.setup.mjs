import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Against production, the admin Logs spec is given the synthetic session that
// weekly-planning-trace-privacy.live.mjs wrote (STUDYPLANNER_TRACE_ADMIN_SESSION_ID).
// Here that session exists only on the emulator, so read it back with the emulator's
// owner token and hand its ID to the admin spec's project through a file (#947).
const firestoreEmulator = `http://${process.env.STUDYPLANNER_E2E_FIRESTORE_EMULATOR_HOST}`;

test('hand the privacy spec\'s synthetic trace session to the admin spec', async ({ request }) => {
  const response = await request.get(
    `${firestoreEmulator}/v1/projects/demo-studyplanner/databases/(default)/documents/weekly_planning_trace_sessions?pageSize=100`,
    { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok()).toBe(true);
  const { documents = [] } = await response.json();
  // The dedicated trace account deletes its own session, so only the live account's remains.
  const synthetic = documents.filter((document) =>
    document.fields?.appVersion?.stringValue?.startsWith('live-e2e-'));
  expect(synthetic).toHaveLength(1);
  await writeFile(process.env.STUDYPLANNER_E2E_TRACE_SESSION_FILE, synthetic[0].name.split('/').pop());
});
