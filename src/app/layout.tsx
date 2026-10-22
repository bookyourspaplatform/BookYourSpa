import type { Metadata, Viewport } from 'next';
import { DM_Sans, Fraunces } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ui/toast';
import { getSettings } from '@/lib/settings';
import { dirOf } from '@/lib/i18n';
import { getLang } from '@/lib/lang-cookie';

const bodyFont = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const displayFont = Fraunces({
  subsets: ['latin'],
  variable: '--font-face',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const base = settings['site.url'];
  return {
    metadataBase: new URL(base),
    title: {
      default: `${settings['site.name']} — ${settings['site.tagline']}`,
      template: `%s | ${settings['site.name']}`,
    },
    description: settings['site.description'],
    keywords: settings['site.keywords'] as unknown as string[],
    applicationName: settings['site.name'],
    robots: settings['seo.indexing'] ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: 'website',
      siteName: settings['site.name'],
      title: `${settings['site.name']} — ${settings['site.tagline']}`,
      description: settings['site.description'],
      url: base,
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: settings['site.name'],
      description: settings['site.description'],
    },
    verification: settings['seo.googleVerification']
      ? { google: settings['seo.googleVerification'] }
      : undefined,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#20524c',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Interface language + direction come from the cookie the header switcher sets,
  // so translated chrome and RTL (Arabic) apply to the whole document.
  const lang = await getLang();
  return (
    <html lang={lang} dir={dirOf(lang)} className={`${bodyFont.variable} ${displayFont.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
