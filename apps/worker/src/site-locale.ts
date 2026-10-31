// 站台語系（site_locale）的唯一來源。
//
// 本專案只提供一種中文：zh-TW（正體中文）。
// 舊資料裡的 zh-CN / zh-Hans / zh-HK … 一律在讀取時正規化成 zh-TW，
// 讓既有資料庫不必先跑 migration 也能直接升級。

export const SITE_LOCALES = ['auto', 'en', 'zh-TW', 'ja', 'es'] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

const LEGACY_CHINESE_LOCALE_ALIASES: Record<string, SiteLocale> = {
  zh: 'zh-TW',
  'zh-cn': 'zh-TW',
  'zh-hans': 'zh-TW',
  'zh-sg': 'zh-TW',
  'zh-my': 'zh-TW',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
};

export function normalizeSiteLocale(value: string | null | undefined): SiteLocale | null {
  if (typeof value !== 'string') return null;

  const lower = value.trim().toLowerCase();
  if (!lower) return null;

  const aliased = LEGACY_CHINESE_LOCALE_ALIASES[lower];
  if (aliased) return aliased;

  return (SITE_LOCALES as readonly string[]).includes(lower) ? (lower as SiteLocale) : null;
}