import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MaterialQuickCreateModal } from '../../../src/components/MaterialQuickCreateModal';
import { usePlannerDataState } from '../../../src/hooks/usePlannerDataState';
import '../../../src/styles.css';

// The redesigned schedule shell intentionally hides its legacy material shelf.
// Exercise that reusable editor with the real hook and local persistence here;
// do not force-click hidden controls or claim this is the current App entry UI.
const owner = 'material-validation-user';
const date = '2026-08-19';
function Harness() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const showNotice = useCallback(message => setNotice(message), []);
  const state = usePlannerDataState({ userId: owner, showNotice });
  useEffect(() => {
    let current = true;
    void state.loadPlannerData(owner).then(() => { if (current) setReady(true); });
    return () => { current = false; };
  }, []);
  const material = state.studyMaterials.find(item => item.id === 'math-book');
  return <main>
    <h1>教材入力の保存検証</h1>
    <button disabled={!ready || !material} onClick={() => setOpen(true)}>教材入力を開く</button>
    <p role="status">{notice}</p>
    <section className="saved-records" aria-label="保存された予定・実績">
      {state.plans.filter(item => item.date === date).map(item => <p key={item.id}>{item.title}</p>)}
      {state.actuals.filter(item => item.occurrenceDate === date).map(item => <p key={item.id}>{item.title}</p>)}
    </section>
    {open && material ? <MaterialQuickCreateModal userId={owner} selectedDate={date} material={material}
      onClose={() => setOpen(false)} onSavePlan={state.savePlanDraft} onSaveStandaloneActual={state.saveStandaloneActual} /> : null}
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><Harness /></React.StrictMode>);
