import { getSettings } from '@/lib/settings';
import { brandOgImage, BRAND_OG_SIZE } from '@/components/og/brand-og';

export const runtime = 'nodejs';
export const alt = 'BookYourSpa — spa & wellness booking marketplace';
export const size = BRAND_OG_SIZE;
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const siteName = String((await getSettings())['site.name'] ?? 'BookYourSpa');
  return brandOgImage(siteName);
}
