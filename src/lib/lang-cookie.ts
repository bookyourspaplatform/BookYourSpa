import { cookies, headers } from 'next/headers';
import { isLangCode, type LangCode } from '@/lib/i18n';
import { detectLang } from '@/lib/locale-detect';

export const LANG_COOKIE = 'bys.lang';

/**
 * Visitor's interface language. With no cookie yet (first visit) it falls
 * back to the browser's Accept-Language, so the first render is already
 * translated — the proxy then persists that detection.
 */
export async function getLang(): Promise<LangCode> {
  const store = await cookies();
  const v = store.get(LANG_COOKIE)?.value;
  if (v && isLangCode(v)) return v;
  const h = await headers();
  return detectLang(h.get('accept-language'), h.get('x-vercel-ip-country'));
}
