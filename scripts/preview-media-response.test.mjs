import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { respondWithPreviewVideo } from './preview-media-response.mjs';

class Response extends Writable {
  status = null;
  headers = {};
  chunks = [];
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  get body() { return Buffer.concat(this.chunks).toString(); }
}

let directory;
let video;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'laplans-preview-media-'));
  video = path.join(directory, 'clip.mp4');
  fs.writeFileSync(video, '0123456789');
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

async function request({ method = 'GET', range } = {}) {
  const response = new Response();
  const done = new Promise((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
  respondWithPreviewVideo(video, { method, headers: range === undefined ? {} : { range } }, response);
  await done;
  return response;
}

it('serves complete MP4 with media MIME, length, range support and unchanged asset cache', async () => {
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.headers).toEqual({ 'Content-Type': 'video/mp4', 'Content-Length': 10,
    'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' });
  expect(result.body).toBe('0123456789');
});

it.each([
  ['bytes=0-1', '01', 'bytes 0-1/10'],
  ['bytes=4-', '456789', 'bytes 4-9/10'],
  ['bytes=-3', '789', 'bytes 7-9/10'],
  ['bytes=-30', '0123456789', 'bytes 0-9/10'],
  ['bytes=8-100', '89', 'bytes 8-9/10'],
  ['bytes=2-2', '2', 'bytes 2-2/10'],
])('serves a bounded single range %s', async (range, body, contentRange) => {
  const result = await request({ range });
  expect(result.status).toBe(206);
  expect(result.body).toBe(body);
  expect(result.headers['Content-Length']).toBe(body.length);
  expect(result.headers['Content-Range']).toBe(contentRange);
});

it.each(['bytes=10-', 'bytes=7-5', 'bytes=-0', 'bytes=9999999999999999999999999-'])('returns empty 416 for unsatisfiable %s', async range => {
  const stream = vi.spyOn(fs, 'createReadStream');
  const result = await request({ range });
  expect(result.status).toBe(416);
  expect(result.headers['Content-Range']).toBe('bytes */10');
  expect(result.headers['Content-Length']).toBe(0);
  expect(result.body).toBe('');
  expect(stream).not.toHaveBeenCalled();
});

it.each(['bytes=bad', 'bytes=1-2,4-5', 'items=0-1', 'bytes=-', 'bytes=1.5-2'])('ignores malformed or unsupported range %s', async range => {
  const result = await request({ range });
  expect(result.status).toBe(200);
  expect(result.headers['Content-Range']).toBeUndefined();
  expect(result.body).toBe('0123456789');
});

it.each([undefined, 'bytes=0-1', 'bytes=999-'])('HEAD ignores ranges and never opens the file body: %s', async range => {
  const stream = vi.spyOn(fs, 'createReadStream');
  const result = await request({ method: 'HEAD', range });
  expect(result.status).toBe(200);
  expect(result.headers['Content-Length']).toBe(10);
  expect(result.headers['Content-Range']).toBeUndefined();
  expect(result.body).toBe('');
  expect(stream).not.toHaveBeenCalled();
});

it('handles an empty asset without opening a stream', async () => {
  fs.writeFileSync(video, '');
  const stream = vi.spyOn(fs, 'createReadStream');
  const whole = await request();
  expect(whole.status).toBe(200);
  expect(whole.headers['Content-Length']).toBe(0);
  const ranged = await request({ range: 'bytes=0-' });
  expect(ranged.status).toBe(416);
  expect(ranged.headers['Content-Range']).toBe('bytes */0');
  expect(stream).not.toHaveBeenCalled();
});

it('destroys an unfinished file stream when the response disconnects', async () => {
  const stream = new PassThrough();
  vi.spyOn(fs, 'createReadStream').mockReturnValue(stream);
  const response = new Response();
  const closed = new Promise(resolve => stream.once('close', resolve));
  respondWithPreviewVideo(video, { method: 'GET', headers: {} }, response);
  response.destroy();
  await closed;
  expect(stream.destroyed).toBe(true);
  expect(response.listenerCount('close')).toBe(0);
});

it('terminates the response on a file stream error without writing another status', async () => {
  const stream = new PassThrough();
  vi.spyOn(fs, 'createReadStream').mockReturnValue(stream);
  const response = new Response();
  const failed = new Promise(resolve => response.once('error', resolve));
  respondWithPreviewVideo(video, { method: 'GET', headers: {} }, response);
  const error = new Error('read failure fixture');
  stream.destroy(error);
  expect(await failed).toBe(error);
  expect(response.destroyed).toBe(true);
  expect(response.status).toBe(200);
});
