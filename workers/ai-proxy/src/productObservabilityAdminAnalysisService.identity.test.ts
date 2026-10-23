import { describe, expect, it, vi } from 'vitest';
import { ProductObservabilityAdminAnalysisService } from './productObservabilityAdminAnalysisService';

const victim = { id: 'victim-uid', email: 'old@example.test', username: 'Student', registeredAt: '2026-08-20T00:00:00.000Z' };
const impostor = { id: 'impostor-uid', email: 'victim@example.test', username: 'Student', registeredAt: victim.registeredAt };

function fixture(profiles = [impostor, victim]) {
  const firestore = {
    getDocument: vi.fn(async (_collection: string, uid: string) => profiles.find(profile => profile.id === uid) ?? null),
    queryDocumentsAfter: vi.fn(async (params: { filters: Array<{ field: string; value: string }>; limit: number }) =>
      profiles.filter(profile => params.filters.every(filter => profile[filter.field as keyof typeof profile] === filter.value)).slice(0, params.limit)),
  };
  const auth = {
    lookupByEmail: vi.fn(async (_email: string) => [{ firebaseUid: victim.id, email: 'victim@example.test' }]),
    lookupByUids: vi.fn(async (uids: readonly string[]) => uids.map(firebaseUid => ({
      firebaseUid, email: firebaseUid === victim.id ? 'victim@example.test' : 'impostor@example.test',
    }))),
  };
  const identities = {
    lookupActorSubjectId: vi.fn(),
    lookupActorSubjectIds: vi.fn(async (uids: readonly string[]) => uids.map(uid => `actor-${uid}`)),
  };
  const service = new ProductObservabilityAdminAnalysisService(
    {} as never, firestore as never, {} as never, identities, () => new Date(), auth,
  );
  return { service, firestore, auth, identities };
}

describe('admin identity uses verified Auth email', () => {
  it('finds the verified owner despite an impostor profile claiming their email', async () => {
    const { service, firestore, auth, identities } = fixture();
    const matches = await service.resolveUserIdentity('  VICTIM@example.test  ');
    expect(matches).toEqual([{
      firebaseUid: victim.id, email: 'victim@example.test', username: victim.username,
      registeredAt: victim.registeredAt, actorSubjectId: `actor-${victim.id}`,
    }]);
    expect(auth.lookupByEmail).toHaveBeenCalledWith('victim@example.test');
    expect(firestore.queryDocumentsAfter).not.toHaveBeenCalled();
    expect(identities.lookupActorSubjectIds).toHaveBeenCalledWith([victim.id]);
  });

  it('does not match a claimed profile email when no verified Auth account owns it', async () => {
    const { service, auth, firestore } = fixture();
    auth.lookupByEmail.mockResolvedValue([]);
    expect(await service.resolveUserIdentity('victim@example.test')).toEqual([]);
    expect(firestore.queryDocumentsAfter).not.toHaveBeenCalled();
  });

  it('finds a verified Auth account even without a profile', async () => {
    const { service } = fixture([]);
    expect(await service.resolveUserIdentity('victim@example.test')).toEqual([{
      firebaseUid: victim.id, email: 'victim@example.test', username: 'victim@example.test',
      registeredAt: null, actorSubjectId: `actor-${victim.id}`,
    }]);
  });

  it.each(['impostor-uid', 'Student'])('preserves UID/username search while using Auth email: %s', async search => {
    const { service, auth, identities } = fixture();
    const matches = await service.resolveUserIdentity(search);
    expect(matches.map(match => match.firebaseUid)).toEqual(search === 'Student' ? [impostor.id, victim.id] : [impostor.id]);
    expect(matches[0]).toMatchObject({ email: 'impostor@example.test', actorSubjectId: `actor-${impostor.id}` });
    expect(auth.lookupByUids).toHaveBeenCalledWith(matches.map(match => match.firebaseUid));
    expect(identities.lookupActorSubjectIds).toHaveBeenCalledWith(matches.map(match => match.firebaseUid));
  });

  it('drops self-reported email and never uses it as a missing-username fallback', async () => {
    const { service, auth } = fixture([{ ...impostor, username: '' }]);
    auth.lookupByUids.mockResolvedValue([]);
    expect(await service.resolveUserIdentity(impostor.id)).toEqual([{
      firebaseUid: impostor.id, email: '', username: impostor.id,
      registeredAt: impostor.registeredAt, actorSubjectId: `actor-${impostor.id}`,
    }]);
  });

  it.each(['victim@example.test', 'Student'])('surfaces Auth lookup errors instead of trusting profiles: %s', async search => {
    const { service, auth } = fixture();
    auth.lookupByEmail.mockRejectedValue(new Error('auth unavailable'));
    auth.lookupByUids.mockRejectedValue(new Error('auth unavailable'));
    await expect(service.resolveUserIdentity(search)).rejects.toThrow('auth unavailable');
  });

  it('keeps the five-match bound and UID-first ordering for a username colliding with a UID', async () => {
    const profiles = Array.from({ length: 7 }, (_, index) => ({ ...victim, id: `uid-${index}`, username: 'uid-6' }));
    const { service, auth, identities } = fixture(profiles);
    const matches = await service.resolveUserIdentity('uid-6');
    expect(matches.map(match => match.firebaseUid)).toEqual(['uid-6', 'uid-0', 'uid-1', 'uid-2', 'uid-3']);
    expect(auth.lookupByUids).toHaveBeenCalledWith(matches.map(match => match.firebaseUid));
    expect(identities.lookupActorSubjectIds).toHaveBeenCalledWith(matches.map(match => match.firebaseUid));
  });

  it.each(['us', 'x'.repeat(161)])('validates input before Auth or storage: %s', async search => {
    const { service, auth, firestore, identities } = fixture();
    await expect(service.resolveUserIdentity(search)).rejects.toThrow('observability_identity_search_invalid');
    expect(auth.lookupByEmail).not.toHaveBeenCalled();
    expect(auth.lookupByUids).not.toHaveBeenCalled();
    expect(firestore.getDocument).not.toHaveBeenCalled();
    expect(firestore.queryDocumentsAfter).not.toHaveBeenCalled();
    expect(identities.lookupActorSubjectIds).not.toHaveBeenCalled();
  });
});
