import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
  WEEKLY_PLANNING_TRACE_WORKER_REVISION,
  WEEKLY_PLANNING_TRACE_STORAGE_LAYOUT_VERSION,
} from '../shared/weeklyPlanningTraceContract.ts';

function healthUrl(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch {
    throw new Error('TRACE_BASE_URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('TRACE_BASE_URL must be an HTTPS base URL without credentials, query or fragment');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/weekly-planning-trace/health`;
  return url.href;
}

function checkedField(response, body, header, field, expected, label) {
  const fromHeader = response.headers.get(header);
  const fromBody = body[field];
  if ((fromHeader ?? fromBody) !== expected
    || (fromBody !== undefined && fromBody !== expected)) {
    // Never echo arbitrary server values into CI logs; they may contain private data.
    throw new Error(`trace ${label} mismatch`);
  }
  return expected;
}

export async function verifyDeployedTraceContract({
  baseUrl,
  idToken,
  correlationId = `deployed-contract-${randomUUID()}`,
  fetchImpl = fetch,
}) {
  if (!baseUrl?.trim() || !idToken?.trim()) {
    throw new Error('TRACE_BASE_URL and TRACE_ID_TOKEN are required');
  }
  const url = healthUrl(baseUrl.trim());
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(correlationId)) {
    throw new Error('trace correlation ID is invalid');
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${idToken.trim()}`,
        [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
        [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: correlationId,
      },
    });
  } catch {
    throw new Error('deployed trace health request failed');
  }
  if (!response.ok) {
    throw new Error(`deployed trace health failed: HTTP ${response.status}`);
  }
  let body;
  try { body = await response.json(); } catch {
    throw new Error('deployed trace health returned invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.ok !== true) {
    throw new Error('deployed trace health returned an invalid success response');
  }
  const contractVersion = checkedField(response, body,
    WEEKLY_PLANNING_TRACE_HEADERS.contractVersion, 'contractVersion',
    WEEKLY_PLANNING_TRACE_CONTRACT_VERSION, 'contract');
  const workerRevision = checkedField(response, body,
    WEEKLY_PLANNING_TRACE_HEADERS.workerRevision, 'workerRevision',
    WEEKLY_PLANNING_TRACE_WORKER_REVISION, 'worker revision');
  const verifiedCorrelation = checkedField(response, body,
    WEEKLY_PLANNING_TRACE_HEADERS.correlationId, 'correlationId', correlationId, 'correlation');
  if (body.storageLayoutVersion !== WEEKLY_PLANNING_TRACE_STORAGE_LAYOUT_VERSION) {
    throw new Error('trace storage layout mismatch');
  }
  return {
    ok: true, contractVersion, workerRevision,
    correlationId: verifiedCorrelation, storageLayoutVersion: body.storageLayoutVersion,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyDeployedTraceContract({
      baseUrl: process.env.TRACE_BASE_URL,
      idToken: process.env.TRACE_ID_TOKEN,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'deployed trace verification failed');
    process.exitCode = 1;
  }
}
