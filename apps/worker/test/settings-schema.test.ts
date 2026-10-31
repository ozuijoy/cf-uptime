import { describe, expect, it } from 'vitest';

import { parseSettingsPatch } from '../src/settings';

describe('settings patch schema', () => {
  it('accepts site_locale updates', () => {
    expect(parseSettingsPatch({ site_locale: 'auto' })).toEqual({ site_locale: 'auto' });
    expect(parseSettingsPatch({ site_locale: 'ja' })).toEqual({ site_locale: 'ja' });
  });

  it('rejects unknown keys', () => {
    expect(() => parseSettingsPatch({ site_locale_x: 'en' })).toThrow(/unrecognized key/i);
  });

  it('rejects empty patches', () => {
    expect(() => parseSettingsPatch({})).toThrow(/At least one field must be provided/);
  });
});
