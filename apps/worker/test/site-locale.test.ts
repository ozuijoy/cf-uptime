import { describe, expect, it } from 'vitest';

import { settingsPatchInputSchema } from '../src/schemas/settings';
import { normalizeSiteLocale } from '../src/site-locale';

describe('site-locale', () => {
  it('keeps the supported locales as-is', () => {
    expect(normalizeSiteLocale('auto')).toBe('auto');
    expect(normalizeSiteLocale('en')).toBe('en');
    expect(normalizeSiteLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeSiteLocale('ja')).toBe('ja');
    expect(normalizeSiteLocale('es')).toBe('es');
  });

  it('folds every legacy Chinese tag into zh-TW', () => {
    for (const tag of ['zh-CN', 'zh-cn', 'zh-Hans', 'zh-hans', 'zh', 'zh-HK', 'zh-SG']) {
      expect(normalizeSiteLocale(tag)).toBe('zh-TW');
    }
  });

  it('returns null for unknown or empty values', () => {
    expect(normalizeSiteLocale('')).toBeNull();
    expect(normalizeSiteLocale('klingon')).toBeNull();
    expect(normalizeSiteLocale(null)).toBeNull();
    expect(normalizeSiteLocale(undefined)).toBeNull();
  });

  it('normalizes legacy locales submitted through the settings API', () => {
    expect(settingsPatchInputSchema.parse({ site_locale: 'zh-CN' }).site_locale).toBe('zh-TW');
    expect(settingsPatchInputSchema.parse({ site_locale: 'zh-TW' }).site_locale).toBe('zh-TW');
    expect(settingsPatchInputSchema.safeParse({ site_locale: 'klingon' }).success).toBe(false);
  });
});
