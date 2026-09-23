/**
 * APPLIQUER LES CORRECTIONS D'ATS ET DE PORTAIL RELUES À LA MAIN — inspection par défaut.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/corriger-sources-relues.mts <registre-relu.csv>
 *
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/corriger-sources-relues.mts <registre-relu.csv> --ecrire
 *
 * ── POURQUOI CE SCRIPT EXISTE ──────────────────────────────────────────────────────────────────
 *
 * `importer-registre-csv.mts` n'importait que trois colonnes : domaine officiel, périmètre du
 * portail, et le passage en RETIRED. Les corrections d'ATS et de PORTAIL — celles qui redressent
 * une source pointant sur le mauvais employeur — étaient ignorées SANS un mot.
 *
 * Conséquence mesurée le 19/09/2026 : `picard` collectait les offres de Friedrich PICARD GmbH
 * (roulements à billes, Bochum) sous le nom de la maroquinerie PICARD. Le CEO l'avait documenté
 * dans sa relecture et corrigé dans son fichier ; rien n'était arrivé en base. Onze sources sont
 * dans ce cas.
 *
 * ── CE QU'IL FAIT ──────────────────────────────────────────────────────────────────────────────
 *
 * Il ne corrige QUE les sources dont l'ATS relu diffère de celui en base : ce sont les boards
 * usurpés, identifiés un par un. Pour chacune, il écrit la famille et la configuration dérivée du
 * portail relu — l'URL que le relecteur a vérifiée lui-même.
 *
 * Le déclencheur `Source_record_revision` crée une nouvelle révision à chaque écriture : c'est
 * voulu. Changer l'ATS d'une source change ce qu'elle collecte, et les preuves d'identité
 * antérieures ne valent plus pour cette configuration.
 *
 * Il ne touche pas au statut, ne crée aucune Maison, ne promeut rien.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { parseSourceCandidate } from '../../src/connectors/sourceCandidate.js';
import { tenantKeyOf } from '../../src/connectors/sourceStore.js';

const ECRIRE = process.argv.includes('--ecrire');
const fichier = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!fichier) { console.error('Usage : corriger-sources-relues.mts <registre-relu.csv> [--ecrire]'); process.exit(2); }

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const texte = readFileSync(fichier, 'utf8').replace(/^﻿/, '');
const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
const entetes = lignes[0].split(';').map((h) => h.trim());
const csv = lignes.slice(1).map((l) => {
  const cases = l.split(';');
  return Object.fromEntries(entetes.map((h, i) => [h, (cases[i] ?? '').trim()])) as Record<string, string>;
});

/**
 * La configuration que chaque famille attend, dérivée du portail relu. On ne couvre que les
 * familles réellement rencontrées dans les corrections : une famille inconnue ici est REFUSÉE
 * plutôt que configurée au hasard.
 */
function configPour(ats: string, portail: string): Record<string, unknown> | null {
  let u: URL;
  try { u = new URL(portail); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  switch (ats) {
    case 'generic-listing':
    case 'generic-jsonld':
      return { startUrl: u.toString() };
    case 'teamtailor':
      return { origin: u.origin };
    case 'personio':
      return { host: u.hostname };
    case 'phenom':
      return { origin: u.origin, ...(u.pathname.replace(/\/+$/, '') ? { localePath: u.pathname.replace(/\/+$/, '') } : {}) };
    case 'oraclehcm': {
      const path = /^\/hcmUI\/CandidateExperience\/([a-z-]+)\/sites\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(u.pathname);
      return path ? { origin: u.origin, lang: path[1], siteNumber: path[2] } : null;
    }
    default:
      return null;
  }
}

type Correction = { key: string; maison: string; avant: string; apres: string; portail: string; config: Record<string, unknown>; careersDomain: string; tenantKey: string; revisionId: string | null };
const corrections: Correction[] = [];
const refus: string[] = [];

const base = new Map((await prisma.$queryRawUnsafe<Array<{ key: string; kind: string; maison: string; config: unknown; tier: 'EMPLOYER_DIRECT' | 'GROUP_OFFICIAL' | 'ATS_OFFICIAL'; currentRevisionId: string | null }>>(
  `SELECT key, kind, maison, config, tier, "currentRevisionId" FROM "Source"`)).map((s) => [s.key, s]));

for (const r of csv) {
  const s = base.get(r.cle);
  const kind = r.ats === 'oracle_hcm' ? 'oraclehcm' : r.ats;
  if (!s || !kind || kind === s.kind) continue;
  if (!r.portail_url) { refus.push(`${r.cle} : ATS relu « ${r.ats} » mais aucun portail_url`); continue; }
  const config = configPour(kind, r.portail_url);
  if (!config) { refus.push(`${r.cle} : famille « ${r.ats} » sans forme de configuration connue — à traiter à la main`); continue; }
  try {
    const careersDomain = new URL(r.portail_url).hostname;
    const candidate = parseSourceCandidate({ key: s.key, maison: s.maison, kind, config, careersDomain, tier: s.tier });
    corrections.push({ key: r.cle, maison: s.maison, avant: s.kind, apres: candidate.kind, portail: r.portail_url,
      config: candidate.config, careersDomain, tenantKey: tenantKeyOf(kind, JSON.stringify(candidate.config), careersDomain, s.maison),
      revisionId: s.currentRevisionId });
  } catch { refus.push(`${r.cle} : configuration refusée par le contrat des candidats`); }
}

console.log(`\nCORRECTIONS D'ATS ET DE PORTAIL — ${corrections.length} source(s)\n`);
for (const c of corrections) {
  console.log(`   ${c.key.padEnd(26)} ${c.avant.padEnd(18)} → ${c.apres.padEnd(18)} ${c.portail.slice(0, 54)}`);
  console.log(`   ${' '.repeat(26)} config : ${JSON.stringify(c.config)}`);
}
if (refus.length) {
  console.log(`\n   ${refus.length} REFUS (ces sources ne seront pas écrites) :`);
  for (const m of refus) console.log(`      ${m}`);
}

if (!ECRIRE) {
  console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour appliquer.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

let ecrites = 0;
for (const c of corrections) {
  // Une écriture par source, hors transaction : le déclencheur de révision prend un verrou sur la
  // ligne, et grouper les écritures ferait attendre inutilement les suivantes.
  ecrites += await prisma.$executeRawUnsafe(
    `UPDATE "Source" SET kind = $1, config = $2::jsonb, "careersDomain" = $5, "tenantKey" = $6 WHERE key = $3 AND kind = $4 AND "currentRevisionId" IS NOT DISTINCT FROM $7::text`,
    c.apres, JSON.stringify(c.config), c.key, c.avant, c.careersDomain, c.tenantKey, c.revisionId);
}
console.log(`\n   ${ecrites} source(s) corrigée(s)`);
console.log(`   Une nouvelle révision a été créée pour chacune : changer l'ATS change ce qu'elles collectent.\n`);

await prisma.$disconnect();
