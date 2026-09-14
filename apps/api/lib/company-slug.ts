/**
 * A URL slug for a Maison — lowercase, accents stripped, non-alphanumerics to
 * hyphens. Stable and readable: /entreprise/cartier, /entreprise/ami-paris.
 *
 * Split out of lib/companies.ts on purpose: that module pulls in lib/groups.ts,
 * which reads the reference CSV via `node:fs` — fine on the server, fatal if a
 * CLIENT component (companies-view.tsx builds a Link with this slug) imports it,
 * since bundling `node:fs` into client JS breaks the build. This file has zero
 * dependencies, so it is safe on both sides.
 */
export function companySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
