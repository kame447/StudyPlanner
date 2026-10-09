// Independent offline review through the real retention service and REST client.
// Source files are read only. Every fetch is intercepted; no production access.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const repo = path.resolve(process.argv[2]);
const require = createRequire(path.join(repo, 'package.json'));
const { build } = require('esbuild');
const relative = 'workers/ai-proxy/src/productObservabilityRetention.ts';
const current = fs.readFileSync(path.join(repo, relative), 'utf8');
const baseline = execFileSync('git', ['show', 'HEAD:' + relative], {cwd:repo, encoding:'utf8'});
async function moduleFor(source) {
  const output = await build({stdin:{contents:source+'\nexport { FirestoreServiceAccountClient };',
    resolveDir:path.dirname(path.join(repo, relative)),loader:'ts'}, bundle:true,
    platform:'node',format:'esm',write:false,logLevel:'silent'});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
}
const oldModule = await moduleFor(baseline), newModule = await moduleFor(current);
const collections=['observability_events','observability_actor_day','observability_daily_rollups','observability_active_user_windows'];
const now='2026-08-28T12:00:00.500Z', expired={timestampValue:'2026-08-27T00:00:00Z'},
 retained={timestampValue:'2026-08-29T00:00:00Z'};
const env={FIREBASE_PROJECT_ID:'offline-test',FIREBASE_SERVICE_ACCOUNT_EMAIL:'unused',FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY:'unused'};
const clone=x=>JSON.parse(JSON.stringify(x));
function ordered(value) {
 if('nullValue' in value)return '0';
 if('booleanValue' in value)return '1'+Number(value.booleanValue);
 if('integerValue' in value)return '2'+String(value.integerValue).padStart(12,'0');
 if('timestampValue' in value) {
  const m=value.timestampValue.match(/^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/);
  if(!m)throw Error('unsupported fixture timestamp');return '3'+m[1]+'.'+(m[2]??'').padEnd(9,'0');
 }
 if('stringValue' in value)return '4'+value.stringValue;
 throw Error('unsupported fixture type');
}
async function run(mod, values, {limit=100, mutate=null, failQueryAt=0, failCommit=false, repeat=false}={}) {
 const rows=new Map(collections.map(c=>[c,values.map((value,i)=>({name:
  'projects/offline-test/databases/(default)/documents/'+c+'/'+String(i).padStart(4,'0'),
  fields:value===undefined?{}:{expireAt:clone(value)}}))]));
 const queries=[],deleted=[],commitSizes=[]; let clockCalls=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input),body=JSON.parse(String(init.body));
  if(url.endsWith(':runQuery')) {
   const q=body.structuredQuery,c=q.from[0].collectionId;
   assert(collections.includes(c));assert.equal(q.where,undefined);assert.equal(q.startAt,undefined);
   assert.deepEqual(q.orderBy,[{field:{fieldPath:'expireAt'},direction:'ASCENDING'},
    {field:{fieldPath:'__name__'},direction:'ASCENDING'}]);
   assert(q.limit>=1&&q.limit<=100);queries.push({c,limit:q.limit});
   if(queries.length===failQueryAt)return new Response('{}',{status:503});
   const selected=rows.get(c).filter(d=>d.fields.expireAt!==undefined).sort((a,b)=>{
    const aa=ordered(a.fields.expireAt),bb=ordered(b.fields.expireAt);
    return aa<bb?-1:aa>bb?1:a.name.localeCompare(b.name);
   }).slice(0,q.limit);
   const result=clone(selected.map(document=>({document})));
   if(mutate)mutate({rows,c,limit:q.limit,queryNumber:queries.length});
   return new Response(JSON.stringify(result));
  }
  if(url.endsWith(':commit')) {
   if(failCommit)return new Response('{}',{status:503});
   commitSizes.push(body.writes.length);
   for(const write of body.writes) {
    assert.equal(Object.keys(write).join(','),'delete');
    const parts=write.delete.split('/'),c=parts.at(-2);assert(collections.includes(c));
    deleted.push(write.delete);rows.set(c,rows.get(c).filter(d=>d.name!==write.delete));
   }
   return new Response('{}');
  }
  throw Error('Unexpected fetch '+url);
 };
 const client=new mod.FirestoreServiceAccountClient(env,{getToken:async()=> 'offline-test-token'});
 const service=new mod.ProductObservabilityRetentionService(env,client,()=>{clockCalls++;return new Date(now);});
 const results=[];let error=null;
 try {
  do {results.push(await service.runBatch(limit));}while(repeat&&results.at(-1).hasMore&&results.length<10);
 } catch(e) {error=e.message;}
 assert.equal(clockCalls,results.length+(error?1:0));
 return {results,queries,deleted,commitSizes,rows,error};
}
const cases=[['empty',[]],['retained',Array(101).fill(retained)],['expired-ties',Array(201).fill(expired)],
 ['mixed',[expired,retained]],['null-blocker',[{nullValue:null},expired]],
 ['number-blocker',[{integerValue:'12'},expired]],['missing',[undefined,expired]],
 ['legacy-strings',[{stringValue:'2026-08-27T00:00:00.000Z'},{stringValue:'2026-08-29T00:00:00.000Z'}]],
 ['malformed-strings',[{stringValue:''},{stringValue:'0-not-a-date'}]],
 ['zero-fraction', [{timestampValue:'2026-08-28T12:00:00Z'}]],
 ['microsecond', [{timestampValue:'2026-08-28T12:00:00.500001Z'}]]];
let equivalence=0;
for(const [name,values] of cases)for(const limit of [1,2,100]) {
 const a=await run(oldModule,values,{limit,repeat:true});const b=await run(newModule,values,{limit,repeat:true});
 assert.equal(a.error,null);assert.equal(b.error,null);assert.deepEqual(b.results,a.results);assert.deepEqual(b.deleted,a.deleted);
 equivalence++;
}
for(const change of ['retained','removed','new-null','new-expired']) {
 const r=await run(newModule,[expired],{mutate:({rows,c,queryNumber})=>{
  if(queryNumber!==1)return;
  if(change==='retained')rows.get(c)[0].fields.expireAt=clone(retained);
  if(change==='removed')rows.set(c,[]);
  if(change==='new-null'||change==='new-expired')rows.get(c).push({
   name:'projects/offline-test/databases/(default)/documents/'+c+'/new',
   fields:{expireAt:change==='new-null'?{nullValue:null}:clone(expired)}});
 }});
 const eventDeletes=r.deleted.filter(p=>p.includes('/observability_events/'));
 assert.equal(eventDeletes.length,change==='new-expired'?2:0);
 assert.deepEqual(r.queries.slice(0,2).map(q=>q.limit),[1,100]);
 console.log(JSON.stringify({scenario:'positive-gate-'+change,eventDeletes}));
}
for(const [name,options] of [['preflight-failure',{failQueryAt:1}],['full-query-failure',{failQueryAt:2}],['commit-failure',{failCommit:true}]]) {
 const result=await run(newModule,[expired],options);assert(result.error);assert.equal(result.deleted.length,0);
 assert(collections.every(c=>result.rows.get(c).length===1));
 console.log(JSON.stringify({scenario:name,error:result.error,syntheticDeletes:result.deleted.length}));
}
console.log(JSON.stringify({runtimeSha256:createHash('sha256').update(current).digest('hex'),
 baselineCandidateComparisons:equivalence,positiveGateRaces:4,failureCases:3,
 assertions:'all passed',externalRequests:0,repositoryWrites:0,
 scope:'Actual retention service and REST client with fully intercepted HTTP; independent of owner test assertions'}));
