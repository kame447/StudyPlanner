export function subscribeAdminStatus(_userId, listener) {
  listener(true);
  window.__inquiryAdminAccess = listener;
  return () => { delete window.__inquiryAdminAccess; };
}
