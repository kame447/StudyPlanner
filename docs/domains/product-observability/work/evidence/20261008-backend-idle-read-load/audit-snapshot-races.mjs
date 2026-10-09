// Independent offline snapshot audit; repository sources are read, never changed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const repo = path.resolve(process.argv[2]);
const require = createRequire(path.join(repo, 'package.json'));
const { build } = require('esbuild');
const sourcePath = path.join(repo, 'workers/ai-proxy/src/productObservabilityActiveUserSnapshot.test.ts');
let fixture = fs.readFileSync(sourcePath, 'utf8');
fixture = fixture.slice(0, fixture.indexOf("describe('ProductObservabilityActiveUserSnapshotService'"))
  .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict';");
fixture += `
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const key = ACTIVE_USER_SNAPSHOT_JOB_COLLECTION + '/' + ACTIVE_USER_SNAPSHOT_JOB_ID;
const snapshotKey = 'observability_active_user_windows/production:2026-08-28';
const scanning = { schemaVersion: 1, status: 'scanning', taskKey: 'bootstrap:production:2026-08-28',
  source: null, environment: 'production', targetDate: '2026-08-28', scanDateIndex: 29, cursor: null,
  updatedAt: '2026-08-28T11:00:00.000Z' };
function seedScan(db) {
 db.documents.set(key, copy(scanning));
 db.documents.set(snapshotKey, {schemaVersion:1, environment:'production', asOfDate:'2026-08-28', today:999});
 db.addActorDay('current-actor', actorDay({localDate:'2026-08-28',actorSubjectId:'actor-auditeduser'}));
}
function report(name, db, result) {
 console.log(JSON.stringify({scenario:name,result,readSetSizes:db.readRequests.map(r=>r.keys.length),
  rollbackCount:db.rollbackCount,jobStatus:db.documents.get(key)?.status,today:db.documents.get(snapshotKey)?.today}));
}
{
 const db = new MemorySnapshotFirestore(); seedScan(db);
 const result = await service(db).runBatch([]);
 assert.equal(result.published,true); assert.equal(result.pageReads,1);
 assert.equal(db.documents.get(snapshotKey).today,1);
 assert.deepEqual(db.readRequests.map(r=>r.keys.length),[2,66,66]);
 report('existing-snapshot-does-not-skip-unfinished-bootstrap',db,result);
}
{
 const db = new MemorySnapshotFirestore();
 db.afterNonTransactionalRead=()=>{if(db.readRequests.length===1)seedScan(db);};
 const result=await service(db).runBatch([]);
 assert.equal(result.published,true); assert.equal(result.pageReads,1);
 assert.equal(db.documents.get(snapshotKey).today,1);
 assert.deepEqual(db.readRequests.map(r=>r.keys.length),[2,66,66]);
 report('inconclusive-probe-refetches-new-scanning-job',db,result);
}
{
 const db=new MemorySnapshotFirestore();
 db.documents.set(snapshotKey,{schemaVersion:1,environment:'production',asOfDate:'2026-08-28',today:999});
 db.afterNonTransactionalRead=()=>{seedScan(db);db.afterNonTransactionalRead=null;};
 const first=await service(db).runBatch([]);
 assert.equal(first.published,false); assert.equal(first.completedSource,null);
 assert.equal(db.documents.get(key).status,'scanning');
 assert.equal(db.documents.get(snapshotKey).today,999); assert.equal(db.transactionSequence,0);
 report('job-starts-after-clean-probe-no-mutation',db,first);
 const second=await service(db).runBatch([]);
 assert.equal(second.published,true); assert.equal(db.documents.get(snapshotKey).today,1);
 report('new-job-resumes-next-invocation',db,second);
}
{
 const db=new MemorySnapshotFirestore();seedScan(db);db.changeStateBeforeTransactionalRead=true;
 const result=await service(db).runBatch([]);
 assert.equal(result.published,false); assert.equal(result.hasMore,true); assert.equal(result.completedSource,null);
 assert.equal(db.documents.get(snapshotKey).today,999);assert.equal(db.documents.get(key).status,'scanning');
 assert.equal(db.rollbackCount,1);assert.deepEqual(db.readRequests.map(r=>r.keys.length),[2,66,66]);
 report('fallback-full-read-still-rejects-transactional-conflict',db,result);
}
`;
const built=await build({stdin:{contents:fixture,resolveDir:path.dirname(sourcePath),loader:'ts'},bundle:true,
 platform:'node',format:'esm',write:false,logLevel:'silent'});
await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const runtimePath=path.join(repo,'workers/ai-proxy/src/productObservabilityActiveUserSnapshot.ts');
console.log(JSON.stringify({runtimePath,runtimeSha256:createHash('sha256').update(fs.readFileSync(runtimePath)).digest('hex'),
 assertions:'all passed', externalRequests:0, repositoryWrites:0, scope:'4 independent mocked scenarios; not live Firestore or full verification'}));
