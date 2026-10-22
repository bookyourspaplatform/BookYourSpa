import { cookies } from 'next/headers';
import { isDisplayCurrency, type DisplayCurrency } from '@/lib/display-currency';

export const CURRENCY_COOKIE = 'bys.currency';

/** Visitor's display currency from the cookie the header switcher sets. */
export async function getDisplayCurrency(): Promise<DisplayCurrency> {
  const store = await cookies();
  const v = store.get(CURRENCY_COOKIE)?.value?.toUpperCase();
  return v && isDisplayCurrency(v) ? v : 'USD';
}
