export { prepareInquiryAttachments } from '../../../src/services/inquiryAttachmentService';
const params = new URLSearchParams(window.location.search);
window.__inquiryUploads = [];
window.__inquiryPhotoReads = [];
export async function inquiryAttachmentsAvailable() { return params.has('photos'); }
export async function uploadInquiryAttachments(userId, receipt, photos) {
  window.__inquiryUploads.push({ userId, receipt, photos: photos.map((photo) => photo.descriptor) });
  if (params.get('photos') === 'retry' && !sessionStorage.getItem('fixture.photo.failed')) {
    sessionStorage.setItem('fixture.photo.failed', 'true'); throw new Error('Fixture: image upload disconnected');
  }
}
export async function readInquiryAttachment(receipt, slot) {
  window.__inquiryPhotoReads.push({ receipt, slot });
  return (await syntheticPhotoFixture()).blob;
}

let syntheticPhoto;
// Non-personal screenshot-sized PNG. Keep native decoding, aspect ratio and
// containment observable without putting a real user's attachment in CI.
export function syntheticPhotoFixture() {
  syntheticPhoto ??= (async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const context = canvas.getContext('2d');
    context.fillStyle = '#edf5f3'; context.fillRect(0, 0, 1080, 1920);
    context.fillStyle = '#145a54'; context.fillRect(0, 0, 1080, 240);
    context.fillStyle = '#ffffff'; context.font = 'bold 66px sans-serif';
    context.fillText('SYNTHETIC INQUIRY', 56, 108);
    context.font = '42px sans-serif'; context.fillText('1080 x 1920 PNG', 56, 186);
    for (let index = 0; index < 4; index += 1) {
      const top = 306 + index * 326;
      context.fillStyle = '#ffffff'; context.fillRect(56, top, 968, 270);
      context.fillStyle = index % 2 ? '#e49b42' : '#258a7b';
      context.fillRect(84, top + 42, 82, 82);
      context.fillStyle = '#173e39'; context.font = 'bold 46px sans-serif';
      context.fillText(`Example panel ${index + 1}`, 204, top + 94);
      context.font = '36px sans-serif'; context.fillText('No personal information', 84, top + 196);
    }
    context.fillStyle = '#145a54'; context.font = 'bold 44px sans-serif';
    context.fillText('BOTTOM EDGE / aspect ratio check', 56, 1838);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Fixture PNG could not be generated');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { blob, descriptor: { sha256, contentType: 'image/png', byteLength: blob.size, width: 1080, height: 1920 } };
  })();
  return syntheticPhoto;
}
