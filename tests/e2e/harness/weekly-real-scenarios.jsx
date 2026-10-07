import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AiPlanningView } from '../../../src/components/AiPlanningView';
import { WeeklyPlanningArchitectureSetting } from '../../../src/components/WeeklyPlanningArchitectureSetting';
import { useWeeklyPlanningApplication } from '../../../src/features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { getWeeklyPlanningTurnMeasurements } from '../../../src/features/weeklyPlanning/application/weeklyPlanningTurnMeasurement';
import { CAMPAIGN, CAMPAIGN_MATERIALS, campaignProviderReply } from '../../../src/features/weeklyPlanning/testUtils/weeklyPlanningRealE2ECampaignFixture';
import '../../../src/styles.css';

const scenario = new URLSearchParams(location.search).get('scenario') ?? 'A';
const calls = [];
const failures = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith('https://weekly-campaign.invalid/')) return originalFetch(input, init);
  const request = JSON.parse(String(init?.body));
  calls.push(request);
  try {
    const content = campaignProviderReply(scenario, request);
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    failures.push(String(error));
    throw error;
  }
};
const empty = [];
const availability = { status: 'ready', ownerId: 'issue488-owner', observedAt: '2026-10-07T09:00:00.000Z', lastSuccessfulAt: '2026-10-07T09:00:00.000Z' };
const snapshotCurrent = () => true;
const saved = [];
async function save(draft) { saved.push(draft); throw new Error('This preview-only fixture must never save.'); }

function CampaignHarness() {
  const [settings, setSettings] = useState(false);
  const application = useWeeklyPlanningApplication({ userId: 'issue488-owner', selectedDate: '2026-10-07',
    plans: empty, actuals: empty, studyMaterials: CAMPAIGN_MATERIALS, scheduleTemplates: empty,
    plannerDataAvailability: availability, isPlannerDataSnapshotCurrent: snapshotCurrent, saveWeeklyApprovedPlan: save });
  useEffect(() => {
    window.__weeklyCampaign = { state: application.state, calls, failures, saved, texts: CAMPAIGN[scenario],
      measurements: getWeeklyPlanningTurnMeasurements, reset: application.resetSession };
  }, [application]);
  return <main>
    <button data-testid="campaign-settings" onClick={() => setSettings(!settings)}>評価設定</button>
    {settings && <div role="dialog" aria-label="評価設定" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#fff', padding: 16 }}>
      <WeeklyPlanningArchitectureSetting />
      <button onClick={() => setSettings(false)}>設定を閉じる</button>
    </div>}
    <AiPlanningView application={application} userId="issue488-owner" selectedDate="2026-10-07" plans={empty} />
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<CampaignHarness />);
