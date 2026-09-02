/** @type {import('next').NextConfig} */

/**
 * Content-Security-Policy and companion headers.
 *
 * The app renders only its own JS/CSS and a small set of external resources:
 * OpenStreetMap tiles for the Leaflet map and Clearbit logos on the companies
 * page. Everything else is denied.
 *
 * 'unsafe-inline' is present on BOTH style-src and script-src:
 *  - style-src: Leaflet and Tailwind inject inline styles.
 *  - script-src: Next's App Router emits inline bootstrap scripts with no nonce
 *    unless a middleware supplies one. This is a known weakening — it means the
 *    CSP is not a full XSS backstop today. The one place untrusted content is
 *    inlined (the JSON-LD block in /offre/[id]) is escaped separately by
 *    safeJsonLd, so there is no current injection vector; hardening to a
 *    per-request nonce (via middleware, dropping 'unsafe-inline' on scripts) is
 *    a follow-up.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Map tiles (OSM — both the bare host and any subdomain form), company logos
  // (Clearbit), and data/blob for inline assets.
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://logo.clearbit.com",
  "font-src 'self' data:",
  // The French government geocoder is called server-side, so the browser only
  // talks to our own origin; keep connect-src tight.
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
];

const nextConfig = {
  // The shared db package ships TypeScript, so Next must compile it.
  transpilePackages: ['@catwalks/db'],
  // Railway builds from the repo root; standalone keeps the image small.
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
