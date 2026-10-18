export type JevExecutionMode = 'shadow' | 'canary';
export type LunaBaselineFailure = 'network' | 'cancelled' | 'timeout';

const JEV_EXECUTION_MODE_HEADER = 'X-StudyPlanner-Internal-Jev-Mode';
const LUNA_BASELINE_FAILURE_HEADER = 'X-StudyPlanner-Internal-Luna-Baseline-Failure';

function responseWithHeaders(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function markJevExecution(response: Response, mode: JevExecutionMode): Response {
  const headers = new Headers(response.headers);
  headers.set(JEV_EXECUTION_MODE_HEADER, mode);
  return responseWithHeaders(response, headers);
}

export function markLunaBaselineFailure(
  response: Response,
  mode: JevExecutionMode,
  failure: LunaBaselineFailure,
): Response {
  const headers = new Headers(response.headers);
  headers.set(JEV_EXECUTION_MODE_HEADER, mode);
  headers.set(LUNA_BASELINE_FAILURE_HEADER, failure);
  return responseWithHeaders(response, headers);
}

export function jevExecutionMode(
  response: Pick<Response, 'headers'>,
): JevExecutionMode | null {
  const value = response.headers.get(JEV_EXECUTION_MODE_HEADER);
  return value === 'shadow' || value === 'canary' ? value : null;
}

export function lunaBaselineFailure(
  response: Pick<Response, 'headers'>,
): LunaBaselineFailure | null {
  const value = response.headers.get(LUNA_BASELINE_FAILURE_HEADER);
  return value === 'network' || value === 'cancelled' || value === 'timeout' ? value : null;
}

export function stripJevExecutionMarker(response: Response): Response {
  if (!response.headers.has(JEV_EXECUTION_MODE_HEADER)
    && !response.headers.has(LUNA_BASELINE_FAILURE_HEADER)) return response;
  const headers = new Headers(response.headers);
  headers.delete(JEV_EXECUTION_MODE_HEADER);
  headers.delete(LUNA_BASELINE_FAILURE_HEADER);
  return responseWithHeaders(response, headers);
}
