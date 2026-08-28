import { describe, expect, it } from 'vitest';
import { buildMaterialMetadataEndpoint } from './materialMetadataService';

describe('material metadata service', () => {
  it('resolves the material endpoint from supported proxy URLs', () => {
    expect(buildMaterialMetadataEndpoint('https://example.com/chat/completions'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataEndpoint('https://example.com/planning-attachment'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataEndpoint('https://example.com/'))
      .toBe('https://example.com/material-metadata/search');
  });
});
