import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { plan } from '../repositories/localPersistenceConcurrency.testUtils';
import { DayView } from './DayView';
import { QuickEntryModal } from './QuickEntryModal';
import { ActualEditorCard } from './ActualEditorCard';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
const sdk=vi.hoisted(()=>({ rows:new Map<string,Map<string,any>>(), log:[] as string[], gate:null as null|Promise<void>, entered:false }));
const boundary=vi.hoisted(()=>({repository:null as unknown as PlannerRepository}));
vi.mock('../repositories',()=>({plannerRepository:new Proxy({},{get:(_t,k)=>boundary.repository[k as keyof PlannerRepository]})}));
// Portal placement is presentation-only; the real DayView, editors and mutation code remain intact.
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
const p=plan({title:'Math',startTime:'19:00',endTime:'20:00'}), noop=()=>{}, noopAsync=async()=>{};
const notices=vi.fn();
function Harness(){state=usePlannerDataState({userId:'owner',showNotice:notices});const[quick,setQuick]=useState(true);return <>
  <DayView userId="owner" selectedDate={p.date} plans={state.plans} actuals={state.actuals} monthEvents={[]} studySubjects={[]} studyMaterials={[]} scheduleTemplates={[]} timetableTermId="" onChangeDay={noop} onEditPlan={noop} onMovePlan={noopAsync} onDeletePlan={state.deletePlan} onDeleteMonthEvent={noopAsync} onSavePlan={noopAsync} getActualActionBlockReason={state.getActualActionBlockReason} onSaveActual={state.saveActual} onSaveStandaloneActual={state.saveStandaloneActual} onLinkStandaloneActualToPlan={state.linkStandaloneActualToPlan} onDeleteActual={state.deleteActual} onOpenBookshelf={noop} onOpenAddMaterial={noop}/>
  {quick?<QuickEntryModal userId="owner" selectedDate={p.date} plans={state.plans} actuals={state.actuals} materials={[]} subjects={[]} onClose={()=>setQuick(false)} onSaveTodo={noopAsync} onSavePlan={noopAsync} onSaveStandaloneActual={state.saveStandaloneActual} onSaveLinkedActual={state.saveActual}/>:null}
  </>}
function button(label:string){return renderer!.root.findAllByType('button').find(b=>b.children.includes(label))!;}
async function click(label:string){await act(async()=>{button(label).props.onClick()});}
beforeEach(()=>{sdk.rows.clear();sdk.rows.set('plans',new Map([[p.id,p]]));sdk.log=[];sdk.gate=null;sdk.entered=false;notices.mockClear();
  vi.stubGlobal('window',{addEventListener:noop,removeEventListener:noop,setTimeout,clearTimeout,matchMedia:()=>({matches:true}),confirm:()=>true});
  vi.stubGlobal('document',{body:{style:{overflow:'',overscrollBehavior:''}}});
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
