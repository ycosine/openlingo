import { t } from '@extension/i18n';

export const ErrorStackTraceList = ({ error }: { error?: Error }) => (
  <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
    <div className="px-4 py-5 sm:p-6">
      <div className="text-sm text-gray-500">
        <p className="mb-2 font-medium text-gray-700">{t('displayErrorDetailsInfo')}</p>
        <div className="overflow-auto rounded-md bg-gray-50 p-4">
          <p className="break-all font-mono text-gray-800">{error?.message || t('displayErrorUnknownErrorInfo')}</p>
          {error?.stack && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">Stack trace</summary>
              <pre className="mt-2 overflow-auto border-t border-gray-200 pt-3 text-xs text-gray-700">
                {error?.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  </div>
);
