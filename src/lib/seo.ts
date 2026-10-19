import type { Metadata } from 'next';
import { getSettings } from '@/lib/settings';

export async function appUrl(path = '/'): Promise<string> {
  const settings = await getSettings();
  const base = settings['site.url'].replace(/\/$/, '');
  if (!path || path === '/') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

type PageMetaInput = {
  title: string;
  description: string;
  path: string;
  image?: string;
  noIndex?: boolean;
  type?: 'website' | 'article';
  keywords?: string[];
};

/** Canonical + OpenGraph metadata for a public page. */
export async function pageMetadata(input: PageMetaInput): Promise<Metadata> {
  const url = await appUrl(input.path);
  const settings = await getSettings();
  const image = input.image ?? (settings['seo.ogImage'] || undefined);
  return {
    title: input.title,
    description: input.description,
    keywords: input.keywords ?? (settings['site.keywords'] as unknown as string[]),
    alternates: { canonical: url, languages: { en: url, 'x-default': url } },
    robots: input.noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      siteName: settings['site.name'],
      type: input.type ?? 'website',
      // Omit the key entirely (not `undefined`) so the opengraph-image.tsx
      // file convention still fills in a generated image per route.
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/* ------------------------------- JSON-LD ------------------------------ */

export type JsonLd = Record<string, unknown>;

export function organizationJsonLd(awaitable?: { url: string; name: string; description: string }): JsonLd {
  const url = awaitable?.url ?? 'https://www.bookyourspa.net';
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: awaitable?.name ?? 'BookYourSpa',
    url,
    logo: `${url}/icon.svg`,
    description: awaitable?.description ?? 'Spa & wellness booking marketplace',
    sameAs: [url],
  };
}

export function webSiteJsonLd(url: string, name: string, searchPath?: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url,
    ...(searchPath
      ? { potentialAction: { '@type': 'SearchAction', target: `${url}${searchPath}?q={search_term_string}`, 'query-input': 'required name=search_term_string' } }
      : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[], base: string): JsonLd {
  const origin = base.replace(/\/+$/, ''); // tolerate trailing slash from appUrl('')
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${origin}${item.path.startsWith('/') ? item.path : `/${item.path}`}`,
    })),
  };
}

export function daySpaJsonLd(input: {
  name: string;
  url: string;
  image?: string | null;
  description?: string | null;
  address?: { street: string; city: string; region?: string | null; country: string };
  geo?: { lat: string; lng: string } | null;
  phone?: string | null;
  priceRange?: string;
  openingHours?: string[];
  areaServed?: string[];
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'DaySpa',
    name: input.name,
    url: input.url,
    ...(input.image ? { image: input.image } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.priceRange ? { priceRange: input.priceRange } : {}),
    ...(input.phone ? { telephone: input.phone } : {}),
    ...(input.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: input.address.street,
            addressLocality: input.address.city,
            addressRegion: input.address.region ?? undefined,
            addressCountry: input.address.country,
          },
        }
      : {}),
    ...(input.geo ? { geo: { '@type': 'GeoCoordinates', latitude: input.geo.lat, longitude: input.geo.lng } } : {}),
    ...(input.openingHours?.length ? { openingHoursSpecification: input.openingHours } : {}),
    ...(input.areaServed?.length ? { areaServed: input.areaServed.map((a) => ({ '@type': 'City', name: a })) } : {}),
  };
}

export function treatmentJsonLd(input: {
  name: string;
  url: string;
  description: string;
  image?: string | null;
  duration: string;
  price: number | null;
  currency: string;
  providerName: string;
  availability?: 'InStock' | 'PreOrder' | 'OutOfStock';
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: input.name,
    name: input.name,
    description: input.description,
    url: input.url,
    ...(input.image ? { image: input.image } : {}),
    provider: { '@type': 'Organization', name: input.providerName },
    ...(input.price !== null
      ? {
          offers: {
            '@type': 'Offer',
            price: formatSchemaPrice(input.price, input.currency),
            priceCurrency: input.currency,
            availability: `https://schema.org/${input.availability ?? 'InStock'}`,
            url: input.url,
          },
        }
      : {}),
    termsOfService: input.duration,
  };
}

function formatSchemaPrice(minor: number, currency: string): string {
  const exp = ['IDR', 'JPY', 'KRW', 'VND'].includes(currency.toUpperCase()) ? 0 : 2;
  return (minor / 10 ** exp).toFixed(exp);
}

export function searchResultsJsonLd(url: string, name: string, results: { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    url,
    numberOfItems: results.length,
    itemListElement: results.slice(0, 20).map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: r.name,
      url: r.url,
    })),
  };
}
