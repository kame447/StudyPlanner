import assert from 'node:assert/strict';
import { signOut } from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

// Synthetic local demo-emulator data only. Invoked by the existing Rules entrypoint.
export async function verifyAnnouncementRules({ owner, intruder, createContext, contexts, expectPermissionDenied, projectId, firestoreHost }) {
  assert.ok(projectId.startsWith('demo-'));
  assert.match(firestoreHost, /^(127\.0\.0\.1|localhost):\d+$/);
  const admin = await createContext('announcements-admin'); contexts.push(admin);
  const baseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
  const response = await fetch(`${baseUrl}/admins/${admin.user.uid}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { enabled: { booleanValue: true } } }) });
  assert.equal(response.ok, true);
  const id = `announcement-${Date.now()}`;
  const draftRef = (context) => doc(context.db, 'announcement_drafts', id);
  const publicRef = (context) => doc(context.db, 'announcements', id);
  const draft = { schemaVersion: 1, category: '不具合', title: '復旧しました', body: '本文\n続き', revision: 1, publishedRevision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await expectPermissionDenied('ordinary user draft creation', () => setDoc(draftRef(owner), draft));
  for (const [label, patch] of [['blank title', { title: '  ' }], ['blank body', { body: '\n\t' }], ['overlong title', { title: 'a'.repeat(121) }], ['overlong body', { body: 'a'.repeat(10001) }], ['extra field', { email: 'private' }], ['bad category', { category: 'secret' }], ['forged timestamp', { updatedAt: Timestamp.fromMillis(1) }]]) {
    await expectPermissionDenied(`draft rejects ${label}`, () => setDoc(draftRef(admin), { ...draft, ...patch }));
  }
  await setDoc(draftRef(admin), draft);
  await expectPermissionDenied('ordinary draft get', () => getDocFromServer(draftRef(owner)));
  await expectPermissionDenied('ordinary draft list', () => getDocsFromServer(query(collection(owner.db, 'announcement_drafts'), limit(26))));
  await expectPermissionDenied('unbounded admin draft list', () => getDocsFromServer(collection(admin.db, 'announcement_drafts')));
  assert.equal((await getDocsFromServer(query(collection(admin.db, 'announcement_drafts'), orderBy('updatedAt', 'desc'), limit(26)))).size, 1);
  const publication = { schemaVersion: 1, category: draft.category, title: draft.title, body: draft.body, revision: 1, publishedAt: serverTimestamp() };
  await expectPermissionDenied('ordinary publication', () => setDoc(publicRef(owner), publication));
  await expectPermissionDenied('publication must atomically match private revision', () => setDoc(publicRef(admin), publication));
  const publish = (revision, title) => { const batch = writeBatch(admin.db); batch.set(publicRef(admin), { ...publication, title, revision }); batch.update(draftRef(admin), { publishedRevision: revision }); return batch.commit(); };
  await publish(1, draft.title);
  const first = (await getDocFromServer(publicRef(owner))).data();
  assert.equal(first.title, draft.title);
  await expectPermissionDenied('unbounded public list', () => getDocsFromServer(collection(owner.db, 'announcements')));
  await expectPermissionDenied('overlarge public list', () => getDocsFromServer(query(collection(owner.db, 'announcements'), limit(27))));
  assert.equal((await getDocsFromServer(query(collection(owner.db, 'announcements'), orderBy('publishedAt', 'desc'), limit(26)))).size, 1);
  await updateDoc(draftRef(admin), { title: '未公開の変更', revision: 2, updatedAt: serverTimestamp() });
  assert.equal((await getDocFromServer(publicRef(owner))).data().title, draft.title, 'Private edits must not leak before explicit publish');
  await expectPermissionDenied('stale revision save', () => updateDoc(draftRef(admin), { title: 'stale', revision: 2, updatedAt: serverTimestamp() }));
  await expectPermissionDenied('mismatched public content', () => publish(2, 'wrong content'));
  const receipt = doc(owner.db, 'announcement_reads', owner.user.uid, 'items', id);
  await setDoc(receipt, { publishedAt: first.publishedAt });
  const summary = doc(owner.db, 'announcement_reads', owner.user.uid);
  await setDoc(summary, { through: first.publishedAt });
  await expectPermissionDenied('foreign summary get', () => getDocFromServer(doc(intruder.db, 'announcement_reads', owner.user.uid)));
  await expectPermissionDenied('foreign summary write', () => setDoc(doc(intruder.db, 'announcement_reads', owner.user.uid), { through: first.publishedAt }));
  await expectPermissionDenied('foreign receipt write', () => setDoc(doc(intruder.db, 'announcement_reads', owner.user.uid, 'items', id), { publishedAt: first.publishedAt }));
  await expectPermissionDenied('future bulk watermark', () => setDoc(summary, { through: Timestamp.fromMillis(Date.now() + 86400000) }));
  await expectPermissionDenied('backwards bulk watermark', () => setDoc(summary, { through: Timestamp.fromMillis(1) }));
  await expectPermissionDenied('future individual receipt', () => setDoc(receipt, { publishedAt: Timestamp.fromMillis(Date.now() + 86400000) }));
  await expectPermissionDenied('unbounded receipt list', () => getDocsFromServer(collection(owner.db, 'announcement_reads', owner.user.uid, 'items')));
  await publish(2, '未公開の変更');
  const second = (await getDocFromServer(publicRef(owner))).data();
  assert.equal(second.title, '未公開の変更'); assert.ok(second.publishedAt.toMillis() > first.publishedAt.toMillis());
  assert.ok((await getDocFromServer(receipt)).data().publishedAt.toMillis() < second.publishedAt.toMillis());
  await expectPermissionDenied('same-revision publication cannot refresh unread timestamp', () => publish(2, '未公開の変更'));
  await signOut(admin.auth);
  await expectPermissionDenied('unsigned announcement get', () => getDocFromServer(publicRef(admin)));
  await expectPermissionDenied('unsigned publication', () => publish(3, 'unsigned'));
  console.log('Firestore announcements: private drafts, atomic publication, bounded reads, owner-only read state and revisions passed.');
}
