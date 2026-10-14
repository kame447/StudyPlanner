import { describe, expect, it } from 'vitest';
import { isAnnouncementUnread, validateAnnouncementInput, compareAnnouncementTime, mergeAnnouncementReadState, type Announcement } from './announcement';
const item: Announcement = { id: 'a', category: '不具合', title: 'タイトル', body: '本文', revision: 1, publishedAt: { seconds: 100, nanoseconds: 2 } };
describe('announcement contract', () => {
  it('normalizes content and rejects invalid lengths/categories', () => {
    expect(validateAnnouncementInput({ ...item, title: ' タイトル ', body: ' 本文\n' })).toEqual({ category: '不具合', title: 'タイトル', body: '本文' });
    for (const patch of [{ title: ' ' }, { title: 'あ'.repeat(121) }, { body: '\n\t' }, { body: 'a'.repeat(10001) }, { category: 'bad' }]) {
      expect(() => validateAnnouncementInput({ ...item, ...patch } as Announcement)).toThrow();
    }
  });
  it('merges receipt snapshots monotonically regardless of completion order', () => {
    const newer = { through: item.publishedAt, items: { a: item.publishedAt } };
    const older = { through: { seconds: 100, nanoseconds: 1 }, items: { a: { seconds: 99, nanoseconds: 0 } } };
    expect(mergeAnnouncementReadState(newer, older)).toEqual(newer);
    expect(mergeAnnouncementReadState(older, newer)).toEqual(newer);
  });
  it('uses nanosecond precision and makes republished content unread', () => {
    expect(compareAnnouncementTime(item.publishedAt, { seconds: 100, nanoseconds: 1 })).toBeGreaterThan(0);
    expect(isAnnouncementUnread(item, { through: null, items: {} })).toBe(true);
    expect(isAnnouncementUnread(item, { through: item.publishedAt, items: {} })).toBe(false);
    expect(isAnnouncementUnread(item, { through: null, items: { a: item.publishedAt } })).toBe(false);
    expect(isAnnouncementUnread(item, { through: { seconds: 99, nanoseconds: 999999999 }, items: { a: { seconds: 100, nanoseconds: 1 } } })).toBe(true);
  });
});
