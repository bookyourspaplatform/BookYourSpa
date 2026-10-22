import { cookies } from 'next/headers';
import { isLangCode, type LangCode } from '@/lib/i18n';

export const LANG_COOKIE = 'bys.lang';

/** Visitor's interface language from the cookie the header switcher sets. */
export async function getLang(): Promise<LangCode> {
  const store = await cookies();
  const v = store.get(LANG_COOKIE)?.value;
  return v && isLangCode(v) ? v : 'en';
}
