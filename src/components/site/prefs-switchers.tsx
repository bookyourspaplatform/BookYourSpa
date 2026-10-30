'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setCurrencyAction, setLanguageAction } from '@/lib/actions/prefs';
import { DISPLAY_CURRENCIES, type DisplayCurrency } from '@/lib/display-currency';
import { LANGUAGES, type LangCode } from '@/lib/i18n';

/* Lives in the dark announcement bar — keep it light-on-dark and give the
   native dropdown matching dark options. */
const selectCls =
  'cursor-pointer appearance-none bg-transparent pe-6 ps-1.5 text-[13px] font-medium text-white/85 outline-none hover:text-white focus-visible:text-white';

/** White chevron — the native arrow is stripped by `appearance-none`. */
const chevronStyle: React.CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%23ffffff' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundPosition: 'right 0 center',
  backgroundRepeat: 'no-repeat',
};

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
          style={chevronStyle}
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
            <option key={c.code} value={c.code} className="bg-ink-900 text-white">
              {c.code}
            </option>
          ))}
        </select>
      </label>

      <span className="h-3.5 w-px bg-white/35" aria-hidden />

      <label className="flex items-center gap-1">
        <span className="sr-only">Interface language</span>
        <select
          className={selectCls}
          style={chevronStyle}
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
            <option key={l.code} value={l.code} className="bg-ink-900 text-white">
              {l.native}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
