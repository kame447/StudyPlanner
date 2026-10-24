import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { deferred, plan, todo } from '../repositories/localPersistenceConcurrency.testUtils';
import { DayView } from './DayView';
import { QuickEntryModal } from './QuickEntryModal';
import { ActualEditorCard } from './ActualEditorCard';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
const sdk=vi.hoisted(()=>({ rows:new Map<string,Map<string,any>>(), log:[] as string[], gate:null as null|Promise<void>, entered:false, gateField: 'occurrenceDate' }));
const boundary=vi.hoisted(()=>({repository:null as unknown as PlannerRepository}));
vi.mock('../repositories',()=>({plannerRepository:new Proxy({},{get:(_t,k)=>boundary.repository[k as keyof PlannerRepository]})}));
// Portal placement is presentation-only; the real DayView, editors and mutation code remain intact.
vi.mock('react-dom',async(importOriginal)=>({...await importOriginal<typeof import('react-dom')>(),createPortal:(children:unknown)=>children}));
vi.mock('firebase/firestore',()=>({
  documentId:()=> '__name__',
  collection:(_db:any,name:string)=>({name}), doc:(_db:any,collectionName:string,id:string)=>({collectionName,id}),
  where:(field:string,_op:string,value:any)=>({field,value}), query:(collection:any,...conditions:any[])=>({...collection,conditions}), deleteField:()=>null,
  getDocs:async(q:any)=>{if(q.name==='actuals' && q.conditions.some((c:any)=>c.field===sdk.gateField) && sdk.gate){const g=sdk.gate;sdk.gate=null;sdk.entered=true;sdk.log.push('query-pending');await g;sdk.log.push('query-finished');}
    const values=[...(sdk.rows.get(q.name)?.entries()??[])].filter(([id,row])=>q.conditions.every((c:any)=>(c.field==='__name__'?id:row[c.field])===c.value));
    return {docs:values.map(([id,row])=>({id,data:()=>structuredClone(row)}))};},
  deleteDoc:async(ref:any)=>{sdk.log.push('delete:'+ref.id);sdk.rows.get(ref.collectionName)?.delete(ref.id);},
  setDoc:async(ref:any,value:any)=>{sdk.log.push('set:'+ref.id);let rows=sdk.rows.get(ref.collectionName);if(!rows)sdk.rows.set(ref.collectionName,rows=new Map());rows.set(ref.id,structuredClone(value));},
  writeBatch:()=>{const ops:any[]=[];return {set:(ref:any,value:any)=>ops.push({ref,value}),delete:(ref:any)=>ops.push({ref}),commit:async()=>{for(const {ref,value} of ops){let rows=sdk.rows.get(ref.collectionName);if(!rows)sdk.rows.set(ref.collectionName,rows=new Map());if(value){sdk.log.push('set:'+ref.id);rows.set(ref.id,structuredClone(value));}else rows.delete(ref.id);}}};},
  runTransaction: async (_db:any, callback:any) => {
    const ops:any[]=[];
    const result = await callback({
      get:async(ref:any)=>{
        if(ops.length) throw Error('transaction read after write');
        const value=sdk.rows.get(ref.collectionName)?.get(ref.id);
        if(!value) throw Error('permission-denied');
        return {id:ref.id,exists:()=>true,data:()=>structuredClone(value)};
      },
      set:(ref:any,value:any,options:any)=>ops.push({ref,value,options}), delete:(ref:any)=>ops.push({ref}),
    });
    for(const {ref,value,options} of ops){
      let rows=sdk.rows.get(ref.collectionName);if(!rows)sdk.rows.set(ref.collectionName,rows=new Map());
      if(value){sdk.log.push('set:'+ref.id);rows.set(ref.id,structuredClone(options?.merge?{...rows.get(ref.id),...value}:value));}
      else {sdk.log.push('delete:'+ref.id);rows.delete(ref.id);}
    }
    return result;
  },
}));
import {createFirebasePlannerRepository} from '../repositories/firebasePlannerRepository';
let renderer:ReactTestRenderer|undefined,state:UsePlannerDataStateResult;
const p=plan({title:'Math',startTime:'19:00',endTime:'20:00'}), noop=()=>{}, noopAsync=async()=>{};
const notices=vi.fn();
function Harness(){state=usePlannerDataState({userId:'owner',showNotice:notices});const[quick,setQuick]=useState(true);return <>
  <DayView userId="owner" selectedDate={p.date} plans={state.plans} actuals={state.actuals} monthEvents={[]} studySubjects={[]} studyMaterials={[]} scheduleTemplates={[]} timetableTermId="" onChangeDay={noop} onEditPlan={noop} onMovePlan={noopAsync} onDeletePlan={state.deletePlan} onDeleteMonthEvent={noopAsync} onSavePlan={noopAsync} getActualActionBlockReason={state.getActualActionBlockReason} onSaveActual={state.saveActual} onSaveStandaloneActual={state.saveStandaloneActual} onLinkStandaloneActualToPlan={state.linkStandaloneActualToPlan} onDeleteActual={state.deleteActual} onOpenBookshelf={noop} onOpenAddMaterial={noop}/>
  {quick?<QuickEntryModal userId="owner" selectedDate={p.date} plans={state.plans} actuals={state.actuals} materials={[]} subjects={[]} onClose={()=>setQuick(false)} onSaveTodo={noopAsync} onSavePlan={noopAsync} onSaveStandaloneActual={state.saveStandaloneActual} onSaveLinkedActual={state.saveActual}/>:null}
  </>}
function button(label:string){return renderer!.root.findAllByType('button').find(b=>b.children.includes(label))!;}
async function click(label:string){await act(async()=>{button(label).props.onClick()});}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);sdk.rows.clear();sdk.rows.set('plans',new Map([[p.id,p]]));sdk.log=[];sdk.gate=null;sdk.entered=false;sdk.gateField='occurrenceDate';notices.mockClear();
  vi.stubGlobal('window',{addEventListener:noop,removeEventListener:noop,setTimeout,clearTimeout,matchMedia:()=>({matches:true}),confirm:()=>true,
    requestAnimationFrame:()=>1,cancelAnimationFrame:noop});
  vi.stubGlobal('HTMLElement',class {});
  vi.stubGlobal('document',Object.assign(new EventTarget(),{activeElement:null,body:{style:{overflow:'',overscrollBehavior:''}}}));
  boundary.repository=createFirebasePlannerRepository({} as Firestore);
});
afterEach(()=>{act(()=>renderer?.unmount());renderer=undefined;vi.unstubAllGlobals()});
async function createFromQuickEntry(){
  await act(async()=>{renderer=create(<Harness/>)});await act(async()=>{await state.loadPlannerData('owner')});
  await click('記録');await act(async()=>{renderer!.root.findByProps({placeholder:'例: 英語の復習'}).props.onChange({target:{value:'Math'}})});
  await click('60分');await click('この予定に紐づけて保存');
}
async function openOptimisticEditor(){
  if(renderer!.root.findAllByType(QuickEntryModal).length) await click('閉じる');
  expect(renderer!.root.findAllByType(QuickEntryModal)).toHaveLength(0);
  await act(async()=>{renderer!.root.findAllByType('button').find(b=>String(b.props.className).includes('timeline-actual-block'))!.props.onClick()});
  await act(async()=>{renderer!.root.findAllByType('button').find(b=>b.findAllByType('strong').some(s=>s.children.join('')==='記録を編集'))!.props.onClick()});
  expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(1);
}
it('real components + Firebase adapter: pending Quick Entry save cannot open its optimistic editor across surfaces',async()=>{
  let release!:()=>void;sdk.gate=new Promise<void>(r=>release=r);
  await createFromQuickEntry();expect(sdk.entered).toBe(true);const id=state.actuals[0].id;
  await click('閉じる');
  await act(async()=>{renderer!.root.findAllByType('button').find(b=>String(b.props.className).includes('timeline-actual-block'))!.props.onClick()});
  const recordButton = renderer!.root.findAllByType('button').find(b=>b.findAllByType('strong').some(s=>s.children.join('')==='記録を編集'))!;
  expect(recordButton.props.disabled).toBe(true);
  // Invoke the handler as a retained-callback defense, despite the disabled UI.
  await act(async()=>{recordButton.props.onClick()});
  expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(0);
  expect(renderer!.root.findAllByProps({role:'alert'}).some(n=>n.children.join('').includes('開き直し'))).toBe(true);
  expect(sdk.log).not.toContain('delete:'+id);
  expect(notices.mock.calls.some(c=>c[0]==='記録を削除しました。')).toBe(false);
  await act(async()=>{release();});
  expect(state.getActualActionBlockReason(state.actuals[0])).toBeNull();
  await act(async()=>{renderer!.root.findAllByType('button').find(b=>b.findAllByType('strong').some(s=>s.children.join('')==='記録を編集'))!.props.onClick()});
  expect(renderer!.root.findAllByType(ActualEditorCard)).toHaveLength(1);
  await click('記録削除');
  expect(sdk.log.indexOf('set:'+id)).toBeLessThan(sdk.log.indexOf('delete:'+id));
  expect(await boundary.repository.getActuals('owner')).toEqual([]);
});

it('control: the same real-component route deletes a settled Firebase save',async()=>{
  await createFromQuickEntry();const id=state.actuals[0].id;await openOptimisticEditor();await click('記録削除');
  expect(sdk.log.indexOf('set:'+id)).toBeLessThan(sdk.log.indexOf('delete:'+id));
  expect(await boundary.repository.getActuals('owner')).toEqual([]);
});
it('real immutable editor opened before another save rejects its retired explicit ID after canonicalization, and preserves its draft',async()=>{
  const provisional = {id:'provisional',userId:'owner',planId:p.id,occurrenceDate:p.date,title:p.title,subject:p.subject,actualStartTime:'19:00',actualEndTime:'20:00',isAlignedToPlan:true,note:'original',updatedAt:'2026-01-01T00:00:00Z'};
  sdk.rows.set('actuals',new Map([[provisional.id,provisional]]));
  await act(async()=>{renderer=create(<Harness/>)});await act(async()=>{await state.loadPlannerData('owner')});
  await openOptimisticEditor();
  const note = renderer!.root.findAllByType('textarea')[0];
  await act(async()=>{note.props.onChange({target:{value:'keep this draft'}})});
  let release!:()=>void;sdk.gate=new Promise<void>(r=>release=r);let saving!:Promise<void>;
  await act(async()=>{saving=state.saveActual(p,{...provisional,materialProgressUpdates:[]},provisional.id)});
  // Explicit additional premise: another writer supplied the canonical occurrence.
  sdk.rows.set('actuals',new Map([['canonical',{...provisional,id:'canonical'}]]));
  await act(async()=>{release();await saving;});
  expect(state.actuals[0].id).toBe('canonical');
  expect(renderer!.root.findByType(ActualEditorCard).props.actual.id).toBe(provisional.id);
  await click('記録削除');
  expect(sdk.log).not.toContain('delete:'+provisional.id);
  expect(notices.mock.calls.some(c=>c[0]==='記録を削除しました。')).toBe(false);
  expect(renderer!.root.findAllByProps({role:'alert'}).some(n=>n.children.join('').includes('開き直し'))).toBe(true);
  expect(renderer!.root.findAllByType('textarea')[0].props.value).toBe('keep this draft');
  expect((await boundary.repository.getActuals('owner')).map(a=>a.id)).toEqual(['canonical']);
  await act(async()=>{renderer!.root.findByProps({'aria-label':'戻る'}).props.onClick()});
  await act(async()=>{renderer!.root.findAllByType('button').find(b=>b.findAllByType('strong').some(s=>s.children.join('')==='記録を編集'))!.props.onClick()});
  expect(renderer!.root.findByType(ActualEditorCard).props.actual.id).toBe('canonical');
  await click('記録削除');
  expect(await boundary.repository.getActuals('owner')).toEqual([]);
});

it('real UI Plan deletion rejects during linked Actual query, then succeeds after the save settles without an orphan',async()=>{
  let release!:()=>void;sdk.gate=new Promise<void>(r=>release=r);
  await createFromQuickEntry();const id=state.actuals[0].id;
  await click('閉じる');
  await act(async()=>{renderer!.root.findAllByType('button').find(b=>String(b.props.className).includes('timeline-actual-block'))!.props.onClick()});
  const deletePlanButton = () => renderer!.root.findAllByType('button').find(b=>b.findAllByType('strong').some(s=>s.children.join('')==='削除'))!;
  await act(async()=>{deletePlanButton().props.onClick()});
  expect((await boundary.repository.getPlans('owner')).map(plan=>plan.id)).toEqual([p.id]);
  expect(notices.mock.calls.some(c=>c[0]==='削除しました')).toBe(false);
  expect(renderer!.root.findAllByProps({role:'alert'}).some(n=>n.children.join('').includes('開き直し'))).toBe(true);
  await act(async()=>{release();});
  expect((await boundary.repository.getActuals('owner')).map(a=>a.id)).toEqual([id]);
  await act(async()=>{deletePlanButton().props.onClick()});
  expect(await boundary.repository.getActuals('owner')).toEqual([]);
  expect(await boundary.repository.getPlans('owner')).toEqual([]);
});


it.each(['edit', 'delete'] as const)('normal Plan deletion rejects a linked Todo %s during the actual query', async operation => {
  const linkedPlan = { ...p, sourceType: 'todo' as const, sourceId: 'todo' };
  const linkedTodo = todo({ scheduledPlanId: linkedPlan.id });
  sdk.rows.set('plans', new Map([[linkedPlan.id, linkedPlan]]));
  sdk.rows.set('todos', new Map([[linkedTodo.id, linkedTodo]]));
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const retained = state;
  let release!: () => void;
  sdk.gateField = 'planId';
  sdk.gate = new Promise<void>(resolve => { release = resolve; });
  let deleting!: Promise<void>;
  await act(async () => { deleting = state.deletePlan(linkedPlan); });
  expect(sdk.entered).toBe(true);
  let conflict: unknown;
  await act(async () => {
    try {
      if (operation === 'edit') await retained.saveTodo({ ...linkedTodo, title: 'newer Todo title' }, linkedTodo.id);
      else await retained.deleteTodo(linkedTodo);
    } catch (error) { conflict = error; }
  });
  const beforeRelease = await boundary.repository.getTodos('owner');
  await act(async () => { release(); await deleting; });
  const durableTodos = await boundary.repository.getTodos('owner');
  expect(await boundary.repository.getPlans('owner')).toEqual([]);
  // An admitted newer write must never be overwritten or resurrected by the
  // captured Todo carried through the delayed Firebase query.
  if (!conflict) expect.soft(durableTodos).toEqual(beforeRelease);
  expect.soft(conflict).toBeInstanceOf(Error);
  expect.soft(durableTodos).toEqual([expect.objectContaining({ id: linkedTodo.id, title: linkedTodo.title, status: 'open', scheduledPlanId: null })]);
});


function DataHarness({ owner = 'owner' }: { owner?: string }) {
  state = usePlannerDataState({ userId: owner, showNotice: notices });
  return null;
}
async function mountLinkedTodo(concurrent = false) {
  const linkedPlan = { ...p, sourceType: 'todo' as const, sourceId: 'todo' };
  const linkedTodo = todo({ scheduledPlanId: linkedPlan.id });
  sdk.rows.set('plans', new Map([[linkedPlan.id, linkedPlan]]));
  sdk.rows.set('todos', new Map([[linkedTodo.id, linkedTodo]]));
  await act(async () => { renderer = create(<DataHarness />, { createNodeMock: () => null, unstable_isConcurrent: concurrent } as Parameters<typeof create>[1]); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return { linkedPlan, linkedTodo };
}
function pausePlanActualQuery() {
  const gate = deferred();
  sdk.gateField = 'planId';
  sdk.gate = gate.promise;
  return gate;
}

it.each(['edit', 'delete'] as const)('normal Plan deletion rejects during a prior linked Todo %s, then safely retries', async operation => {
  const { linkedPlan, linkedTodo } = await mountLinkedTodo();
  const retained = state;
  const gate = deferred();
  const originalSave = boundary.repository.upsertTodo;
  const originalDelete = boundary.repository.deleteTodo;
  boundary.repository.upsertTodo = async row => { await gate.promise; return originalSave(row); };
  boundary.repository.deleteTodo = async (...args) => { await gate.promise; return originalDelete(...args); };
  let first!: Promise<void>;
  await act(async () => {
    first = operation === 'edit'
      ? state.saveTodo({ ...linkedTodo, title: 'updated before deletion' }, linkedTodo.id)
      : state.deleteTodo(linkedTodo);
  });
  let conflict: unknown;
  await act(async () => { try { await state.deletePlan(linkedPlan); } catch (error) { conflict = error; } });
  expect(conflict).toBeInstanceOf(Error);
  expect((await boundary.repository.getPlans('owner')).map(row => row.id)).toEqual([linkedPlan.id]);
  await act(async () => { gate.resolve(); await first; });
  // The retained callback must consult committed Todo state, not its old array.
  await act(async () => { await retained.deletePlan(linkedPlan); });
  expect(await boundary.repository.getPlans('owner')).toEqual([]);
  expect(await boundary.repository.getTodos('owner')).toEqual(operation === 'delete' ? [] : [expect.objectContaining({
    id: linkedTodo.id, title: 'updated before deletion', status: 'open', scheduledPlanId: null,
  })]);
});

it.each(['success', 'failure'] as const)('linked Todo stays reserved through Plan-delete %s until committed publication, then retries', async outcome => {
  const { linkedPlan, linkedTodo } = await mountLinkedTodo(true);
  const retained = state;
  const gate = pausePlanActualQuery();
  let deleting!: Promise<void>, failure: unknown, conflict: unknown;
  await act(async () => { deleting = state.deletePlan(linkedPlan).catch(error => { failure = error; }); });
  expect(sdk.entered).toBe(true);
  await act(async () => {
    if (outcome === 'success') gate.resolve(); else gate.reject(new Error('query failure'));
    await deleting;
    try { await retained.deleteTodo(linkedTodo); } catch (error) { conflict = error; }
  });
  expect(conflict).toBeInstanceOf(Error);
  if (outcome === 'failure') {
    expect(failure).toBeInstanceOf(Error);
    expect(state.plans.map(row => row.id)).toEqual([linkedPlan.id]);
    expect(state.todos).toEqual(await boundary.repository.getTodos('owner'));
    await act(async () => { await state.deletePlan(linkedPlan); });
  } else expect(failure).toBeUndefined();
  await act(async () => { await state.saveTodo({ ...state.todos[0], title: 'retry after publication' }, linkedTodo.id); });
  expect(await boundary.repository.getPlans('owner')).toEqual([]);
  expect(await boundary.repository.getTodos('owner')).toEqual([expect.objectContaining({
    title: 'retry after publication', status: 'open', scheduledPlanId: null,
  })]);
});

it('Plan deletion uses the latest matching Todo after a read and leaves a reassigned Todo untouched', async () => {
  const { linkedPlan, linkedTodo } = await mountLinkedTodo();
  const retained = state;
  await boundary.repository.upsertTodo({ ...linkedTodo, title: 'latest metadata', memo: 'latest memo' });
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { await retained.deletePlan(linkedPlan); });
  expect(await boundary.repository.getTodos('owner')).toEqual([expect.objectContaining({
    title: 'latest metadata', memo: 'latest memo', status: 'open', scheduledPlanId: null,
  })]);
  // Another valid Plan association must not be undone by this stale Plan source.
  await boundary.repository.upsertPlan(linkedPlan);
  await boundary.repository.upsertTodo({ ...linkedTodo, title: 'reassigned', scheduledPlanId: 'other-plan' });
  await act(async () => { await state.loadPlannerData('owner'); });
  sdk.log = [];
  await act(async () => { await retained.deletePlan(linkedPlan); });
  expect(sdk.log).not.toContain('set:' + linkedTodo.id);
  expect(await boundary.repository.getTodos('owner')).toEqual([expect.objectContaining({ title: 'reassigned', scheduledPlanId: 'other-plan' })]);
});

it('pending Plan deletion permits unrelated Todo edits and owner replacement without stale UI publication', async () => {
  const { linkedPlan } = await mountLinkedTodo();
  const otherTodo = todo({ id: 'other-todo', title: 'independent', status: 'open', scheduledPlanId: null });
  await boundary.repository.upsertTodo(otherTodo);
  await act(async () => { await state.loadPlannerData('owner'); });
  const gate = pausePlanActualQuery();
  let deleting!: Promise<void>, staleCompletion: unknown;
  await act(async () => { deleting = state.deletePlan(linkedPlan).catch(error => { staleCompletion = error; }); });
  await act(async () => { await state.saveTodo({ ...otherTodo, title: 'independent edit' }, otherTodo.id); });
  expect((await boundary.repository.getTodos('owner')).find(row => row.id === otherTodo.id)?.title).toBe('independent edit');
  const nextTodo = todo({ id: 'next-owner-todo', userId: 'next-owner', status: 'open', scheduledPlanId: null });
  await boundary.repository.upsertTodo(nextTodo);
  await act(async () => { renderer!.update(<DataHarness owner="next-owner" />); });
  await act(async () => { await state.loadPlannerData('next-owner'); });
  notices.mockClear();
  await act(async () => { gate.resolve(); await deleting; });
  expect(staleCompletion).toBeInstanceOf(Error);
  expect(state.todos).toEqual(await boundary.repository.getTodos('next-owner'));
  expect(state.plans).toEqual([]);
  expect(notices).not.toHaveBeenCalled();
  await act(async () => { await state.saveTodo({ ...nextTodo, title: 'new owner can edit' }, nextTodo.id); });
  expect((await boundary.repository.getTodos('next-owner'))[0].title).toBe('new owner can edit');
});

it.each(['pending', 'failed'] as const)('linked Todo stays fenced while crossing-read repair is %s after Plan deletion', async repair => {
  const { linkedPlan, linkedTodo } = await mountLinkedTodo();
  const retained = state;
  const gate = pausePlanActualQuery();
  let deleting!: Promise<void>;
  await act(async () => { deleting = state.deletePlan(linkedPlan); });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.todos[0].scheduledPlanId).toBe(linkedPlan.id);
  const repairGate = deferred();
  const originalGet = boundary.repository.getTodos;
  boundary.repository.getTodos = async owner => {
    if (repair === 'failed') throw new Error('repair offline');
    await repairGate.promise;
    return originalGet(owner);
  };
  await act(async () => { gate.resolve(); await deleting; });
  expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
  expect(await originalGet('owner')).toEqual([expect.objectContaining({ status: 'open', scheduledPlanId: null })]);
  sdk.log = [];
  await act(async () => { await expect(retained.saveTodo({ ...linkedTodo, title: 'stale edit' }, linkedTodo.id)).rejects.toThrow('再読み込み'); });
  expect(sdk.log).toEqual([]);
  boundary.repository.getTodos = originalGet;
  await act(async () => { repairGate.resolve(); });
  if (repair === 'failed') await act(async () => { await state.retryPlannerData(); });
  expect(state.todos).toEqual(await originalGet('owner'));
  await act(async () => { await state.saveTodo({ ...state.todos[0], title: 'fresh edit' }, linkedTodo.id); });
  expect(await originalGet('owner')).toEqual([expect.objectContaining({ title: 'fresh edit', status: 'open', scheduledPlanId: null })]);
});
