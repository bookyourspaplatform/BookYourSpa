import { settings as settingsTable } from '@/db/schema';
import { getDb } from '@/db';

/** Platform settings with safe defaults — DB rows override these. */
export const DEFAULT_SETTINGS = {
  'site.name': 'BookYourSpa',
  'site.tagline': "Discover and book the best spas in Bali, Dubai and beyond",
  'site.url': 'https://www.bookyourspa.net',
  'site.description':
    'Book spa treatments, massages and wellness rituals online across Bali, Dubai and international destinations. Compare prices, choose your therapist and get instant booking vouchers.',
  'site.keywords': [
    'spa booking',
    'massage booking',
    'wellness',
    'Bali spa',
    'Dubai spa',
    'online spa reservation',
  ],
  'site.announcement': '',
  'site.supportEmail': 'hello@bookyourspa.net',
  'site.phone': '+62 361 000 0000',
  'seo.ogImage': '', // empty → per-route opengraph-image.tsx file convention takes over
  'seo.googleVerification': '',
  'seo.indexing': true,
  'booking.leadTimeMinutes': 60,
  'booking.cancellationHours': 24,
  'booking.pendingHoldMinutes': 30,
  'booking.defaultIntervalMinutes': 30,
  'finance.defaultPlatformCommissionBps': 1500,
  'finance.defaultAgentCommissionBps': 1000,
  'finance.defaultCurrency': 'IDR',
  'features.onlinePayments': true,
  'features.guestCheckout': true,
  'features.agentPortal': true,
  'features.providerSignup': true,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type Settings = { [K in SettingKey]: (typeof DEFAULT_SETTINGS)[K] };

let cache: { value: Settings; at: number } | null = null;
const TTL_MS = 15_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  try {
    const db = await getDb();
    const rows = await db.select().from(settingsTable);
    for (const row of rows) if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  } catch (err) {
    console.error('[settings] falling back to defaults:', err);
  }
  cache = { value: merged as Settings, at: Date.now() };
  return cache.value;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const all = await getSettings();
  return all[key];
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  cache = null;
}

export function invalidateSettingsCache(): void {
  cache = null;
}
