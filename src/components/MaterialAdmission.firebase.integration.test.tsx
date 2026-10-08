import { BookshelfView } from './BookshelfView';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';
import { BookshelfSubjectDialog } from './BookshelfSubjectDialog';
import { HomeView } from './HomeView';
import { createActualDraftForPlan } from '../lib/actualDrafts';
import { createLocalFixture, actual, deferred, microtasks } from '../repositories/localPersistenceConcurrency.testUtils';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { plan } from '../repositories/localPersistenceConcurrency.testUtils';
import { StudySessionProvider } from './StudySessionView';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
const sdk=vi.hoisted(()=>({ rows:new Map<string,Map<string,any>>(), log:[] as string[], gate:null as null|Promise<void>, entered:false }));
const boundary=vi.hoisted(()=>({repository:null as unknown as PlannerRepository}));
vi.mock('../repositories',()=>({plannerRepository:new Proxy({},{get:(_t,k)=>boundary.repository[k as keyof PlannerRepository]})}));
// Portal placement is presentation-only; production Home, Bookshelf, editors and adapters remain intact.
vi.mock('react-dom',async(importOriginal)=>({...await importOriginal<typeof import('react-dom')>(),createPortal:(children:unknown)=>children}));
vi.mock('firebase/firestore',()=>({
  collection:(_db:any,name:string)=>({name}), doc:(_db:any,collectionName:string,id:string)=>({collectionName,id}),
  where:(field:string,_op:string,value:any)=>({field,value}), query:(collection:any,...conditions:any[])=>({...collection,conditions}), deleteField:()=>null,
  getDocs:async(q:any)=>{if(q.name==='actuals' && q.conditions.some((c:any)=>c.field==='occurrenceDate') && sdk.gate){const g=sdk.gate;sdk.gate=null;sdk.entered=true;sdk.log.push('query-pending');await g;sdk.log.push('query-finished');}
    const values=[...(sdk.rows.get(q.name)?.values()??[])].filter(row=>q.conditions.every((c:any)=>row[c.field]===c.value));
    return {docs:values.map(row=>({id:row.id,data:()=>structuredClone(row)}))};},
  deleteDoc:async(ref:any)=>{sdk.log.push('delete:'+ref.id);sdk.rows.get(ref.collectionName)?.delete(ref.id);},
  setDoc:async(ref:any,value:any)=>{let rows=sdk.rows.get(ref.collectionName);if(!rows)sdk.rows.set(ref.collectionName,rows=new Map());rows.set(ref.id,structuredClone(value));},
  writeBatch:()=>{const ops:any[]=[];return {set:(ref:any,value:any)=>ops.push({ref,value}),delete:(ref:any)=>ops.push({ref}),commit:async()=>{for(const {ref,value} of ops){let rows=sdk.rows.get(ref.collectionName);if(!rows)sdk.rows.set(ref.collectionName,rows=new Map());if(value){sdk.log.push('set:'+ref.id);rows.set(ref.id,structuredClone(value));}else rows.delete(ref.id);}}};},
}));
import {createFirebasePlannerRepository} from '../repositories/firebasePlannerRepository';
let renderer:ReactTestRenderer|undefined,state:UsePlannerDataStateResult;
const p=plan({title:'Math',startTime:'19:00',endTime:'20:00'}), noop=()=>{};
const notices=vi.fn();
const firstPlan={...p,materialId:'material',materialName:'Book'};
const secondPlan={...firstPlan,id:'other-plan',seriesId:'other-plan',title:'Math second',startTime:'20:00',endTime:'21:00'};
function Harness(){state=usePlannerDataState({userId:'owner',showNotice:notices});return <StudySessionProvider userId="owner" materials={state.studyMaterials} onSaveActual={state.saveActual} onSaveStandaloneActual={state.saveStandaloneActual}><HomeView plans={state.plans} actuals={state.actuals} todos={state.todos} studyMaterials={state.studyMaterials} primaryHeaderRef={{current:null}} primaryBottomNavRef={{current:null}} onOpenAiPlanning={noop} onOpenSchedule={noop} onAddEntry={noop} onOpenDay={noop} onOpenTodo={noop} onOpenBookshelf={noop} onOpenReport={noop}/></StudySessionProvider>}
function button(label:string){return renderer!.root.findAllByType('button').find(b=>b.children.includes(label))!;}
async function click(label:string){await act(async()=>{button(label).props.onClick()});}
beforeEach(()=>{sdk.rows.clear();sdk.rows.set('plans',new Map([[p.id,p]]));sdk.log=[];sdk.gate=null;sdk.entered=false;notices.mockClear();
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-04T19:59:00'));
  vi.stubGlobal('window',{requestAnimationFrame:()=>0,cancelAnimationFrame:noop,addEventListener:noop,removeEventListener:noop,setTimeout,clearTimeout,setInterval,clearInterval,matchMedia:()=>({matches:true}),confirm:()=>true});
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},body:{style:{overflow:'',overscrollBehavior:''}}});
  boundary.repository=createFirebasePlannerRepository({} as Firestore);
});
afterEach(()=>{act(()=>renderer?.unmount());renderer=undefined;vi.unstubAllGlobals();vi.useRealTimers()});
async function inputProgress(value:string){await act(async()=>{renderer!.root.findByProps({id:'study-session-progress'}).props.onChange({target:{value}});});}
async function back(){await act(async()=>{renderer!.root.findByProps({'aria-label':'戻る'}).props.onClick();});}
const material={id:'material',userId:'owner',name:'Book',subjectId:'math',subjectName:'Math',paceEnabled:true,progressUnit:'page' as const,currentUnit:10,totalUnits:100,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
async function mount(){
 sdk.rows.set('plans',new Map([[firstPlan.id,firstPlan],[secondPlan.id,secondPlan]]));
 sdk.rows.set('study_materials',new Map([[material.id,material]]));
 await act(async()=>{renderer=create(<Harness/>);});await act(async()=>{await state.loadPlannerData('owner');});
}
async function homeStart(){await act(async()=>{renderer!.root.findByProps({className:'home-start-button'}).props.onClick();});}
function progressDraft(target:typeof firstPlan, delta:number){return {...createActualDraftForPlan(target),materialProgressUpdates:[{materialId:'material',deltaUnits:delta}]};}
it('public Home next-plan busy rejection preserves B progress through A completion and retries from committed material',async()=>{
 await mount();
 expect(renderer!.root.findByProps({'data-home-section':'next-plan'}).findByType('h1').children).toEqual(['Math']);
 let release!:()=>void;sdk.gate=new Promise<void>(r=>release=r);
 await homeStart();await click('スタート');vi.setSystemTime(new Date('2026-10-04T20:00:00'));await click('終了する');await inputProgress('5');await click('記録を保存');
 expect(sdk.entered).toBe(true);
 await back();await back();
 expect(renderer!.root.findAllByProps({role:'dialog'})).toHaveLength(0);
 expect(renderer!.root.findByProps({'data-home-section':'next-plan'}).findByType('h1').children).toEqual(['Math second']);
 await homeStart();await click('スタート');await click('終了する');await inputProgress('7');await click('記録を保存');
 expect((await boundary.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(10);
 expect(await boundary.repository.getActuals('owner')).toHaveLength(0);
 expect(renderer!.root.findByProps({id:'study-session-progress'}).props.value).toBe('7');
 expect(renderer!.root.findAll(node=>node.type==='p' && node.children.some(child=>typeof child==='string' && child.includes('保存・更新中'))).length).toBeGreaterThan(0);
 await act(async()=>{release();});
 expect((await boundary.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(15);
 expect(renderer!.root.findByProps({id:'study-session-progress'}).props.value).toBe('7');
 await click('記録を保存');
 expect(await boundary.repository.getActuals('owner')).toHaveLength(2);
 expect((await boundary.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(22);
});
it('retained save callback after first acknowledgement resolves fresh committed material progress',async()=>{
 await mount();const retainedSave=state.saveActual;
 await act(async()=>{await retainedSave(firstPlan,progressDraft(firstPlan,5));});
 expect(state.studyMaterials[0].currentUnit).toBe(15);
 await act(async()=>{await retainedSave(secondPlan,progressDraft(secondPlan,7));});
 expect(await boundary.repository.getActuals('owner')).toHaveLength(2);
 expect((await boundary.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(22);
});
it('fresh save callback after first acknowledgement uses current progress',async()=>{
 await mount();
 await act(async()=>{await state.saveActual(firstPlan,progressDraft(firstPlan,5));});
 expect(state.studyMaterials[0].currentUnit).toBe(15);
 await act(async()=>{await state.saveActual(secondPlan,progressDraft(secondPlan,7));});
 expect(await boundary.repository.getActuals('owner')).toHaveLength(2);
 expect((await boundary.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(22);
});
it('public local factory serializes writes but cannot rebase material rows computed before queue entry',async()=>{
 const f=createLocalFixture();await f.repository.upsertStudyMaterial(material);
 await Promise.all([
  f.repository.upsertActualWithMaterialProgress({actual:actual({id:'A',planId:null,materialProgressUpdates:[{materialId:'material',deltaUnits:5}]}),materials:[{...material,currentUnit:15}]}),
  f.repository.upsertActualWithMaterialProgress({actual:actual({id:'B',planId:null,materialProgressUpdates:[{materialId:'material',deltaUnits:7}]}),materials:[{...material,currentUnit:17}]}),
 ]);
 expect(await f.repository.getActuals('owner')).toHaveLength(2);
 expect((await f.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(17);
});
it('disjoint materials remain isolated despite late shared-hook acknowledgement',async()=>{
 await mount();sdk.rows.get('study_materials')!.set('other-material',{...material,id:'other-material'});
 await act(async()=>{await state.loadPlannerData('owner');});
 let release!:()=>void;sdk.gate=new Promise<void>(r=>release=r);let first!:Promise<void>;
 await act(async()=>{first=state.saveActual(firstPlan,progressDraft(firstPlan,5));});
 expect(sdk.entered).toBe(true);
 await act(async()=>{await state.saveActual(secondPlan,{...progressDraft(secondPlan,7),materialProgressUpdates:[{materialId:'other-material',deltaUnits:7}]});});
 await act(async()=>{release();await first;});
 expect(await boundary.repository.getActuals('owner')).toHaveLength(2);
 expect((await boundary.repository.getStudyMaterials('owner')).map(m=>[m.id,m.currentUnit]).sort()).toEqual([['material',15],['other-material',17]]);
});

it('each Study Session launch fences old success and exit callbacks even for the same Plan object', async () => {
  const { useStudySessionLauncher } = await import('./StudySessionView');
  let launch!: NonNullable<ReturnType<typeof useStudySessionLauncher>>;
  function LaunchProbe() { launch = useStudySessionLauncher()!; return null; }
  let complete!: () => void;
  const saved = new Promise<void>(resolve => { complete = resolve; });
  // The promise needs its resolver established before the provider invokes it.
  const save = vi.fn(() => saved);
  await act(async () => {
    renderer = create(<StudySessionProvider userId="owner" materials={[material]} onSaveActual={save} onSaveStandaloneActual={save}><LaunchProbe /></StudySessionProvider>);
    await Promise.resolve();
  });
  await act(async () => { launch({ kind: 'planned', plan: firstPlan }); });
  const oldExit = renderer!.root.findByProps({ role: 'dialog' }).parent!.props.onClose;
  await click('スタート'); await click('終了する'); await inputProgress('5'); await click('記録を保存');
  await back(); await back();
  await act(async () => { launch({ kind: 'planned', plan: firstPlan }); });
  await click('スタート'); await click('終了する'); await inputProgress('7');
  await act(async () => { oldExit(); complete(); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findByProps({ id: 'study-session-progress' }).props.value).toBe('7');
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
});

it('Study Session keeps original uncertain-write error and progress input, and requires inspection instead of replay', async () => {
  await mount();
  const original = boundary.repository.upsertActualWithMaterialProgress;
  const failure = new Error('Firebase acknowledgement lost');
  const write = vi.fn(async (mutation: Parameters<typeof original>[0]) => { await original(mutation); throw failure; });
  boundary.repository = { ...boundary.repository, upsertActualWithMaterialProgress: write };
  await homeStart(); await click('スタート'); await click('終了する'); await inputProgress('5'); await click('記録を保存');
  expect(await boundary.repository.getActuals('owner')).toHaveLength(1);
  expect(state.studyMaterials[0].currentUnit).toBe(15);
  expect(renderer!.root.findByProps({ id: 'study-session-progress' }).props.value).toBe('5');
  const error = renderer!.root.findByProps({ role: 'alert' }).children.join('');
  expect(error).toContain(failure.message);
  expect(error).toContain('開き直');
  expect(button('記録を保存').props.disabled).toBe(true);
  await click('記録を保存');
  await back(); await click('終了する');
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('開き直');
  expect(button('記録を保存').props.disabled).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
});

const subject = { id: 'math', userId: 'owner', name: 'Math', color: '#123456', createdAt: material.createdAt, updatedAt: material.updatedAt };
function BookshelfHarness() {
  state = usePlannerDataState({ userId: 'owner', showNotice: notices });
  return <BookshelfView userId="owner" subjects={state.studySubjects} materials={state.studyMaterials}
    plans={state.plans} actuals={state.actuals} onSaveSubject={state.saveStudySubject}
    onDeleteSubject={state.deleteStudySubject} onCaptureMaterialBaseline={state.captureStudyMaterialBaseline}
    onSaveMaterial={state.saveStudyMaterial} onDeleteMaterial={state.deleteStudyMaterial} onAddMaterialToPlan={noop} />;
}
async function mountBookshelf() {
  sdk.rows.set('plans', new Map([[firstPlan.id, firstPlan], [secondPlan.id, secondPlan]]));
  sdk.rows.set('study_materials', new Map([[material.id, material]]));
  sdk.rows.set('study_subjects', new Map([[subject.id, subject]]));
  await act(async () => { renderer = create(<BookshelfHarness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
}
async function openMaterialEditor() {
  await act(async () => { renderer!.root.findAllByProps({ 'aria-label': 'Bookのメニュー' })[0].props.onClick({ stopPropagation: noop }); });
  await click('教材情報・進捗を編集');
}
async function submitMaterial() {
  await act(async () => { await renderer!.root.findByType(BookshelfMaterialDialog).findByType('form').props.onSubmit({ preventDefault: noop }); });
}
const materialNameInput = () => renderer!.root.findByProps({ placeholder: '黄色チャート' });
const currentUnitInput = () => renderer!.root.findByProps({ placeholder: '例: 45ページ' });

it('real Bookshelf captures one immutable baseline, preserves busy/stale absolute inputs, and reopening permits a deliberate absolute value', async () => {
  await mountBookshelf(); await openMaterialEditor();
  const baseline = renderer!.root.findByType(BookshelfMaterialDialog).props.baseline;
  expect(Object.isFrozen(baseline)).toBe(true);
  await act(async () => {
    materialNameInput().props.onChange({ target: { value: 'Keep this draft name' } });
    currentUnitInput().props.onChange({ target: { value: '12' } });
  });
  let release!: () => void; sdk.gate = new Promise<void>(resolve => { release = resolve; });
  let saving!: Promise<void>;
  await act(async () => { saving = state.saveActual(firstPlan, progressDraft(firstPlan, 5)); });
  const before = sdk.log.filter(entry => entry === 'set:material').length;
  await submitMaterial();
  expect(sdk.log.filter(entry => entry === 'set:material')).toHaveLength(before);
  expect(materialNameInput().props.value).toBe('Keep this draft name');
  expect(currentUnitInput().props.value).toBe('12');
  expect(renderer!.root.findByProps({ className: 'inline-error' }).children.join('')).toContain('保存・更新中');
  await act(async () => { release(); await saving; });
  expect(renderer!.root.findByType(BookshelfMaterialDialog).props.baseline).toBe(baseline);
  await submitMaterial();
  expect((await boundary.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(15);
  expect(materialNameInput().props.value).toBe('Keep this draft name');
  expect(currentUnitInput().props.value).toBe('12');
  expect(renderer!.root.findByProps({ className: 'inline-error' }).children.join('')).toContain('開き直');
  await click('キャンセル'); await openMaterialEditor();
  expect(currentUnitInput().props.value).toBe('15');
  expect(renderer!.root.findByType(BookshelfMaterialDialog).props.baseline).not.toBe(baseline);
  await act(async () => { currentUnitInput().props.onChange({ target: { value: '12' } }); });
  await submitMaterial();
  expect(renderer!.root.findAllByType(BookshelfMaterialDialog)).toHaveLength(0);
  expect((await boundary.repository.getStudyMaterials('owner'))[0].currentUnit).toBe(12);
});

it('uncertain material save preserves fields and original error while preventing blind save/delete replay', async () => {
  await mountBookshelf(); await openMaterialEditor();
  const original = boundary.repository.upsertStudyMaterial;
  const failure = new Error('Material acknowledgement lost');
  const write = vi.fn(async (row: Parameters<typeof original>[0]) => { await original(row); throw failure; });
  boundary.repository = { ...boundary.repository, upsertStudyMaterial: write };
  await act(async () => { materialNameInput().props.onChange({ target: { value: 'Saved but uncertain' } }); });
  await submitMaterial();
  expect(materialNameInput().props.value).toBe('Saved but uncertain');
  const error = renderer!.root.findByProps({ className: 'inline-error' }).children.join('');
  expect(error).toContain(failure.message); expect(error).toContain('開き直');
  expect(button('保存').props.disabled).toBe(true);
  expect(button('削除').props.disabled).toBe(true);
  await submitMaterial(); await click('削除');
  expect(write).toHaveBeenCalledTimes(1);
  expect((await boundary.repository.getStudyMaterials('owner'))[0].name).toBe('Saved but uncertain');
});

it('subject editor retains original uncertain fanout error and input, requiring inspect/reopen before resubmission', async () => {
  const failure = new Error('Subject acknowledgement lost');
  const save = vi.fn(async () => { throw failure; });
  await act(async () => { renderer = create(<BookshelfSubjectDialog userId="owner" subject={subject}
    onClose={noop} onSave={save} onDelete={async () => {}} hasMaterials />); });
  await act(async () => { renderer!.root.findByProps({ placeholder: '数学' }).props.onChange({ target: { value: 'New subject label' } }); });
  const submit = () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: noop });
  await act(async () => { await submit(); });
  expect(renderer!.root.findByProps({ placeholder: '数学' }).props.value).toBe('New subject label');
  expect(renderer!.root.findByProps({ className: 'inline-error' }).children.join('')).toContain(failure.message);
  expect(button('保存').props.disabled).toBe(true);
  await act(async () => { await submit(); });
  expect(save).toHaveBeenCalledTimes(1);
});

it.each(['save', 'delete'] as const)('unchanged open Bookshelf %s remains usable after an equal-content full reread', async action => {
  await mountBookshelf(); await openMaterialEditor();
  const original = state.studyMaterials[0];
  const baseline = renderer!.root.findByType(BookshelfMaterialDialog).props.baseline;
  if (action === 'save') {
    await act(async () => { materialNameInput().props.onChange({ target: { value: 'Unsaved name survives refresh' } }); });
  }
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.studyMaterials[0]).toEqual(original);
  expect(state.studyMaterials[0]).not.toBe(original);
  expect(renderer!.root.findByType(BookshelfMaterialDialog).props.baseline).toBe(baseline);
  if (action === 'save') await submitMaterial(); else await click('削除');
  expect(renderer!.root.findAllByType(BookshelfMaterialDialog)).toHaveLength(0);
  const stored = await boundary.repository.getStudyMaterials('owner');
  if (action === 'save') expect(stored[0].name).toBe('Unsaved name survives refresh');
  else expect(stored).toEqual([]);
});

it.each(['scope-reset', 'observed-recreation'] as const)('open Bookshelf Delete cannot silently replace its original baseline after %s', async transition => {
  await mountBookshelf(); await openMaterialEditor();
  const original = state.studyMaterials[0];
  const baseline = renderer!.root.findByType(BookshelfMaterialDialog).props.baseline;
  if (transition === 'scope-reset') {
    await act(async () => { state.resetPlannerData(); });
  } else {
    await boundary.repository.deleteStudyMaterial('owner', original.id);
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.studyMaterials).toEqual([]);
    await boundary.repository.upsertStudyMaterial(original);
  }
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.studyMaterials[0]).toEqual(original);
  expect(renderer!.root.findByType(BookshelfMaterialDialog).props.baseline).toBe(baseline);
  const deletes = sdk.log.filter(entry => entry === 'delete:material').length;
  await click('削除');
  expect(sdk.log.filter(entry => entry === 'delete:material')).toHaveLength(deletes);
  expect(renderer!.root.findByProps({ className: 'inline-error' }).children.join('')).toContain('開き直');
  expect(renderer!.root.findAllByType(BookshelfMaterialDialog)).toHaveLength(1);
  expect(await boundary.repository.getStudyMaterials('owner')).toEqual([original]);
  await click('キャンセル'); await openMaterialEditor(); await click('削除');
  expect(await boundary.repository.getStudyMaterials('owner')).toEqual([]);
});


it.each(['save', 'delete'] as const)('late Bookshelf %s completion cannot close a newer material draft', async action => {
  await mountBookshelf(); await openMaterialEditor();
  const gate = deferred();
  if (action === 'save') {
    const original = boundary.repository.upsertStudyMaterial;
    boundary.repository = { ...boundary.repository, upsertStudyMaterial: async row => { const saved = await original(row); await gate.promise; return saved; } };
  } else {
    const original = boundary.repository.deleteStudyMaterial;
    boundary.repository = { ...boundary.repository, deleteStudyMaterial: async (...args) => { await original(...args); await gate.promise; } };
  }
  let saving!: Promise<void>;
  await act(async () => {
    saving = action === 'save'
      ? renderer!.root.findByType(BookshelfMaterialDialog).findByType('form').props.onSubmit({ preventDefault: noop })
      : button('削除').props.onClick();
    await microtasks();
  });
  await click('キャンセル'); await click('教材追加');
  await act(async () => { materialNameInput().props.onChange({ target: { value: 'New unsaved draft' } }); });
  await act(async () => { gate.resolve(); await saving; await microtasks(); });
  expect(renderer!.root.findAllByType(BookshelfMaterialDialog)).toHaveLength(1);
  expect(materialNameInput().props.value).toBe('New unsaved draft');
});
