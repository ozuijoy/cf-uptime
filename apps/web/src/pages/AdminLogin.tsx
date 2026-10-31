import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '../app/I18nContext';
import { useApplyServerLocaleSetting } from '../app/useApplyServerLocaleSetting';
import { fetchStatus } from '../api/client';
import { useAuth } from '../app/AuthContext';
import { ADMIN_PATH } from '../app/adminPaths';
import { Button, Card, INPUT_CLASS } from '../components/ui';

export function AdminLogin() {
  const { t } = useI18n();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || ADMIN_PATH;

  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    staleTime: 60_000,
  });
  useApplyServerLocaleSetting(statusQuery.data?.site_locale);

  useEffect(() => {
    document.title = t('admin_login.document_title');
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmed = token.trim();
    if (!trimmed) {
      setError(t('admin_login.error_enter_token'));
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await login(trimmed);
      navigate(from, { replace: true });
    } catch {
      setError(t('admin_login.error_invalid_token'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md p-7 sm:p-8">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t('admin_login.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('admin_login.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="token"
              className="ui-label text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              {t('admin_login.token')}
            </label>
            <input
              type="password"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={INPUT_CLASS}
              placeholder={t('admin_login.placeholder')}
              autoFocus
            />
          </div>

          {error && <p className="ui-error text-sm">{error}</p>}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t('admin_login.submitting') : t('admin_login.submit')}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link
            to="/"
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {t('admin_login.back_to_status')}
          </Link>
        </div>
      </Card>
    </div>
  );
}
