/**
 * LE RESET TOTAL — détruire le schéma, le reconstruire depuis les migrations.
 *
 *   # inspection, n'écrit RIEN :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/reset-schema.mts
 *
 *   # exécution réelle :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/reset-schema.mts --ecrire OUI-JE-DETRUIS-LE-SCHEMA
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  POURQUOI UN DROP PLUTÔT QU'UNE PURGE — ET C'EST MESURÉ, PAS PRÉFÉRÉ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `reset-catalogue.mts` supprime le corpus en gardant le socle. Il a été tenté le 2026-09-17 et a
 * ÉCHOUÉ, proprement : quatre tables refusent tout DELETE par un trigger d'immuabilité —
 * `OccupationObservation` (197 794 lignes), `EmployerObservation` (75 051), `DataCorrection`
 * (20 652) et `PostingScopeDecision` (224). Message du serveur : « Occupation releases and
 * observations are immutable; publish a new reviewed release ».
 *
 * Ces triggers sont des GARANTIES D'ATTESTATION posées délibérément : les preuves de
 * classification ne doivent pas pouvoir disparaître. Le CEO a explicitement interdit de les
 * désactiver pour faciliter le reset — et il a raison : un `DISABLE TRIGGER` qui échoue entre
 * deux étapes les laisse désactivés, et plus personne ne le sait.
 *
 * Le DROP les respecte au lieu de les contourner : il supprime le schéma ENTIER, triggers
 * compris, puis `prisma migrate deploy` les RECRÉE tels que les migrations les définissent. Aucun
 * garde-fou n'est levé ; ils sont reconstruits à neuf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QUE CE SCRIPT NE FAIT PAS, ET QUI DOIT ÊTRE FAIT AUTOUR DE LUI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Il ne sauvegarde RIEN. Le registre des sources doit être exporté AVANT, par
 * `exporter-registre-sources.mts`, et réimporté APRÈS par `reimporter-registre-sources.mts`. Ce
 * script REFUSE de s'exécuter si l'export n'existe pas et ne porte pas au moins une source
 * collectable — sans lui, la base reconstruite n'aurait plus rien à collecter, et
 * `loadActiveSources` lèverait « Source table is empty » sans qu'on sache pourquoi.
 *
 * Il n'applique pas les migrations lui-même : `prisma migrate deploy` est une commande à part,
 * lancée ensuite, et son succès se vérifie par `migrate status`. Les enchaîner ici masquerait
 * lequel des deux a échoué.
 *
 * AUCUNE migration n'est marquée artificiellement comme exécutée : la table `_prisma_migrations`
 * disparaît avec le schéma et se reconstruit par l'application réelle des 81 migrations.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA GARDE D'IDENTITÉ, ET L'INCIDENT QUI L'A FAIT ÉCRIRE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Le 23/08/2026, une commande a reçu l'URL de la mauvaise base et a vidé la production : 2 175
 * comptes, 35 680 CV, 183 candidatures à zéro. Avant toute écriture, ce script vérifie donc que la
 * base porte la signature de l'agrégateur — ses tables de catalogue présentes, ET aucune table du
 * backend candidat (`User`, `Candidate`, `Application`). Un seul de ces noms présent : refus.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MOT_DE_PASSE = 'OUI-JE-DETRUIS-LE-SCHEMA';
const ECRIRE = process.argv.includes('--ecrire') && process.argv.includes(MOT_DE_PASSE);

/** L'export du registre, exigé avant toute destruction. */
const REGISTRE = process.env.REGISTRE_SOURCES
  ?? resolve(process.env.HOME ?? '.', 'catwalks-sauvegardes/registre-sources-20260917.json');

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main(): Promise<number> {
  /*
   * GARDE 1 — LE REGISTRE EXISTE ET EST EXPLOITABLE.
   *
   * Vérifié AVANT la garde d'identité : détruire un schéma sans pouvoir reconstruire ce qui permet
   * de collecter serait la pire des deux erreurs, et c'est celle qu'aucun rollback ne répare
   * élégamment.
   */
  if (!existsSync(REGISTRE)) {
    console.error(`REFUS : registre introuvable — ${REGISTRE}`);
    console.error(`Exporter d'abord : npx tsx scripts/ops/exporter-registre-sources.mts <fichier.json>`);
    return 2;
  }
  const registre = JSON.parse(readFileSync(REGISTRE, 'utf8')) as {
    sources?: Array<{ status: string; config: unknown }>;
  };
  const sources = registre.sources ?? [];
  const collectables = sources.filter((s) => s.status === 'ACTIVE');
  const sansConfig = collectables.filter((s) => !s.config).length;
  if (!collectables.length || sansConfig) {
    console.error(`REFUS : le registre porte ${collectables.length} sources ACTIVE dont ${sansConfig} sans config.`);
    return 2;
  }

  /* GARDE 2 — LA BASE EST BIEN CELLE DE L'AGRÉGATEUR. Voir l'incident du 23/08 en tête de fichier. */
  const [ident] = await prisma.$queryRawUnsafe<Array<{ base: string }>>('SELECT current_database() AS base');
  const tables = await prisma.$queryRawUnsafe<Array<{ n: string }>>(
    `SELECT table_name AS n FROM information_schema.tables WHERE table_schema='public'`,
  );
  const noms = new Set(tables.map((t) => t.n));
  const signature = ['Job', 'JobSource', 'Source', 'Company'].every((t) => noms.has(t));
  const etranger = ['User', 'Candidate', 'Application'].filter((t) => noms.has(t));

  console.log(`\nRESET TOTAL DU SCHÉMA`);
  console.log(`   base    : ${ident.base} · ${noms.size} tables`);
  console.log(`   registre: ${REGISTRE}`);
  console.log(`             ${sources.length} sources dont ${collectables.length} ACTIVE, toutes avec config`);

  if (!signature || etranger.length) {
    console.error(
      `\nREFUS : cette base ne porte pas la signature de l'agrégateur.` +
        (etranger.length ? ` Tables étrangères : ${etranger.join(', ')}.` : ''),
    );
    return 2;
  }
  console.log(`   signature agrégateur vérifiée (aucune table candidat).`);

  const [volumes] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
    SELECT (SELECT count(*) FROM "Job")::int AS offres,
           (SELECT count(*) FROM "JobSource")::int AS publications,
           (SELECT count(*) FROM "SourceObservation")::int AS observations`);
  console.log(`\n   À DÉTRUIRE : ${noms.size} tables · ${volumes.offres} offres · ${volumes.publications} publications · ${volumes.observations} observations`);
  console.log(`   Les triggers d'immuabilité partent AVEC le schéma et sont RECRÉÉS par les migrations.`);

  if (!ECRIRE) {
    console.log(`\nINSPECTION SEULEMENT — rien n'a été détruit.`);
    console.log(`Pour exécuter : --ecrire ${MOT_DE_PASSE}`);
    return 0;
  }

  /*
   * `DROP SCHEMA public CASCADE` puis recréation immédiate.
   *
   * CASCADE est ici la bonne réponse et non un raccourci : il emporte tables, contraintes,
   * fonctions, triggers et types dans le bon ordre, sans qu'on ait à le reconstituer à la main —
   * et un ordre reconstitué à la main est un ordre qui se trompe.
   *
   * Les deux instructions sont envoyées séparément : une base sans schéma `public` refuserait
   * toute connexion suivante, et un échec entre les deux doit être visible immédiatement.
   */
  console.log(`\nDESTRUCTION...`);
  await prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE');
  console.log(`   schéma public détruit`);
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  console.log(`   schéma public recréé, vide`);

  const restantes = await prisma.$queryRawUnsafe<Array<{ n: string }>>(
    `SELECT table_name AS n FROM information_schema.tables WHERE table_schema='public'`,
  );
  console.log(`\n   tables restantes : ${restantes.length}`);

  if (restantes.length !== 0) {
    console.error(`⚠ Le schéma n'est pas vide — ne pas continuer sans vérification.`);
    return 1;
  }

  console.log(`\n✔ SCHÉMA DÉTRUIT ET VIDE. Les deux commandes suivantes, dans cet ordre :`);
  console.log(`\n   1. npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`);
  console.log(`      (recrée les 81 migrations, leurs contraintes et leurs 57 triggers)`);
  console.log(`\n   2. npx tsx apps/aggregator/scripts/ops/reimporter-registre-sources.mts \\`);
  console.log(`        ${REGISTRE} --ecrire`);
  console.log(`      (restaure les ${sources.length} sources avec leur config et leur statut)`);
  return 0;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
