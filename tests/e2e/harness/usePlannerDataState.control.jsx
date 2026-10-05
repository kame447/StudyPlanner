import { useEffect } from 'react';
import { createEmptyMonthEventDraft, createEmptyPlanDraft } from '../../../src/domain/planner';
import { usePlannerDataState as useRealPlannerDataState } from '../../../src/hooks/usePlannerDataState';

// Importer-scoped observer/driver for the SAME hook mounted by usePlannerAppState.
// It returns the production result unchanged; there is no replacement authority,
// state setter, fake readiness, second hook instance, or App remount.
export function usePlannerDataState(options) {
  const result = useRealPlannerDataState(options);
  useEffect(() => {
    window.__plannerRecoveryHook ??= { mounts: 0, unmounts: 0 };
    window.__plannerRecoveryHook.mounts += 1;
    return () => { window.__plannerRecoveryHook.unmounts += 1; };
  }, []);
  useEffect(() => {
    const control = window.__plannerRecoveryHook;
    control.refresh = () => result.loadPlannerData(options.userId);
    control.snapshot = () => ({ ownerId: options.userId,
      ready: result.isPlannerDataSnapshotCurrent(), availability: result.plannerDataAvailability,
      recovery: result.plannerDataRecovery, plans: result.plans, actuals: result.actuals, materials: result.studyMaterials,
      todos: result.todos,
      monthEvents: result.monthEvents, monthDate: result.monthDate, selectedDate: result.selectedDate,
      mounts: control.mounts, unmounts: control.unmounts });
    control.startTodoSchedule = ({ date, title }) => {
      if (control.saving) throw new Error('A fixture save is already pending');
      const todo = result.todos.find(item => item.id === 'read-repair-todo');
      if (!todo) throw new Error('Missing read repair Todo');
      control.saving = true;
      control.saveError = null;
      control.saveComplete = false;
      void result.scheduleTodoAsPlan(todo, { ...createEmptyPlanDraft(options.userId, date), title,
        startTime: '09:00', endTime: '10:00' })
        .then(() => { control.saveComplete = true; })
        .catch(error => { control.saveError = String(error); })
        .finally(() => { control.saving = false; });
    };
    control.startPlan = ({ date, title }) => {
      if (control.saving) throw new Error('A fixture save is already pending');
      control.saving = true;
      control.saveError = null;
      control.saveComplete = false;
      void result.savePlanDraft({ ...createEmptyPlanDraft(options.userId, date), title,
        startTime: '09:00', endTime: '10:00' })
        .then(() => { control.saveComplete = true; })
        .catch(error => { control.saveError = String(error); })
        .finally(() => { control.saving = false; });
    };
    control.deletePlan = planId => {
      const plan = result.plans.find(item => item.id === planId);
      if (!plan) throw new Error(`Missing real Plan ${planId}`);
      return result.deletePlan(plan);
    };
    control.startMonthEvent = ({ date, title, endDate }) => {
      if (control.saving) throw new Error('A fixture save is already pending');
      control.saving = true;
      control.saveError = null;
      control.saveComplete = false;
      // Invoke the same public callback used by MonthView, without mounting a
      // second hook or replacing its state while another App surface is open.
      void result.saveMonthEvent({ ...createEmptyMonthEventDraft(options.userId, date), title,
        ...(endDate === undefined ? {} : { endDate }) })
        .then(() => { control.saveComplete = true; })
        .catch(error => { control.saveError = String(error); })
        .finally(() => { control.saving = false; });
    };
    control.startActual = () => {
      if (control.saving) throw new Error('A fixture save is already pending');
      control.saving = true;
      control.saveError = null;
      control.saveComplete = false;
      // The browser race drives the public production hook callback because OCR
      // and the Actual save must overlap without replacing the AI surface.
      void result.saveStandaloneActual({ userId: options.userId, planId: null,
        occurrenceDate: result.selectedDate, actualStartTime: '09:00', actualEndTime: '09:30',
        title: '保存済みの学習記録', subject: '数学', isAlignedToPlan: false,
        note: 'held actual acknowledgment', materialProgressUpdates: [{ materialId: 'material-before-refresh', deltaUnits: 5 }] })
        .then(() => { control.saveComplete = true; })
        .catch(error => { control.saveError = String(error); })
        .finally(() => { control.saving = false; });
    };
  });
  return result;
}
