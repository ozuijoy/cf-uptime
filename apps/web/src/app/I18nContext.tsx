import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { LocaleSetting, SupportedLocale } from '../api/types';
import { messages, supportedLocales, type MessageKey } from '../i18n/messages';

const STORAGE_KEY = 'uptimer-locale-setting-v1';

type TranslateValues = Record<string, string | number>;

type I18nContextValue = {
  locale: SupportedLocale;
  localeSetting: LocaleSetting;
  browserLocale: SupportedLocale;
  setLocaleSetting: (next: LocaleSetting) => void;
  applyServerLocaleSetting: (next: LocaleSetting | null | undefined) => void;
  t: (key: MessageKey, values?: TranslateValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function localeFromTag(tag: string): SupportedLocale | null {
  const lower = tag.toLowerCase();

  // 中文一律走 zh-TW（正體中文）；zh-CN / zh-Hans 只在後端設定相容層處理。
  if (lower.startsWith('zh')) return 'zh-TW';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('en')) return 'en';
  return null;
}

function normalizeLocaleSetting(value: unknown): LocaleSetting | null {
  if (typeof value !== 'string') return null;
  if (value === 'auto') return 'auto';
  return supportedLocales.includes(value as SupportedLocale) ? (value as SupportedLocale) : null;
}

function normalizeSupportedLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null;
  return supportedLocales.includes(value as SupportedLocale) ? (value as SupportedLocale) : null;
}

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return 'en';

  const languages = [...(navigator.languages ?? []), navigator.language].filter(
    (lang): lang is string => typeof lang === 'string' && lang.length > 0,
  );

  for (const lang of languages) {
    const candidate = localeFromTag(lang);
    if (candidate) return candidate;
  }

  return 'en';
}

function readStoredLocaleSetting(): LocaleSetting {
  if (typeof window === 'undefined') return 'auto';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return normalizeLocaleSetting(raw) ?? 'auto';
}

function interpolate(template: string, values?: TranslateValues): string {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_all, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function resolveEffectiveLocale(
  setting: LocaleSetting,
  browserLocale: SupportedLocale,
): SupportedLocale {
  const normalizedSetting = normalizeLocaleSetting(setting) ?? 'auto';
  const normalizedBrowser = normalizeSupportedLocale(browserLocale) ?? 'en';
  return normalizedSetting === 'auto' ? normalizedBrowser : normalizedSetting;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [localeSetting, setLocaleSettingState] = useState<LocaleSetting>(readStoredLocaleSetting);
  const [browserLocale, setBrowserLocale] = useState<SupportedLocale>(detectBrowserLocale);

  const locale = useMemo(
    () => resolveEffectiveLocale(localeSetting, browserLocale),
    [browserLocale, localeSetting],
  );

  const setLocaleSetting = useCallback((next: LocaleSetting) => {
    const normalized = normalizeLocaleSetting(next) ?? 'auto';
    setLocaleSettingState((prev) => (prev === normalized ? prev : normalized));
  }, []);

  const applyServerLocaleSetting = useCallback((next: LocaleSetting | null | undefined) => {
    const normalized = normalizeLocaleSetting(next);
    if (!normalized) return;
    setLocaleSettingState((prev) => (prev === normalized ? prev : normalized));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, localeSetting);
  }, [localeSetting]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onLanguageChange = () => setBrowserLocale(detectBrowserLocale());
    window.addEventListener('languagechange', onLanguageChange);
    return () => window.removeEventListener('languagechange', onLanguageChange);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: MessageKey, values?: TranslateValues) => {
      const localeMessages = messages[locale] ?? messages.en;
      const translated = localeMessages[key] ?? messages.en[key] ?? key;
      return interpolate(translated, values);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeSetting,
      browserLocale,
      setLocaleSetting,
      applyServerLocaleSetting,
      t,
    }),
    [applyServerLocaleSetting, browserLocale, locale, localeSetting, setLocaleSetting, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

export type { MessageKey };
