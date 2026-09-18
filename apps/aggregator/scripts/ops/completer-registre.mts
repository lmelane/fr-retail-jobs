/**
 * COMPLÉTER LES CASES VIDES DU REGISTRE — sans rien inventer.
 *
 *   # inspection, n'écrit RIEN :
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/completer-registre.mts
 *
 *   # exécution :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/completer-registre.mts --ecrire
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LE PROBLÈME, ET POURQUOI IL N'EST PAS UN DÉFAUT DES SOURCES
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La campagne de qualification refuse une source dont la fiche est incomplète. Mesuré le
 * 2026-09-18, sur les 437 sources ACTIVE :
 *
 *   · 22 sans `careersDomain` → verdict HORS_PARCOURS
 *   · ~84 sans domaine officiel de Maison → verdict DOMAINE_OFFICIEL_MANQUANT
 *
 * Ces sources FONCTIONNENT : AMIRI sert ses offres sur `jobs.lever.co/AMIRI`, vérifié à la main.
 * C'est notre fiche qui est vide, pas le portail. Le message d'erreur de la campagne affiche
 * d'ailleurs l'URL qu'elle vient de construire — l'information est sous nos yeux au moment où
 * elle refuse.
 *
 * Ces trous PRÉEXISTENT au reset du 17/09 : l'export du registre les a restaurés fidèlement, avec
 * leurs cases vides. Ce qui a changé, c'est que le contrôle d'identité tourne pour la première
 * fois — il est branché depuis le 16/09 et le pipeline était en pause depuis.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA RÈGLE : CHAQUE VALEUR VIENT D'UNE DONNÉE DÉJÀ EN BASE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `careersDomain` ← l'hôte de l'URL que `configuredPortal(kind, config)` construit. C'est LA
 *   fonction de référence, celle que la campagne elle-même appelle pour connaître le portail
 *   (`sourcePortal.ts`). On ne réécrit pas ses règles par famille : on lit son résultat. Une
 *   source dont elle ne sait rien tirer reste vide — et le dira.
 *
 * `Company.domain` ← rien n'est écrit ici. Le domaine officiel EXISTE déjà sur la Maison (826 sur
 *   1 622 en portent un) ; ce qui manque est le LIEN entre la source et sa Maison, que la requête
 *   des candidats cherche via `JobSource` — vide depuis le reset. Ce script ne touche donc pas
 *   `Company` : il rend le rapprochement par NOM mesurable, et c'est `source-campaign-candidates.sql`
 *   qui doit apprendre à l'utiliser.
 *
 * AUCUNE valeur n'est devinée : pas de « probablement `<marque>.com` », pas de recherche web, pas
 * de dérivation depuis le nom de la Maison. Une case qu'on ne peut pas remplir depuis la base
 * reste vide, et le rapport la nomme.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QU'IL NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Il ne promeut aucune source, ne crée aucune décision d'accès ni revue d'identité, ne désactive
 * aucun garde-fou. Remplir `careersDomain` ne qualifie rien : ça permet seulement à la campagne
 * d'INSTRUIRE la source au lieu de la refuser sur une case vide. Le robots.txt sera lu, l'identité
 * sera vérifiée, et le verdict restera ce que les preuves disent.
 */
import { PrismaClient } from '@prisma/client';
import { configuredPortal } from '../../src/connectors/sourcePortal.js';
import { effectiveSourceConfig } from '../../src/connectors/sourceConfig.js';

const ECRIRE = process.argv.includes('--ecrire');

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Ligne = { key: string; maison: string; kind: string; config: unknown; careersDomain: string | null };

async function main(): Promise<number> {
  const sources = await prisma.$queryRawUnsafe<Ligne[]>(`
    SELECT key, maison, kind, config, "careersDomain"
      FROM "Source" WHERE status = 'ACTIVE' AND "careersDomain" IS NULL ORDER BY key`);

  console.log(`\nCOMPLÉTER LE REGISTRE — ${sources.length} source(s) ACTIVE sans careersDomain\n`);

  const aEcrire: Array<{ key: string; maison: string; kind: string; domaine: string }> = [];
  const sansPortail: Ligne[] = [];

  for (const s of sources) {
    /*
     * `effectiveSourceConfig` applique les mêmes normalisations que la collecte : sans elle, on
     * lirait une config brute que l'adaptateur ne verrait jamais sous cette forme.
     */
    const config = effectiveSourceConfig(s.config);
    const portail = configuredPortal(s.kind, config);
    if (!portail) { sansPortail.push(s); continue; }
    /*
     * `PortalContract.url` est une CHAÎNE, pas une URL : on la parse pour n'écrire que l'HÔTE.
     * `careersDomain` porte un domaine, jamais une URL complète — y mettre le chemin ferait
     * échouer les comparaisons d'hôte de la campagne, silencieusement.
     */
    aEcrire.push({ key: s.key, maison: s.maison, kind: s.kind, domaine: new URL(portail.url).host });
  }

  for (const e of aEcrire) {
    console.log(`   ${e.key.padEnd(22)} ${e.kind.padEnd(14)} → ${e.domaine}`);
  }
  if (sansPortail.length) {
    console.log(`\n   NON DÉDUCTIBLES (la fonction de portail ne rend rien — la case reste vide) :`);
    for (const s of sansPortail) console.log(`   ${s.key.padEnd(22)} ${s.kind}`);
  }

  /*
   * LE RAPPROCHEMENT PAR NOM, MESURÉ ET NON APPLIQUÉ.
   *
   * Le domaine officiel vit déjà sur `Company`. Ce qui manque est le lien source ↔ Maison, que la
   * requête des candidats cherche via `JobSource` — vide depuis le reset. On MESURE ici ce qu'un
   * rapprochement par nom rendrait, sans rien écrire : corriger la requête est un geste distinct,
   * qui appartient à `source-campaign-candidates.sql`.
   */
  const [rappro] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
    SELECT count(*)::int AS actives,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "Company" c WHERE c.name = s.maison AND c.domain IS NOT NULL))::int AS avec_domaine
      FROM "Source" s WHERE s.status = 'ACTIVE'`);

  console.log(`\n   DOMAINE OFFICIEL — rapprochement par nom de Maison (mesure, aucune écriture) :`);
  console.log(`   ${rappro.avec_domaine} sources sur ${rappro.actives} retrouvent un domaine officiel.`);
  console.log(`   La requête des candidats le cherche via JobSource (vide) : elle doit passer par le nom.`);

  if (!ECRIRE) {
    console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour appliquer.`);
    return 0;
  }

  /*
   * Une transaction, et `careersDomain IS NULL` répété dans le WHERE : si une autre exécution a
   * rempli la case entre-temps, on ne l'écrase pas. Une valeur posée par un humain vaut mieux que
   * la nôtre, dérivée.
   */
  let ecrites = 0;
  await prisma.$transaction(async (tx) => {
    for (const e of aEcrire) {
      const n = await tx.$executeRawUnsafe(
        `UPDATE "Source" SET "careersDomain" = $1 WHERE key = $2 AND "careersDomain" IS NULL`,
        e.domaine, e.key);
      ecrites += n;
    }
  }, { maxWait: 30_000, timeout: 300_000 });

  const [apres] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "Source" WHERE status='ACTIVE' AND "careersDomain" IS NULL`);

  console.log(`\n   ${ecrites} careersDomain écrits · ${apres.n} source(s) ACTIVE encore sans domaine`);
  console.log(`\n✔ Aucune promotion, aucune décision d'accès, aucune revue d'identité créée.`);
  console.log(`   Les sources complétées seront INSTRUITES par la campagne, pas qualifiées d'office.`);
  return 0;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
