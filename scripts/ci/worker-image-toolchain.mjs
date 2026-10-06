import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Local, synthetic native-ABI smoke. No production config, remote bindings,
// credentials, external fetches, account changes or image-service charges.
const require = createRequire(import.meta.url);
const miniflareRequire = createRequire(require.resolve('miniflare'));
const sharp = (await import(pathToFileURL(miniflareRequire.resolve('sharp')).href)).default;
assert.equal(sharp.versions.sharp, '0.35.5');
assert.equal(sharp.versions.rsvg, '2.63.2');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="blue"/></svg>');
const png = await sharp(svg).png().toBuffer();
for (const format of ['jpeg', 'webp']) {
  const bytes = await sharp(png).rotate(180).resize(8, 6).toFormat(format).toBuffer();
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 8); assert.equal(metadata.height, 6); assert.equal(metadata.format, format);
}
await assert.rejects(() => sharp(Buffer.from('not an image')).metadata());
const mf = new Miniflare({ ...convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, modules: true,
  compatibilityDate: '2026-04-10',
  script: 'export default { fetch() { return new Response("local image toolchain smoke"); } }',
  images: { binding: 'IMAGES' },
}), telemetry: { enabled: false } });
try {
  const images = await mf.getImagesBinding('IMAGES');
  const info = await images.info(new Blob([png]).stream());
  assert.equal(info.width, 16); assert.equal(info.height, 12);
  const output = await images.input(new Blob([png]).stream()).transform({ width: 8, height: 6 }).output({ format: 'image/webp' });
  const response = await output.response();
  assert.equal(response.headers.get('content-type'), 'image/webp');
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(metadata.width, 8); assert.equal(metadata.height, 6);
  await assert.rejects(() => images.info(new Blob(['not an image']).stream()));
  console.log(JSON.stringify({ sharp: sharp.versions.sharp, librsvg: sharp.versions.rsvg,
    nativeDecode: 'pass', nativeTransforms: 'pass', miniflareImages: 'pass', malformedInput: 'rejected' }));
} finally { await mf.dispose(); }
