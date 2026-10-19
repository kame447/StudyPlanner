import fs from 'node:fs';

function videoRange(header, size) {
  if (typeof header !== 'string') return null;
  // Ignore malformed or unsupported multi-range requests rather than attempting
  // multipart responses. HTTP ranges apply to GET, not HEAD.
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (size === 0) return { unsatisfiable: true };
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : { unsatisfiable: true };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || end < start) return { unsatisfiable: true };
  return { start, end };
}

/** Byte-serving only: the caller retains existing path and access checks. */
export function respondWithPreviewVideo(filePath, request, response) {
  const size = fs.statSync(filePath).size;
  const range = request.method === 'GET' ? videoRange(request.headers.range, size) : null;
  const headers = {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  };
  if (range?.unsatisfiable) {
    response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
    response.end();
    return;
  }
  const length = range ? range.end - range.start + 1 : size;
  response.writeHead(range ? 206 : 200, {
    ...headers,
    'Content-Length': length,
    ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
  });
  if (request.method === 'HEAD' || length === 0) {
    response.end();
    return;
  }
  const stream = fs.createReadStream(filePath, range ?? undefined);
  const stop = () => stream.destroy();
  response.once('close', stop);
  stream.once('close', () => response.removeListener('close', stop));
  stream.once('error', error => response.destroy(error));
  stream.pipe(response);
}
