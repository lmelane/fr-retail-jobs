import type { SourceTier } from '@catwalks/db/publications';

/**
 * LES RÈGLES DE CATALOGAGE D'UNE SOURCE — son palier et sa clé stable.
 *
 * Ce module portait aussi le chargement du seed CSV ; il a été supprimé le 2026-09-17 (voir le
 * bloc plus bas). Ce qui reste décrit une source INDÉPENDAMMENT de son origine : le palier qui
 * arbitre une déduplication, et la clé qui la nomme de façon stable dans `JobSource.sourceKey`.
 *
 * Ces deux règles sont lues par `sourceStore.ts` et par le flux de candidature de sources — elles
 * n'ont jamais dépendu du CSV.
 */

export type SourceKind =
  | 'teamtailor'
  | 'phenom'
  | 'digitalrecruiters'
  | 'workday'
  | 'greenhouse'
  | 'lever'
  | 'lever-eu'
  | 'smartrecruiters-whitelabel'
  | 'recruitee'
  | 'wttj'
  | 'gestmax'
  | 'talentview'
  | 'pinpoint'
  | 'eightfold'
  | 'wordpress-custom'
  | string;

export type CatalogSource = {
  maison: string;
  careersDomain: string;
  kind: SourceKind;
  entryUrl: string;
  /** Shape of a job URL, as observed. Empty when the source is an API. */
  jobUrlPattern: string;
};

/**
 * ⚠️ LE SEED CSV A ÉTÉ SUPPRIMÉ LE 2026-09-17, ET IL NE FAUT PAS LE RECRÉER.
 *
 * `data/seeds/sources.csv` portait 83 lignes quand la table en portait 536, sans statut, sans
 * révision, et avec des configurations périmées. Il était le chemin officiel de réensemencement
 * (`npm run import-sources`) — donc un piège : sur une base vide, il aurait recréé 83 sources en
 * DRAFT qui n'ont plus rien à voir avec le registre réel, et elles seraient entrées en conflit de
 * `tenantKey` avec les vraies.
 *
 * Le réensemencement passe désormais par l'export du registre lui-même :
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/exporter-registre-sources.mts <fichier.json>
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/reimporter-registre-sources.mts <fichier.json> --ecrire
 *
 * Ce qui reste ci-dessous — `tierFor` et `sourceKeyFor` — n'a jamais dépendu du CSV : ce sont des
 * règles métier (palier de déduplication, clé stable) lues par `sourceStore.ts` et le flux de
 * candidature de sources. Elles restent.
 */

/**
 * Which ATS families answer through an API — one request per employer, with the
 * description included. Everything else falls back to sitemap + JSON-LD.
 */
const API_KINDS = new Set([
  'harri', 'talentrecruiter', 'easycruit',
  'flatchr',
  'jobaffinity-wordpress',
  'greenhouse',
  'lever',
  'lever-eu',
  'ashby',
  'workable',
  'recruitee',
  'personio',
  'workday',
  'wttj',
]);

/**
 * Flow-B sources: agencies and boards whose offers are client mandates, not
 * their own hiring. They may be the ONLY source for an exclusive mandate, but
 * must never outrank an employer's own posting of the same job.
 */
const RECRUITER_MAISONS = new Set(['Luxe Talent', 'Michael Page France', 'Michael Page']);

/** Tier for dedup: a jobboard never outranks an employer's own site. */
export function tierFor(source: CatalogSource): SourceTier {
  if (RECRUITER_MAISONS.has(source.maison)) return 'SPECIALIST_JOBBOARD';
  if (source.kind === 'wttj' || source.kind === 'fashionjobs') return 'SPECIALIST_JOBBOARD';
  if (API_KINDS.has(source.kind)) return 'ATS_OFFICIAL';
  return 'EMPLOYER_DIRECT';
}

/** Stable key for JobSource rows: the maison, slugified. */
export function sourceKeyFor(source: CatalogSource): string {
  return source.maison
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
