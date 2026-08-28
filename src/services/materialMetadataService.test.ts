import { describe, expect, it } from 'vitest';
import {
  buildMaterialMetadataDetailsEndpoint,
  buildMaterialMetadataEndpoint,
} from './materialMetadataService';

describe('material metadata service', () => {
  it('resolves search and details endpoints from supported proxy URLs', () => {
    expect(buildMaterialMetadataEndpoint('https://example.com/chat/completions'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataEndpoint('https://example.com/planning-attachment'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataEndpoint('https://example.com/'))
      .toBe('https://example.com/material-metadata/search');
    expect(buildMaterialMetadataDetailsEndpoint('https://example.com/chat/completions'))
      .toBe('https://example.com/material-metadata/details');
    expect(buildMaterialMetadataDetailsEndpoint('https://example.com/material-metadata/search'))
      .toBe('https://example.com/material-metadata/details');
  });
});
