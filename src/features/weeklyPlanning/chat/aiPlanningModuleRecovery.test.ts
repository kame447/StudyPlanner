import { expect, it, vi } from 'vitest';
import { createMemoryStorageHarness } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { AI_PLANNING_MODULE_RECOVERY_KEY as KEY, AI_PLANNING_MODULE_RECOVERY_MAX_BYTES as MAX,
  AI_PLANNING_MODULE_RECOVERY_TTL_MS as TTL, saveAiPlanningModuleRecovery as save,
  readAiPlanningModuleRecovery as read, consumeAiPlanningModuleRecovery as consume } from './aiPlanningModuleRecovery';
const binding={ownerId:'a',chatId:'chat-a',conversationId:'conversation-a',weekStartDate:'2026-10-05',revision:2};
const now=123456;
const starter={displayText:'課題',prompt:'この課題を計画',requestText:'  課題を計画\n',target:{kind:'todo' as const,id:'todo-a',label:'課題',targetDate:'2026-10-08'}};
const draft=()=>({text:'  課題を計画\n',selectedStarter:starter,attachment:new File([new Uint8Array([0,128,255,10])],'画像.png',{type:'image/png',lastModified:42})});
it('roundtrips exact text, selected starter, original file bytes and metadata; consumes only after acknowledgment',async()=>{
 const {storage}=createMemoryStorageHarness();const input=draft();expect(await save({storage,binding,draft:input,isCurrent:()=>true,now,token:'a'})).toBe(true);
 const result=read(storage,binding,now+1)!;expect(result.draft.text).toBe(input.text);expect(result.draft.selectedStarter).toEqual(starter);
 expect(result.draft.attachment).toMatchObject({name:'画像.png',type:'image/png',size:4,lastModified:42});expect(new Uint8Array(await result.draft.attachment!.arrayBuffer())).toEqual(new Uint8Array(await input.attachment.arrayBuffer()));
 expect(storage.getItem(KEY)).not.toBeNull();consume(storage,binding,result.token);expect(storage.getItem(KEY)).toBeNull();
});
it('rejects another owner/chat/conversation/week/revision without consuming their valid capsule',async()=>{
 const {storage}=createMemoryStorageHarness();await save({storage,binding,draft:draft(),isCurrent:()=>true,now,token:'a'});
 for(const patch of [{ownerId:'b'},{chatId:'b'},{conversationId:'b'},{weekStartDate:'2026-10-12'},{revision:3}])expect(read(storage,{...binding,...patch},now+1)).toBeNull();expect(storage.getItem(KEY)).not.toBeNull();
});
it('30-minute TTL expires exactly at the boundary and removes the expired local capsule',async()=>{
 const {storage}=createMemoryStorageHarness();await save({storage,binding,draft:draft(),isCurrent:()=>true,now,token:'a'});expect(read(storage,binding,now+TTL-1)).not.toBeNull();expect(read(storage,binding,now+TTL)).toBeNull();expect(storage.getItem(KEY)).toBeNull();
});
it.each(['json','version','attachment','starter','size','future','starter-kind-array','attachment-type-array'])('rejects corrupt %s records without returning partial input',async(kind)=>{
 const {storage}=createMemoryStorageHarness();await save({storage,binding,draft:draft(),isCurrent:()=>true,now,token:'a'});const raw=storage.getItem(KEY)!;const value=JSON.parse(raw);
 if(kind==='json')storage.setItem(KEY,'{broken');else{if(kind==='version')value.version=99;if(kind==='attachment')value.attachment.type='text/html';if(kind==='starter')value.selectedStarter.target.kind='unknown';if(kind==='starter-kind-array')value.selectedStarter.target.kind=['todo'];if(kind==='attachment-type-array')value.attachment.type=['image/png'];if(kind==='size')value.attachment.size+=1;if(kind==='future'){value.createdAt=now+100;value.expiresAt=now+100+TTL}storage.setItem(KEY,JSON.stringify(value))}
 expect(read(storage,binding,now)).toBeNull();expect(storage.getItem(KEY)).toBeNull();
});
it('blocks quota and read-back failures, and preserves source input',async()=>{
 const input=draft();for(const corrupt of [false,true]){const {storage}=createMemoryStorageHarness();if(corrupt)storage.getItem=()=>'{broken';else storage.setItem=()=>{throw new DOMException('quota','QuotaExceededError')};expect(await save({storage,binding,draft:input,isCurrent:()=>true,now})).toBe(false)}expect(input.text).toBe('  課題を計画\n');expect(input.attachment.size).toBe(4);
});
it('rejects oversize attachments before reading or lossy resizing',async()=>{
 const {storage}=createMemoryStorageHarness();const file=new File([new Uint8Array(MAX)],'large.png',{type:'image/png'});const readBytes=vi.spyOn(file,'arrayBuffer');expect(await save({storage,binding,draft:{...draft(),attachment:file},isCurrent:()=>true,now})).toBe(false);expect(readBytes).not.toHaveBeenCalled();expect(storage.getItem(KEY)).toBeNull();
});
it('does not persist after owner/session cancellation during file serialization',async()=>{
 const {storage}=createMemoryStorageHarness();const file=draft().attachment;let current=true;const real=file.arrayBuffer.bind(file);vi.spyOn(file,'arrayBuffer').mockImplementation(async()=>{current=false;return real()});expect(await save({storage,binding,draft:{...draft(),attachment:file},isCurrent:()=>current,now})).toBe(false);expect(storage.getItem(KEY)).toBeNull();
});
it('an old acknowledgment never deletes a newer explicit recovery capsule',async()=>{
 const {storage}=createMemoryStorageHarness();await save({storage,binding,draft:draft(),isCurrent:()=>true,now,token:'a'});await save({storage,binding,draft:{...draft(),text:'new'},isCurrent:()=>true,now:now+1,token:'b'});consume(storage,binding,'a');expect(read(storage,binding,now+2)?.draft.text).toBe('new');
});
