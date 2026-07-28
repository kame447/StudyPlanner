const baseUrl = process.env.TRACE_BASE_URL?.trim().replace(/\/$/, '');
const idToken = process.env.TRACE_ID_TOKEN?.trim();
const contractVersion = '2026-07-28-v2';
const expectedWorkerRevision = 'weekly-planning-trace-20260729-002';
const contractHeader = 'X-StudyPlanner-Trace-Contract-Version';
const correlationHeader = 'X-StudyPlanner-Trace-Correlation-Id';
const workerRevisionHeader = 'X-StudyPlanner-Trace-Worker-Revision';

if (!baseUrl || !idToken) {
  throw new Error('TRACE_BASE_URL and TRACE_ID_TOKEN are required');
}

const correlationId = `deployed-contract-${Date.now()}`;
const response = await fetch(`${baseUrl}/weekly-planning-trace/health`, {
  headers: {
    Authorization: `Bearer ${idToken}`,
    [contractHeader]: contractVersion,
    [correlationHeader]: correlationId,
  },
});

const body = await response.json().catch(() => ({}));
const responseContract = response.headers.get(contractHeader) ?? body.contractVersion;
const responseCorrelation = response.headers.get(correlationHeader) ?? body.correlationId;
const workerRevision = response.headers.get(workerRevisionHeader) ?? body.workerRevision;

if (!response.ok || body.ok === false) {
  throw new Error(`deployed trace health failed: ${response.status} ${JSON.stringify(body)}`);
}
if (responseContract !== contractVersion) {
  throw new Error(`trace contract mismatch: expected ${contractVersion}, received ${responseContract}`);
}
if (responseCorrelation !== correlationId) {
  throw new Error(`trace correlation mismatch: expected ${correlationId}, received ${responseCorrelation}`);
}
if (workerRevision !== expectedWorkerRevision) {
  throw new Error(
    `trace worker revision mismatch: expected ${expectedWorkerRevision}, received ${workerRevision}`,
  );
}
if (body.storageLayoutVersion !== 2) {
  throw new Error(`trace storage layout mismatch: ${body.storageLayoutVersion}`);
}

console.log(JSON.stringify({
  ok: true,
  contractVersion: responseContract,
  workerRevision,
  correlationId: responseCorrelation,
  storageLayoutVersion: body.storageLayoutVersion,
}, null, 2));
