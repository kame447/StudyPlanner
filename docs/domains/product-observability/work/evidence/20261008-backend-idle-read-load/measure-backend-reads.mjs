// Offline characterization of the real scheduled Worker and REST client.
// Usage: node measure-backend-reads.mjs /absolute/StudyPlanner /tmp/output-dir
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const repo = path.resolve(process.argv[2] ?? '.');
const expectFastPath = process.argv.includes('--snapshot-fast-path');
const expectRetentionGate = process.argv.includes('--retention-gate');
const out = path.resolve(process.argv[3] ?? '/tmp/studyplanner-backend-read-results');
assert(!out.startsWith(repo + path.sep), 'Output must be outside the repository');
fs.mkdirSync(out, {recursive:true});
const require = createRequire(path.join(repo, 'package.json'));
const { build } = require('esbuild');
const fixturePath = path.join(repo, 'workers/ai-proxy/src/traceWorker.scheduledSubrequestBudget.test.ts');
let source = fs.readFileSync(fixturePath,'utf8');
assert(source.includes("beforeEach(() => {"));
source = source.slice(0, source.indexOf('beforeEach(() => {'))
 .replace('[key, firestoreValue(value)]', "[key, key === 'expireAt' || key === 'registeredAt' ? { timestampValue: value } : firestoreValue(value)]")
 .replace("import { readFileSync } from 'node:fs';", '')
 .replace("import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';", `const vi = { stubGlobal(name: string, value: unknown) { Object.defineProperty(globalThis, name, {value, configurable:true, writable:true}); } };`)
 .replaceAll("'./traceWorker'", JSON.stringify(path.join(repo,'workers/ai-proxy/src/traceWorker.ts')))
 + '\nexport {installScenario, runScheduled, firestoreDocument, planningEvent, collectionFromQuery, localDateFromQuery, queryHasCursor};\n';
const generated = path.join(out, 'fixture.ts');
fs.writeFileSync(generated,source);
const result = await build({entryPoints:[generated],outfile:path.join(out,'fixture.mjs'),bundle:true,alias:{'cloudflare:workers':path.join(repo,'workers/ai-proxy/src/cloudflareWorkersVitestStub.ts')},platform:'node',format:'esm',metafile:true,logLevel:'silent'});
const sha = x => createHash('sha256').update(x).digest('hex');
const sources = Object.keys(result.metafile.inputs).map(file => {const absolute = path.resolve(file); return {path:path.relative(repo,absolute),sha256:sha(fs.readFileSync(absolute))};}).sort((a,b)=>a.path.localeCompare(b.path));
const fixture = await import(pathToFileURL(path.join(out,'fixture.mjs')));
const NativeDate = Date;
globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-09-25T12:00:00.000Z'])); } static now() {return new NativeDate('2026-09-25T12:00:00.000Z').getTime();} };
const realInfo=console.info, realWarn=console.warn, realError=console.error;
const reports=[];
function json(data,status=200) {return new Response(JSON.stringify(data),{status});}
const idleJob={schemaVersion:1,status:'idle',taskKey:null,source:null,environment:null,targetDate:null,scanDateIndex:0,cursor:null,updatedAt:'2026-09-25T00:00:00.000Z'};
async function scenario(name,kind,minute,options={}) {
 const metrics={name,kind,minute,http:0,oauth:0,pointCalls:0,pointKeys:0,pointFound:0,pointMissing:0,queryCalls:0,queryDocuments:0,emptyQueries:0,aggregationCalls:0,syntheticAggregationCountSum:0,commits:0,commitWriteCounts:[],writeDocuments:0,deleteDocuments:0,verifyDocuments:0,beginTransactions:0,rollbacks:0,queries:[],pointCollections:{},errors:[],warnings:[]};
 const committedMutations=[];
 const state=fixture.installScenario(kind,options.state ?? {});
 const underlying=globalThis.fetch;
 // No fall-through to the native fetch implementation exists.
 globalThis.fetch=async(input,init)=>{
  const url=String(input), body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
  let response;
  if (url.includes(':runQuery') && kind==='rollup' && options.events!==undefined) {
   state.calls.push({url,init});
   const start=state.rollupSuccessfulBatches*20, count=Math.max(0,Math.min(20,options.events-start));
   response=json(Array.from({length:count},(_,offset)=>{const i=start+offset; const event=fixture.planningEvent(i); if(options.sameActor)event.actorSubjectId='actor-00000000'; if(options.sameSession)event.correlation.featureSessionId='session-0'; return {document:fixture.firestoreDocument('observability_events',`event-${String(i).padStart(4,'0')}`,event)};}));
  } else if (url.includes(':runQuery') && kind==='retention' && options.retainedPerCollection!==undefined) {
   state.calls.push({url,init});
   const collection=fixture.collectionFromQuery(init); const count=Math.min(body.structuredQuery.limit,options.retainedPerCollection);
   response=json(Array.from({length:count},(_,i)=>({document:fixture.firestoreDocument(collection,`retained-${String(i).padStart(4,'0')}`,{expireAt:'2027-01-01T00:00:00.000Z'})})));
  } else if (url.includes(':runQuery') && kind==='snapshot' && options.actorsPerDate!==undefined) {
   state.calls.push({url,init});
   const localDate=fixture.localDateFromQuery(init);
   const cursor=body.structuredQuery.startAt?.values?.[1]?.referenceValue;
   const start=cursor?Number(cursor.slice(cursor.lastIndexOf('-')+1))+1:0;
   const count=Math.max(0,Math.min(500,options.actorsPerDate-start));
   response=json(Array.from({length:count},(_,o)=>{const i=start+o;return {document:fixture.firestoreDocument('observability_actor_day',`${localDate}-${String(i).padStart(5,'0')}`,{schemaVersion:1,environment:'production',localDate,actorSubjectId:`actor-${String(i).padStart(8,'0')}`})};}));
  } else {
   response=await underlying(input,init);
  }
  let payload; try {payload=await response.clone().json();}catch{payload=null;}
  if(options.idleJobExists && url.endsWith(':batchGet')) {
   payload=payload.map(entry=>entry.missing?.endsWith('/observability_active_user_snapshot_job/main')?{found:fixture.firestoreDocument('observability_active_user_snapshot_job','main',idleJob)}:entry);
   response=json(payload);
  }
  metrics.http++;
  if(url==='https://oauth2.googleapis.com/token')metrics.oauth++;
  else if(url.endsWith(':runQuery')) {
   const rows=payload.filter(r=>r.document).map(r=>r.document.name);
   metrics.queryCalls++;metrics.queryDocuments+=rows.length;if(rows.length===0)metrics.emptyQueries++;
   metrics.queries.push({collection:fixture.collectionFromQuery(init),count:rows.length,where:body.structuredQuery.where??null,cursor:body.structuredQuery.startAt??null,rowKeysSha256:sha(JSON.stringify(rows)),first:rows[0]??null,last:rows.at(-1)??null});
  } else if(url.endsWith(':runAggregationQuery')) {
   metrics.aggregationCalls++;metrics.syntheticAggregationCountSum+=Number(payload[0].result.aggregateFields.count.integerValue);
  } else if(url.endsWith(':batchGet')) {
   metrics.pointCalls++;metrics.pointKeys+=body.documents.length;
   for(const entry of payload){const key=entry.found?.name??entry.missing; const collection=key.split('/documents/')[1].split('/')[0]; const c=metrics.pointCollections[collection]??={found:0,missing:0}; if(entry.found){metrics.pointFound++;c.found++;}else{metrics.pointMissing++;c.missing++;}}
  } else if(url.endsWith(':commit')) {
   metrics.commits++;metrics.commitWriteCounts.push((body.writes??[]).length);if(response.ok)committedMutations.push(body.writes??[]);for(const w of body.writes??[]){if(w.delete)metrics.deleteDocuments++;else if(w.verify)metrics.verifyDocuments++;else metrics.writeDocuments++;}
  } else if(url.endsWith(':beginTransaction'))metrics.beginTransactions++;
  else if(url.endsWith(':rollback'))metrics.rollbacks++;
  else if(url.includes('/documents/')) {
   metrics.pointCalls++;metrics.pointKeys++; const collection=decodeURIComponent(url.split('/documents/')[1].split('/')[0]); const c=metrics.pointCollections[collection]??={found:0,missing:0}; if(response.status===404){metrics.pointMissing++;c.missing++;}else{metrics.pointFound++;c.found++;}
  } else throw new Error(`Unrecognized mock request ${url}`);
  return response;
 };
 console.info=()=>{};console.warn=(...args)=>metrics.warnings.push(args);console.error=(...args)=>metrics.errors.push(args);
 await fixture.runScheduled(minute);
 console.info=realInfo;console.warn=realWarn;console.error=realError;
 assert.equal(metrics.errors.length,0,`Worker errors in ${name}: ${JSON.stringify(metrics.errors)}`);
 assert.equal(metrics.http,state.calls.length,'every request is intercepted and counted');
 assert.equal(metrics.pointKeys,metrics.pointFound+metrics.pointMissing);
 assert(metrics.http<=45, `scheduled hard limit exceeded in ${name}`);
 metrics.returnedDocuments=metrics.pointFound+metrics.queryDocuments;
 metrics.documentReadEquivalentExcludingMissing=metrics.returnedDocuments+metrics.emptyQueries;
 metrics.documentReadEquivalentIfEveryMissingCostsOne=metrics.documentReadEquivalentExcludingMissing+metrics.pointMissing;
 metrics.stateAfter={rollupSuccessfulBatches:state.rollupSuccessfulBatches,backfillProcessed:state.backfillProcessed,backfillCompleted:state.backfillCompleted,userEnrichmentProcessed:state.userEnrichmentProcessed,retentionDeleted:state.retentionDeleted};
 metrics.committedMutationsSha256=sha(JSON.stringify(committedMutations));
 reports.push(metrics);return metrics;
}
const r0=await scenario('rollup-empty','rollup',0,{events:0}); assert.equal(r0.http,6); assert.equal(r0.pointKeys,2);assert.equal(r0.emptyQueries,1);
for(const n of [1,19,20,21,100])await scenario(`rollup-${n}-planning-unique-actors`,'rollup',0,{events:n});
await scenario('rollup-100-planning-same-actor-session','rollup',0,{events:100,sameActor:true,sameSession:true});
await scenario('rollup-100-two-late-conflicts','rollup',0,{events:100,state:{rollupConflictsRemaining:2}});
const s0=await scenario('snapshot-steady-clean-existing-job','snapshot',1,{state:{snapshotDirty:false,snapshotCurrentExists:true},idleJobExists:true});assert.equal(s0.http,3);assert.equal(s0.pointKeys,expectFastPath?3:67);assert.equal(s0.pointMissing,expectFastPath?0:64);
await scenario('snapshot-day-bootstrap-empty','snapshot',1,{state:{snapshotDirty:false},idleJobExists:true});
await scenario('snapshot-dirty-empty','snapshot',1,{state:{snapshotDirty:true},idleJobExists:true});
for(const n of [1,100,499,500,1000])await scenario(`snapshot-${n}-actors-each-30-dates`,'snapshot',1,{state:{snapshotDirty:true},actorsPerDate:n,idleJobExists:true});
const b0=await scenario('backfill-both-complete','backfill',2,{state:{backfillCompleted:true,userEnrichmentCheckpointExists:true,userEnrichmentEnvironmentIndex:4}});assert.equal(b0.http,3);assert.equal(b0.pointKeys,2);
for(const n of [0,1,100,250])await scenario(`backfill-${n}-profiles-enrichment-empty`,'backfill',2,{state:{backfillTotal:n}});
for(const n of [1,17])await scenario(`backfill-complete-${n}-unenriched-users`,'backfill',2,{state:{backfillCompleted:true,userEnrichmentTotal:n}});
await scenario('backfill-250-profiles-17-users','backfill',2,{state:{backfillTotal:250,userEnrichmentTotal:17}});
const t0=await scenario('retention-empty','retention',3);assert.equal(t0.http,5);assert.equal(t0.emptyQueries,4);
for(const n of [1,30,100,1000])await scenario(`retention-${n}-unexpired-each-4-collections`,'retention',3,{retainedPerCollection:n});
const t1=await scenario('retention-100-unexpired-repeat','retention',3,{retainedPerCollection:100});
const prior=reports.find(r=>r.name==='retention-100-unexpired-each-4-collections');assert.deepEqual(t1.queries,prior.queries);assert.equal(t1.deleteDocuments,0);
const tx=await scenario('retention-max-expired-backlog','retention',3,{state:{retentionMax:true}});assert.equal(tx.queryDocuments,expectRetentionGate?808:800);assert.equal(tx.http,expectRetentionGate?19:11);assert.equal(tx.deleteDocuments,800);
const noop=await scenario('no-op','retention',4);assert.equal(noop.http,0);
const perDay=288;
const idle=[r0,s0,b0,t0,noop];
const totals = rows => Object.fromEntries(['writeDocuments','deleteDocuments','verifyDocuments','http','oauth','pointKeys','pointFound','pointMissing','queryCalls','queryDocuments','emptyQueries','returnedDocuments','documentReadEquivalentExcludingMissing','documentReadEquivalentIfEveryMissingCostsOne'].map(k=>[k,rows.reduce((sum,r)=>sum+r[k],0)*perDay]));
const report={generatedAt:new NativeDate().toISOString(),sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sourceFingerprint:sha(JSON.stringify(sources)),runtimeInputFingerprint:sha(JSON.stringify(sources.filter(s=>!s.path.startsWith('..')))),sourceWorktreeStatus:execFileSync('git',['status','--short'],{cwd:repo,encoding:'utf8'}),sources,node:process.version,esbuild:require('esbuild/package.json').version,fixtureSha256:sha(fs.readFileSync(fixturePath)),definitions:{type:'mock REST transport characterization, not production or billing measurement',network:'native fetch is never called; OAuth and crypto are fake',returnedDocuments:'point-found + query documents; excludes missing keys and empty queries',equivalents:'conditional model, not billed reads; excludes index-entry/aggregation billing and retry scenarios unless expressly selected',fixtureLimits:'Existing scheduled-budget fixture simulates individual phase requests; rollup projection records are missing, snapshot commit state is not persisted, all aggregation mock counts are 2; growth across real days is not modeled.'},phaseRunsPerDay:perDay,idleDailyAssumingEveryRunStaysSteady:totals(idle),retained100DailyAssumingEveryRunStaysSteady:totals([r0,s0,b0,prior,noop]),reports};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(out,'summary.tsv'),['scenario\thttp\tpoint keys\tpoint found\tpoint missing\tqueries\tquery docs\tempty queries\taggregations\tdeletes\tequivalent without missing\tequivalent with missing',...reports.map(r=>[r.name,r.http,r.pointKeys,r.pointFound,r.pointMissing,r.queryCalls,r.queryDocuments,r.emptyQueries,r.aggregationCalls,r.deleteDocuments,r.documentReadEquivalentExcludingMissing,r.documentReadEquivalentIfEveryMissingCostsOne].join('\t'))].join('\n')+'\n');
console.log(fs.readFileSync(path.join(out,'summary.tsv'),'utf8'));console.log(JSON.stringify({idleDaily:report.idleDailyAssumingEveryRunStaysSteady,retained100Daily:report.retained100DailyAssumingEveryRunStaysSteady,sourceHead:report.sourceHead,sourceFingerprint:report.sourceFingerprint},null,2));
