import { describe, expect, it } from 'vitest';
import {
  MATERIAL_CATALOG_CURATED_ENTRIES,
  MATERIAL_CATALOG_SEED_ENTRIES,
} from '../data/material-catalog';
import { searchBuiltInMaterialCatalog } from './builtInMaterialCatalog';

describe('built-in material catalog', () => {
  it('ships at least one thousand initial search entries with a substantial curated core', () => {
    expect(MATERIAL_CATALOG_SEED_ENTRIES.length).toBeGreaterThanOrEqual(1000);
    expect(MATERIAL_CATALOG_CURATED_ENTRIES.length).toBeGreaterThanOrEqual(300);
    expect(new Set(MATERIAL_CATALOG_SEED_ENTRIES.map((entry) => entry.id)).size)
      .toBe(MATERIAL_CATALOG_SEED_ENTRIES.length);
    expect(new Set(MATERIAL_CATALOG_SEED_ENTRIES.map((entry) => entry.subject)).size)
      .toBeGreaterThanOrEqual(12);
  });

  it('resolves common aliases to a canonical seeded material', () => {
    expect(searchBuiltInMaterialCatalog('金フレ')[0]).toMatchObject({
      catalogEntryId: 'seed:eng-kintore',
      title: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
      subjectHint: '英語',
      materialKind: 'TOEIC',
      resolutionRequired: false,
    });

    expect(searchBuiltInMaterialCatalog('ターゲット 1900')[0]).toMatchObject({
      catalogEntryId: 'seed:eng-target1900',
      title: '英単語ターゲット1900',
    });
  });

  it('includes popularity-audited Amazon bestseller material titles in the curated core', () => {
    expect(searchBuiltInMaterialCatalog('Distinction 2000')[0]).toMatchObject({
      catalogEntryId: 'seed:amazon-eng-distinction-2000',
      title: 'Distinction 2000',
      resolutionRequired: false,
    });
    expect(searchBuiltInMaterialCatalog('キタミ式 ITパスポート')[0]).toMatchObject({
      catalogEntryId: 'seed:amazon-itpass-kitami',
      subjectHint: '情報',
    });
  });

  it('returns multiple concrete candidates when a series alias maps to several books', () => {
    const chartResults = searchBuiltInMaterialCatalog('青チャート');
    expect(chartResults.map((candidate) => candidate.title)).toEqual([
      '青チャート 数学I+A',
      '青チャート 数学II+B+C',
      '青チャート 数学III+C',
    ]);

    const polarisResults = searchBuiltInMaterialCatalog('現代文ポラリス');
    expect(polarisResults.map((candidate) => candidate.title)).toEqual([
      '柳生好之の現代文ポラリス 1',
      '柳生好之の現代文ポラリス 2',
      '柳生好之の現代文ポラリス 3',
    ]);
  });

  it('uses broad coverage entries as discovery candidates that require bibliography resolution', () => {
    expect(searchBuiltInMaterialCatalog('東京大学 赤本')[0]).toMatchObject({
      title: '東京大学 赤本',
      subjectHint: '大学受験',
      resolutionRequired: true,
    });
    expect(searchBuiltInMaterialCatalog('英検準1級 過去6回全問題集')[0]).toMatchObject({
      subjectHint: '英語',
      resolutionRequired: true,
    });
  });

  it('keeps useful long legacy candidates without promoting short generic NLP terms', () => {
    expect(searchBuiltInMaterialCatalog('経済セミナー')[0]).toMatchObject({
      catalogEntryId: 'builtin-legacy:経済セミナー',
      title: '経済セミナー',
      resolutionRequired: true,
    });
    expect(searchBuiltInMaterialCatalog('関正生')).toEqual([]);
    expect(searchBuiltInMaterialCatalog('微分')).toEqual([]);
  });

  it('does not short-circuit external search for partial or ambiguous terms', () => {
    expect(searchBuiltInMaterialCatalog('チャート')).toEqual([]);
    expect(searchBuiltInMaterialCatalog('微')).toEqual([]);
  });

  it('leaves ISBN and unknown titles to the shared catalog/provider path', () => {
    expect(searchBuiltInMaterialCatalog('9784023315686')).toEqual([]);
    expect(searchBuiltInMaterialCatalog('存在しない教材XYZ987')).toEqual([]);
  });
});
