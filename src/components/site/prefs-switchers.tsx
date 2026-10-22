'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setCurrencyAction, setLanguageAction } from '@/lib/actions/prefs';
import { DISPLAY_CURRENCIES, type DisplayCurrency } from '@/lib/display-currency';
import { LANGUAGES, type LangCode } from '@/lib/i18n';

const selectCls =
  'cursor-pointer appearance-none bg-transparent pe-6 ps-1.5 text-[13px] font-medium text-ink-700 outline-none hover:text-ink-900 focus-visible:text-brand-700';

/**
 * Top-bar pickers for display currency and interface language. Both persist
 * to cookies server-side and refresh the current page so server components
 * re-render in the chosen locale/currency.
 */
export function PrefsSwitchers({
  currency,
  lang,
  compact = false,
}: {
  currency: DisplayCurrency;
  lang: LangCode;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className={`flex items-center ${compact ? 'gap-3' : 'gap-4'}`} aria-busy={pending}>
      <label className="flex items-center gap-1">
        <span className="sr-only">Display currency</span>
        <select
          className={selectCls}
          value={currency}
          onChange={(e) => {
            const v = e.target.value;
            startTransition(async () => {
              await setCurrencyAction(v);
              router.refresh();
            });
          }}
        >
          {DISPLAY_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
      </label>

      <span className="h-3.5 w-px bg-ink-200" aria-hidden />

      <label className="flex items-center gap-1">
        <span className="sr-only">Interface language</span>
        <select
          className={selectCls}
          value={lang}
          onChange={(e) => {
            const v = e.target.value;
            startTransition(async () => {
              await setLanguageAction(v);
              router.refresh();
            });
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
