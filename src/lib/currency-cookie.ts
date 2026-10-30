import { cookies, headers } from 'next/headers';
import { isDisplayCurrency, type DisplayCurrency } from '@/lib/display-currency';
import { detectCurrency } from '@/lib/locale-detect';

export const CURRENCY_COOKIE = 'bys.currency';

/**
 * Visitor's display currency. With no cookie yet (first visit) it is derived
 * from the request's country/Accept-Language, so the very first render is
 * already in the visitor's currency — the proxy then persists that detection.
 */
export async function getDisplayCurrency(): Promise<DisplayCurrency> {
  const store = await cookies();
  const v = store.get(CURRENCY_COOKIE)?.value?.toUpperCase();
  if (v && isDisplayCurrency(v)) return v;
  const h = await headers();
  return detectCurrency(h.get('x-vercel-ip-country'), h.get('accept-language'));
}
