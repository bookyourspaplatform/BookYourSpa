import type { DisplayCurrency } from '@/lib/display-currency';
import { isLangCode, type LangCode } from '@/lib/i18n';

/**
 * First-visit locale detection — pure and edge-safe so both the proxy (which
 * writes the cookies) and the cookie readers (which must agree on the very
 * first render) can use it. Only a *saved* cookie beats this: the visitor's
 * explicit choice in the header always wins.
 *
 * Currency: country from Vercel's `x-vercel-ip-country`, falling back to the
 * region subtag of Accept-Language. An unmapped or undetectable country falls
 * back to USD as the global currency.
 */

const COUNTRY_CURRENCY: Record<string, DisplayCurrency> = {
  ID: 'IDR',
  AE: 'AED',
  SA: 'AED',
  SG: 'SGD',
  GB: 'GBP',
  AU: 'AUD',
  JP: 'JPY',
  TH: 'THB',
  MY: 'MYR',
  IN: 'INR',
  CN: 'CNY',
  // Eurozone
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR', BE: 'EUR',
  AT: 'EUR', IE: 'EUR', GR: 'EUR', FI: 'EUR', SK: 'EUR', SI: 'EUR', LT: 'EUR',
  LV: 'EUR', EE: 'EUR', LU: 'EUR', MT: 'EUR', CY: 'EUR', HR: 'EUR', MC: 'EUR',
};

const COUNTRY_LANG: Record<string, LangCode> = {
  ID: 'id', CN: 'zh', TW: 'zh', JP: 'ja', KR: 'ko', FR: 'fr', DE: 'de', ES: 'es',
  PT: 'pt', RU: 'ru', SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar', IN: 'hi',
};

function acceptLanguageRegion(header: string | null): string | null {
  const first = header?.split(',')[0]?.split(';')[0]?.trim() ?? null;
  if (!first) return null;
  const region = first.split(/[-_]/)[1];
  return region ? region.toUpperCase() : null;
}

export function detectCurrency(countryHeader: string | null, acceptLanguage: string | null): DisplayCurrency {
  const country = countryHeader?.trim().toUpperCase() || acceptLanguageRegion(acceptLanguage);
  if (country && COUNTRY_CURRENCY[country]) return COUNTRY_CURRENCY[country];
  return 'USD';
}

export function detectLang(acceptLanguage: string | null, countryHeader: string | null): LangCode {
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const code = part.split(';')[0]?.trim().toLowerCase();
      if (!code) continue;
      const base = code.split('-')[0];
      if (base && isLangCode(base)) return base;
    }
  }
  const country = countryHeader?.trim().toUpperCase();
  return (country && COUNTRY_LANG[country]) || 'en';
}
