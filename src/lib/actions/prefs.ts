'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { isDisplayCurrency } from '@/lib/display-currency';
import { CURRENCY_COOKIE } from '@/lib/currency-cookie';
import { isLangCode } from '@/lib/i18n';
import { LANG_COOKIE } from '@/lib/lang-cookie';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Persist the visitor's display currency and refresh the current page. */
export async function setCurrencyAction(currency: string): Promise<void> {
  if (!isDisplayCurrency(currency)) return;
  const store = await cookies();
  store.set(CURRENCY_COOKIE, currency.toUpperCase(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR,
  });
  revalidatePath('/', 'layout');
}

/** Persist the visitor's interface language and refresh the current page. */
export async function setLanguageAction(lang: string): Promise<void> {
  if (!isLangCode(lang)) return;
  const store = await cookies();
  store.set(LANG_COOKIE, lang, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR,
  });
  revalidatePath('/', 'layout');
}
