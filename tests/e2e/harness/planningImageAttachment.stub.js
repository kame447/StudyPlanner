// Deterministic external OCR boundary for the real-application browser harness.
// No uploaded image or user data leaves the test browser.
const reads = [];
window.__realWeeklyImageRead = {
  pending: () => reads.length,
  release(fail = false) {
    const pending = reads.shift();
    if (!pending) return false;
    if (fail) pending.reject(new Error('synthetic OCR failure'));
    else pending.resolve({ text: 'synthetic image evidence' });
    return true;
  },
};
export async function extractPlanningImageAttachment() {
  window.__realWeeklyEvents ??= [];
  window.__realWeeklyEvents.push({ type: 'real-image-read', payload: null });
  return new Promise((resolve, reject) => reads.push({ resolve, reject }));
}
