import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { DayView } from '../../../src/components/DayView';
import { resolveActiveTimetableTerm } from '../../../src/domain/timetableTerm';
import { useThemePreference } from '../../../src/hooks/useThemePreference';
import { usePlannerDataState } from './usePlannerDataState.control.jsx';
import '../../../src/styles.css';

// The schedule redesign hides its legacy DayView header, including the import
// opener. This is the reusable DayView + real hook/local repository integration,
// not a claim that the current full-App shell exposes that entry point.
const owner = 'timetable-import-owner';
const noop = () => undefined;
function Harness() {
  useThemePreference();
  const state = usePlannerDataState({ userId: owner, showNotice: noop });
  useEffect(() => { void state.loadPlannerData(owner); }, []);
  const { term, termId } = resolveActiveTimetableTerm(state.timetableTerms);
  return <main>
    <h1>日表示の時間割反映検証</h1>
    <DayView userId={owner} selectedDate={state.selectedDate}
      plans={state.plans} actuals={state.actuals} monthEvents={state.monthEvents}
      studySubjects={state.studySubjects} studyMaterials={state.studyMaterials}
      scheduleTemplates={state.scheduleTemplates} timetableTermId={termId}
      timetableTerm={term} timetableTerms={state.timetableTerms}
      onChangeDay={state.openDay} onEditPlan={state.openEditPlan}
      onMovePlan={state.movePlanOccurrence} onDeletePlan={state.deletePlan}
      onDeleteMonthEvent={state.deleteMonthEvent} onSavePlan={state.savePlanDraft}
      getActualActionBlockReason={state.getActualActionBlockReason}
      onSaveActual={state.saveActual} onSaveStandaloneActual={state.saveStandaloneActual}
      onLinkStandaloneActualToPlan={state.linkStandaloneActualToPlan}
      onDeleteActual={state.deleteActual} onOpenBookshelf={noop} onOpenAddMaterial={noop} />
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><Harness /></React.StrictMode>);
