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
 * portail relu — l'URL que le relecteur a vérifiée lui-même —, complétée des réglages relus de la
 * colonne facultative `config_relue` (JSON), que le portail ne dit pas (dialecte Phenom, index du
 * site, champ de marque : PVH, 30/09/2026).
 *
 * Depuis D-485 (Marc O'Polo, 30/09/2026), une source qui GARDE sa famille est aussi corrigée quand sa ligne porte
 * `config_relue` et que la configuration obtenue diffère de celle en base : un lecteur dédié choisi dans la famille
 * `generic-listing` (`reader`), validé par le parseur de ce lecteur avant toute écriture (Marc O'Polo ; le type de billet
 * WordPress de Kastner & Öhler, D-522 §6).
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
import { careerConnectOptions, phenomDialect } from '../../src/ats/adapters/phenom.js';
import { MARC_O_POLO_READER, marcOPoloSettings } from '../../src/ats/adapters/marcOPolo.js';
import { WORDPRESS_POST_TYPE_READER, wordpressPostTypeSettings } from '../../src/ats/adapters/wordpressPostType.js';
import { evidenceHash } from '../../src/lib/evidenceHash.js';

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
  // Le JSON de `config_relue` ne se découpe pas : une ligne qui porte des cases en trop est refusée plus bas,
  // jamais relue avec des colonnes décalées.
  return { ...Object.fromEntries(entetes.map((h, i) => [h, (cases[i] ?? '').trim()])), __cases: String(cases.length) } as Record<string, string>;
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

/**
 * LES RÉGLAGES RELUS QUE LE PORTAIL NE DIT PAS (PVH, 30/09/2026). Un portail Phenom CareerConnect exige son dialecte,
 * l'index que le site interroge et le champ de marque (`careerConnectOptions`, `phenom.ts`) : dérivé du seul portail,
 * `pvh` aurait reçu le dialecte Foot Locker, qui rend HTTP 500 sur ce portail. La colonne facultative `config_relue`
 * porte ces réglages en JSON. Elle COMPLÈTE la configuration dérivée du portail relu, sans jamais en changer une valeur,
 * et un réglage que le lecteur refuse est refusé ici, avant toute écriture.
 */
function completer(kind: string, config: Record<string, unknown>, relue: string): Record<string, unknown> | string {
  if (!relue) return config;
  let extra: unknown;
  try { extra = JSON.parse(relue); } catch { return 'config_relue illisible (JSON attendu)'; }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return 'config_relue doit être un objet JSON';
  for (const [cle, valeur] of Object.entries(extra)) if (Object.hasOwn(config, cle) && config[cle] !== valeur) return `config_relue ne peut pas changer « ${cle} », dérivé du portail relu`;
  const complete = { ...config, ...(extra as Record<string, unknown>) };
  if (kind === 'phenom') {
    try { if (phenomDialect(complete) === 'CAREER_CONNECT_WIDGETS') careerConnectOptions(complete); } catch (error) { return `réglages Phenom refusés par le lecteur : ${(error as Error).message}`; }
  }
  // Un lecteur dédié choisi dans la même famille (Marc O'Polo, D-485) : ses réglages passent par le parseur du lecteur.
  if ((kind === 'generic-listing' || kind === 'generic-jsonld') && complete.reader !== undefined) {
    if (complete.reader === MARC_O_POLO_READER) {
      try { marcOPoloSettings(complete); } catch (error) { return `réglages refusés par le lecteur Marc O'Polo : ${(error as Error).message}`; }
    } else if (complete.reader === WORDPRESS_POST_TYPE_READER) {
      // Un type de billet WordPress lu par l'API REST du site (Kastner & Öhler, D-522 §6).
      try { wordpressPostTypeSettings(complete); } catch (error) { return `réglages refusés par le lecteur WordPress : ${(error as Error).message}`; }
    } else return `lecteur « ${String(complete.reader)} » inconnu de ce script`;
  }
  return complete;
}

type Correction = { key: string; maison: string; avant: string; apres: string; portail: string; config: Record<string, unknown>; careersDomain: string; tenantKey: string; revisionId: string | null };
const corrections: Correction[] = [];
const refus: string[] = [];

const base = new Map((await prisma.$queryRawUnsafe<Array<{ key: string; kind: string; maison: string; config: unknown; tier: 'EMPLOYER_DIRECT' | 'GROUP_OFFICIAL' | 'ATS_OFFICIAL'; currentRevisionId: string | null }>>(
  `SELECT key, kind, maison, config, tier, "currentRevisionId" FROM "Source"`)).map((s) => [s.key, s]));

for (const r of csv) {
  const s = base.get(r.cle);
  const kind = r.ats === 'oracle_hcm' ? 'oraclehcm' : r.ats;
  /**
   * Même famille : la ligne n'est une correction que si elle porte des réglages relus (`config_relue`) — un lecteur
   * dédié choisi dans la famille (Marc O'Polo, D-485). Sans eux, comme avant, rien n'est touché ; avec eux, la ligne
   * n'est écrite que si la configuration obtenue diffère de celle en base (plus bas).
   */
  if (!s || !kind || (kind === s.kind && !r.config_relue)) continue;
  if (!r.portail_url) { refus.push(`${r.cle} : ATS relu « ${r.ats} » mais aucun portail_url`); continue; }
  const derivee = configPour(kind, r.portail_url);
  if (!derivee) { refus.push(`${r.cle} : famille « ${r.ats} » sans forme de configuration connue — à traiter à la main`); continue; }
  if (r.config_relue && Number(r.__cases) !== entetes.length) { refus.push(`${r.cle} : ${r.__cases} cases pour ${entetes.length} colonnes — un « ; » dans config_relue ?`); continue; }
  const config = completer(kind, derivee, r.config_relue ?? '');
  if (typeof config === 'string') { refus.push(`${r.cle} : ${config}`); continue; }
  try {
    const careersDomain = new URL(r.portail_url).hostname;
    const candidate = parseSourceCandidate({ key: s.key, maison: s.maison, kind, config, careersDomain, tier: s.tier });
    // Comparées à l'ordre des clés près : PostgreSQL range les clés d'un jsonb, une ligne déjà appliquée (PVH) doit
    // être reconnue comme telle et ne jamais créer de révision.
    if (kind === s.kind && evidenceHash(candidate.config) === evidenceHash(s.config)) continue;
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
