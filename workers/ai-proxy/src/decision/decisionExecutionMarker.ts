export type JevExecutionMode = 'shadow' | 'canary';

const JEV_EXECUTION_MODE_HEADER = 'X-StudyPlanner-Internal-Jev-Mode';

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

export function jevExecutionMode(
  response: Pick<Response, 'headers'>,
): JevExecutionMode | null {
  const value = response.headers.get(JEV_EXECUTION_MODE_HEADER);
  return value === 'shadow' || value === 'canary' ? value : null;
}

export function stripJevExecutionMarker(response: Response): Response {
  if (!response.headers.has(JEV_EXECUTION_MODE_HEADER)) return response;
  const headers = new Headers(response.headers);
  headers.delete(JEV_EXECUTION_MODE_HEADER);
  return responseWithHeaders(response, headers);
}
