import { describe, expect, it } from 'vitest';
import { classifyMaterialMetadataQuery } from '../../../shared/materialMetadataContract';
import {
  buildNdlOpenSearchUrl,
  parseNdlOpenSearchXml,
} from './materialMetadataApi';

describe('material metadata NDL adapter', () => {
  it('builds licensed national-bibliography ISBN and title queries', () => {
    const isbn = classifyMaterialMetadataQuery('978-4-02-331568-6');
    const title = classifyMaterialMetadataQuery(' 金のフレーズ ');

    expect(isbn).toEqual({ kind: 'isbn', value: '9784023315686' });
    expect(title).toEqual({ kind: 'title', value: '金のフレーズ' });

    const isbnUrl = new URL(buildNdlOpenSearchUrl(isbn!));
    const titleUrl = new URL(buildNdlOpenSearchUrl(title!));
    expect(isbnUrl.searchParams.get('dpid')).toBe('iss-ndl-opac-national');
    expect(isbnUrl.searchParams.get('isbn')).toBe('9784023315686');
    expect(isbnUrl.searchParams.get('cnt')).toBe('8');
    expect(titleUrl.searchParams.get('dpid')).toBe('iss-ndl-opac-national');
    expect(titleUrl.searchParams.get('title')).toBe('金のフレーズ');
  });

  it('normalizes book metadata and ignores records without ISBN identity', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <channel>
          <item>
            <title><![CDATA[TOEIC L&amp;R TEST 出る単特急 金のフレーズ]]></title>
            <dc:creator>TEX加藤</dc:creator>
            <dc:publisher>朝日新聞出版</dc:publisher>
            <dc:date>2023-02</dc:date>
            <dc:identifier xsi:type="dcndl:ISBN">978-4-02-331568-6</dc:identifier>
          </item>
          <item>
            <title>ISBNのない資料</title>
            <dc:creator>誰か</dc:creator>
          </item>
        </channel>
      </rss>`;

    expect(parseNdlOpenSearchXml(xml)).toEqual([
      {
        catalogEntryId: 'isbn13:9784023315686',
        title: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
        authors: ['TEX加藤'],
        publisher: '朝日新聞出版',
        publishedYear: 2023,
        isbn13: '9784023315686',
      },
    ]);
  });
});
