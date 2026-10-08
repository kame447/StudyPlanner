import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { SDK_VERSION } from 'firebase/app';
import { context, measure, observedResults } from './firestore-read-load-emulator.integration';
import { runApprovalMeasurement } from './firestore-read-load-emulator.approval';
import { NOW, OWNER } from './firestoreReadLoad.fixtures';

async function main() {
  const mode = process.env.FIRESTORE_READ_LOAD_APPROVAL_MODE;
  const replay = process.env.FIRESTORE_READ_LOAD_APPROVAL_REPLAY === '1';
  assert(mode === 'before' || mode === 'after');
  // Fix Date only inside this child for equal fixture/approval timestamps on
  // both sides. Network timers and the emulator's clock remain real; this is
  // request-count evidence, not a latency benchmark.
  const OriginalDate = Date;
  globalThis.Date = new Proxy(OriginalDate, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [NOW]); },
    get(target, key) { return key === 'now' ? () => OriginalDate.parse(NOW) : Reflect.get(target, key); },
  });
  const results = [];
  try {
    for (const scale of [1, 10, 100]) {
      const host = process.env.FIRESTORE_READ_LOAD_HOST!;
      // This reset addresses only this runner's fresh, synthetic demo project.
      const reset = await fetch(`http://${host}/emulator/v1/projects/demo-studyplanner-read-load/databases/(default)/documents`,
        { method: 'DELETE' });
      assert(reset.ok, `Synthetic emulator reset failed: ${reset.status}`);
      const client = context(OWNER);
      try {
        const result = await runApprovalMeasurement(client.db, { measure, mode, scale, replay });
        results.push(result);
        if (result.status !== 'passed') break;
      } finally { await client.close(); }
    }
  } finally { globalThis.Date = OriginalDate; }
  const report = {
    project: 'demo-studyplanner-read-load', endpoint: process.env.FIRESTORE_READ_LOAD_HOST,
    mode, replay, emulatorVersion: '1.20.2', firebaseSdkVersion: SDK_VERSION, nodeVersion: process.version,
    sdkTransport: 'Node gRPC', rules: 'repository firestore.rules, unchanged',
    scope: 'Real app/data hooks, Firebase repositories, and weekly approval transactions; auth/catalog/notices substituted.',
    limitations: ['Emulator RPC messages do not equal billable reads; security-rule dependent reads are excluded.',
      'A denied save is recorded as a blocker, never counted as successful read reduction.'],
    results, transport: observedResults,
  };
  await writeFile(process.env.FIRESTORE_READ_LOAD_REPORT!, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (results.some(result => result.status !== 'passed')) process.exitCode = 2;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
