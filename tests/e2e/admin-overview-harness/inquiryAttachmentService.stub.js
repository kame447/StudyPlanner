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
  return new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0))], { type: 'image/png' });
}
