import type { Metadata } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * SEO des pages Intelligence : title ≤ 60 caractères, description, canonical,
 * OpenGraph, `noindex` sur une page sous seuil (aucune donnée) plutôt qu'une
 * page vide indexée. JSON-LD `Dataset` sur la home, `WebPage` + `BreadcrumbList`
 * ailleurs, échappés (« < » → <) pour ne jamais fermer le <script>.
 */

export const TITLE_MAX = 60;
const BRAND = 'Catwalks Intelligence';

/**
 * Licence de publication des données de l'observatoire (D41, décision Loïc
 * 2026-09-07) : reprise libre CONTRE citation + lien. Une seule définition,
 * lue par le JSON-LD `Dataset` et par la mention visible — les deux ne peuvent
 * pas diverger.
 */
export const DATA_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/deed.fr';
export const DATA_LICENSE_NAME = 'CC BY 4.0';

/** `${subject} · Catwalks Intelligence`, raccourci pour tenir en 60 caractères. */
export function intelTitle(subject: string): string {
  const full = `${subject} · ${BRAND}`;
  if (full.length <= TITLE_MAX) return full;
  const short = `${subject} · Intelligence`;
  if (short.length <= TITLE_MAX) return short;
  return `${subject.slice(0, TITLE_MAX - 2).trimEnd()}…`;
}

export function intelMetadata(input: {
  subject: string;
  description: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  const title = intelTitle(input.subject);
  const url = `${siteUrl()}${input.path}`;
  return {
    title,
    description: input.description,
    alternates: { canonical: url },
    robots: input.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description: input.description,
      url,
      type: 'website',
      siteName: 'Mode Careers',
      locale: 'fr_FR',
      images: ['/brand/ofmc.png'],
    },
    twitter: { card: 'summary', title, description: input.description },
  };
}

/** JSON.stringify sûr dans un <script> : aucune séquence « </script> » ne peut s'échapper. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export type Crumb = { name: string; path: string };

export function breadcrumbLd(crumbs: Crumb[]) {
  const base = siteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${base}${c.path}`,
    })),
  };
}

export function webPageLd(input: { name: string; description: string; path: string; dateModified?: string | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: input.name,
    description: input.description,
    url: `${siteUrl()}${input.path}`,
    inLanguage: 'fr',
    isPartOf: { '@type': 'WebSite', name: 'Mode Careers', url: siteUrl() },
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
  };
}

export function datasetLd(input: { description: string; historyStart: string; dateModified?: string | null; jobs: number; countries: number }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Catwalks Intelligence — observatoire du recrutement Mode, Luxe, Beauté, Horlogerie & Retail',
    description: input.description,
    url: `${siteUrl()}/intelligence`,
    inLanguage: 'fr',
    creator: { '@type': 'Organization', name: 'Catwalks', url: 'https://catwalks.io' },
    isAccessibleForFree: true,
    license: DATA_LICENSE_URL,
    temporalCoverage: `${input.historyStart}/..`,
    spatialCoverage: `${input.countries} pays`,
    variableMeasured: ['offres actives', 'nouvelles offres', 'offres fermées', 'Maisons qui recrutent', 'durée médiane de publication'],
    measurementTechnique: 'Agrégation quotidienne des offres publiques (1 offre canonique + N sources), snapshots journaliers',
    keywords: ['recrutement luxe', 'emploi mode', 'beauté', 'horlogerie', 'retail', 'observatoire', `${input.jobs} offres`],
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
  };
}
