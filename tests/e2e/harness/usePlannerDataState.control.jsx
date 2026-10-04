import { useEffect } from 'react';
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
      recovery: result.plannerDataRecovery, actuals: result.actuals, materials: result.studyMaterials,
      mounts: control.mounts, unmounts: control.unmounts });
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
