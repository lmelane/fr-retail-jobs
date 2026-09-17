/**
 * L'EXPORT DU REGISTRE DES SOURCES — ce qu'il faut pour savoir OÙ et COMMENT collecter.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/exporter-registre-sources.mts <fichier.json>
 *
 * LECTURE SEULE : aucune écriture, aucune transformation des valeurs exportées.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  POURQUOI CET EXPORT EXISTE, ET POURQUOI LE CSV NE SUFFIT PAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `npm run import-sources` réensemence la table depuis `data/seeds/sources.csv`. Ce chemin est le
 * chemin officiel, et il est INSUFFISANT pour une reconstruction : mesuré le 2026-09-17, le CSV
 * porte 83 lignes quand la base en porte 536, sans statut, sans `config`, sans révision.
 *
 * Le commentaire de `sourceStore.ts:9` le dit d'ailleurs sans détour : « the CSV is now only the
 * seed — every runtime consumer reads the table ». La table EST devenue la source de vérité, et
 * le CSV a divergé. Réimporter depuis le CSV après un DROP perdrait 453 sources et toutes leurs
 * configurations de collecte.
 *
 * D'où cet export : il prend le registre TEL QU'IL EST EN BASE, et lui seul.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QU'IL EMPORTE, ET CE QU'IL LAISSE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * EMPORTÉ — strictement ce qui permet de retrouver et d'utiliser une source :
 *   son identité (`key`, `maison`, `tenantKey`), son connecteur (`kind`), son domaine carrière,
 *   sa `config` de collecte, son motif d'URL d'offre, son statut, son palier, et la révision
 *   courante avec sa configuration native.
 *
 * LAISSÉ — tout ce qui décrit l'ANCIEN CORPUS, même quand la colonne vit sur `Source` :
 *   `lastRunAt`, `lastRunStatus`, `lastRunJobs`, `descriptionRate`, `dateRate`, `countryRate`,
 *   `urlRate`. Ce sont des mesures de la collecte passée, pas de la source. Les réimporter
 *   réinjecterait nos anciennes interprétations dans un corpus qu'on veut auditer à neuf — ce que
 *   le CEO a explicitement exclu.
 *
 * AUCUNE donnée d'offre, aucune correction, aucun géocodage, aucune classification n'entre ici.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA RÉCONCILIATION, ET LE FAIT QU'ELLE A ÉTABLI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Le CEO demande : VALIDÉES/ACTIVES + PENDING/EN ATTENTE = TOTAL EXPORTÉ.
 *
 * ⚠️ MESURÉ LE 2026-09-17 : la colonne `Source.status` ne porte que TROIS valeurs — `ACTIVE`,
 * `RETIRED`, `PAUSED`. Il n'existe AUCUN statut `PENDING` ni `WAITING_VALIDATION` dans le schéma,
 * ni aucune table de sources candidates. La catégorie « en attente de validation » n'existe pas
 * dans ce système aujourd'hui.
 *
 * Cet export ne l'invente donc pas. Il rend les trois populations réelles, et dit explicitement
 * que la troisième colonne attendue est vide. Fabriquer un `PENDING` en rebaptisant `PAUSED` ou
 * `RETIRED` produirait un chiffre qui a l'air de répondre à la question, et qui décrit autre chose.
 *
 * `PAUSED` et `RETIRED` sont exportées quand même : ce sont des sources connues, et les perdre
 * effacerait le travail de découverte qui a mené à les écarter. Elles ne seront pas collectées —
 * `loadActiveSources` filtre sur `status='ACTIVE'`, et cet export ne change pas cette règle.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage : exporter-registre-sources.mts <fichier.json>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Les statuts qui autorisent la collecte — repris de `loadActiveSources`, jamais élargis ici. */
const COLLECTABLES = new Set(['ACTIVE']);

function revision(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'INDISPONIBLE';
  }
}

async function main(): Promise<number> {
  const [base] = await prisma.$queryRawUnsafe<Array<{ b: string }>>('SELECT current_database() AS b');

  /*
   * `config::text` et `nativeConfig::text` : le pilote convertit les nombres JSON de façon
   * destructive (un identifiant long devient un flottant arrondi). Passer par le texte et
   * reparser côté client conserve la valeur exacte — même précaution que `loadActiveSources`.
   */
  const sources = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT s.key, s.maison, s."tenantKey", s.kind, s."careersDomain", s."jobUrlPattern",
           s.status, s.tier, s.note, s."createdAt",
           s.config::text AS "configTexte",
           r.id AS "revisionId", r.version AS "revisionVersion", r."payloadHash" AS "revisionHash",
           r.payload::text AS "revisionConfigTexte"
      FROM "Source" s
      LEFT JOIN "SourceRevision" r ON r.id = s."currentRevisionId"
     ORDER BY s.key
  `);

  const lignes: Array<Record<string, unknown>> = sources.map((s) => {
    const { configTexte, revisionConfigTexte, ...reste } = s;
    return {
      ...reste,
      config: configTexte ? JSON.parse(configTexte as string) : null,
      revisionConfig: revisionConfigTexte ? JSON.parse(revisionConfigTexte as string) : null,
    };
  });

  const parStatut = new Map<string, number>();
  for (const l of lignes) parStatut.set(String(l.status), (parStatut.get(String(l.status)) ?? 0) + 1);

  const collectables = lignes.filter((l) => COLLECTABLES.has(String(l.status))).length;
  const enAttente = lignes.filter((l) => /PENDING|WAITING/i.test(String(l.status))).length;
  const autres = lignes.length - collectables - enAttente;

  const registre = {
    export: {
      horodatageUtc: new Date().toISOString(),
      base: base.b,
      revisionCode: revision(),
      contenu: 'registre des sources uniquement — aucune donnée d’offre, correction, géocodage ni classification',
      champsExclus: ['lastRunAt', 'lastRunStatus', 'lastRunJobs', 'descriptionRate', 'dateRate', 'countryRate', 'urlRate'],
      raisonExclusion: 'mesures de la collecte passée : elles décrivent l’ancien corpus, pas la source',
    },
    reconciliation: {
      collectables,
      enAttenteDeValidation: enAttente,
      autresConnues: autres,
      total: lignes.length,
      reconcilie: collectables + enAttente + autres === lignes.length,
      parStatut: Object.fromEntries(parStatut),
      note:
        enAttente === 0
          ? "AUCUN statut PENDING/WAITING n'existe dans ce schéma : la colonne `status` ne porte que ACTIVE, RETIRED et PAUSED. La catégorie « en attente de validation » n'est pas implémentée aujourd'hui — elle n'est pas inventée ici."
          : 'des sources en attente de validation existent et sont exportées sans être rendues collectables',
    },
    sources: lignes,
  };

  const chemin = resolve(destination);
  mkdirSync(dirname(chemin), { recursive: true });
  const contenu = JSON.stringify(registre, null, 2);
  writeFileSync(chemin, contenu, { encoding: 'utf8', mode: 0o600 });
  const empreinte = createHash('sha256').update(contenu).digest('hex');
  writeFileSync(`${chemin}.sha256`, `${empreinte}  ${chemin}\n`, { encoding: 'utf8', mode: 0o600 });

  console.log(`\nREGISTRE DES SOURCES EXPORTÉ — base ${base.b}`);
  console.log(`\n   COLLECTABLES (status ACTIVE)      ${String(collectables).padStart(5)}`);
  console.log(`   EN ATTENTE DE VALIDATION          ${String(enAttente).padStart(5)}`);
  console.log(`   AUTRES CONNUES (RETIRED, PAUSED)  ${String(autres).padStart(5)}`);
  console.log(`   ${''.padEnd(33)} ${String(lignes.length).padStart(5)}   TOTAL EXPORTÉ`);
  console.log(`\n   réconciliation : ${registre.reconciliation.reconcilie ? 'OK' : 'ÉCHEC'}`);
  console.log(`   par statut     : ${[...parStatut].map(([s, n]) => `${s}=${n}`).join(' · ')}`);
  if (enAttente === 0) console.log(`\n   ⚠ ${registre.reconciliation.note}`);
  console.log(`\n   fichier   : ${chemin}`);
  console.log(`   empreinte : ${empreinte}`);
  console.log(`\nLECTURE SEULE — aucune donnée modifiée. Aucune donnée d’offre exportée.`);

  return registre.reconciliation.reconcilie && lignes.length > 0 ? 0 : 1;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
