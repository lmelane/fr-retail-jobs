import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Embed the exact migration contract of this build. A future migration is
// automatically required; readiness must not rely on a manually maintained
// shortlist of columns. No database access is needed during the build.
const migrationRoot = new URL('../../packages/db/prisma/migrations/', import.meta.url);
const schemaMigrations = readdirSync(migrationRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => ({
    name: entry.name,
    checksum: createHash('sha256').update(readFileSync(new URL(`${entry.name}/migration.sql`, migrationRoot))).digest('hex'),
  })).sort((a, b) => a.name.localeCompare(b.name));
if (!schemaMigrations.length) throw new Error('A web build requires its migration contract');

/**
 * En-têtes de sécurité d'un service qui ne sert QUE des routes API (D-420) :
 * aucune page, aucun script, aucune feuille de style, aucune ressource
 * tierce. La seule réponse HTML est la page « introuvable » de Next, qui
 * porte son script d'amorçage et ses styles inline sans nonce :
 * 'unsafe-inline' reste donc sur script-src et style-src pour ne pas la
 * casser ; tout le reste est fermé. Les réponses JSON portent les mêmes
 * en-têtes, sans effet.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
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
  env: { CATWALKS_SCHEMA_MIGRATIONS: JSON.stringify(schemaMigrations) },
  // La stack locale (NEXT_DIST_DIR=.next-stack) construit à côté du `.next` d'un serveur de développement.
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
