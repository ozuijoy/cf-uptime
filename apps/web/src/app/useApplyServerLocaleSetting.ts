import { useEffect } from 'react';

import type { LocaleSetting } from '../api/types';
import { useI18n } from './I18nContext';

export function useApplyServerLocaleSetting(localeSetting: LocaleSetting | null | undefined): void {
  const { applyServerLocaleSetting } = useI18n();

  useEffect(() => {
    applyServerLocaleSetting(localeSetting);
  }, [applyServerLocaleSetting, localeSetting]);
}
