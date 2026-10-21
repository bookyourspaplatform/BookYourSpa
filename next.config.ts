import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: cacheComponents stays off — this marketplace renders live DB data
  // (availability, prices, bookings) per request rather than from a prerender
  // cache. Pages that must be fresh opt in with `export const dynamic`.
  // Native modules must not be bundled: PGlite loads its WASM via import.meta.url.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    // Renamed public URLs stay reachable (old booking emails / search index).
    const branchRenames: Record<string, string> = {
      seminyak: 'bali-orchid-spa',
      ubud: 'royal-orchid-spa',
    };
    const rules = [
      {
        source: '/spas/aranjaya-spa-wellness/:branch*',
        destination: '/spas/orchid-spa/:branch*',
        permanent: true,
      },
      {
        source: '/spas/aranjaya-spa-wellness',
        destination: '/spas/orchid-spa',
        permanent: true,
      },
    ];
    for (const [oldSlug, newSlug] of Object.entries(branchRenames)) {
      rules.push({
        source: `/spas/:provider/${oldSlug}`,
        destination: `/spas/:provider/${newSlug}`,
        permanent: true,
      });
    }
    return rules;
  },

  async headers() {
    const csp = [
      "default-src 'self'",
      // Next injects inline bootstrap/styles; gateways need their own origins.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.paypal.com https://apis.google.com https://checkout.razorpay.com https://lumberjack.razorpay.com",
      "frame-src 'self' https://js.stripe.com https://www.paypal.com https://api.razorpay.com https://checkout.razorpay.com https://maps.google.com https://www.google.com",
      "connect-src 'self' https://api.stripe.com https://www.paypal.com https://api.razorpay.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Content-Security-Policy', value: csp },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
            : []),
        ],
      },
      {
        // Vouchers are public-by-unguessable-code; never let them be framed.
        source: '/voucher/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
