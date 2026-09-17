/**
 * LE RÉIMPORT DU REGISTRE DES SOURCES — reconstruire « où et comment collecter », après un reset.
 *
 *   # inspection, n'écrit RIEN :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/reimporter-registre-sources.mts <registre.json>
 *
 *   # exécution réelle :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/reimporter-registre-sources.mts <registre.json> --ecrire
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  POURQUOI CE SCRIPT EXISTE, ET POURQUOI `import-sources` NE SUFFIT PAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `npm run import-sources` réensemence depuis `data/seeds/sources.csv`. Mesuré le 2026-09-17 : ce
 * CSV porte 83 lignes quand la base en porte 536, sans statut, sans `config`, sans révision. Le
 * commentaire de `sourceStore.ts:9` l'assume — « the CSV is now only the seed ». La table EST
 * devenue la source de vérité.
 *
 * Réimporter depuis le CSV après un DROP perdrait donc 453 sources et toutes leurs configurations
 * de collecte. Ce script réimporte depuis l'export JSON du registre réel.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CE QU'IL RESTAURE, ET CE QU'IL NE RESTAURE PAS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * RESTAURÉ : identité (`key`, `maison`, `tenantKey`), connecteur (`kind`), domaine carrière,
 * `config` de collecte, motif d'URL, `status`, `tier`, `note`, et la révision courante avec son
 * `payload` et son `payloadHash`.
 *
 * PAS RESTAURÉ : `lastRunAt`, `lastRunStatus`, `lastRunJobs`, `descriptionRate`, `dateRate`,
 * `countryRate`, `urlRate`. Ce sont des mesures de la collecte PASSÉE. Les réinjecter ferait
 * croire à une reprise d'état et fausserait l'ordre de passage (`allSourceKeys` trie sur
 * `lastRunJobs`) — la nouvelle collecte doit repartir sans mémoire de l'ancienne.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LES STATUTS, ET CE QUE LA MESURE A ÉTABLI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * L'enum `SourceStatus` porte CINQ valeurs : DRAFT, VALIDATED, ACTIVE, PAUSED, RETIRED. Le cycle
 * de vie « en attente de validation » est donc prévu par le schéma — mais mesuré le 2026-09-17,
 * AUCUNE source n'est en DRAFT ni VALIDATED : 437 ACTIVE, 92 RETIRED, 7 PAUSED.
 *
 * Ce script restaure les statuts TELS QUELS. Il ne promeut ni ne rétrograde aucune source : une
 * RETIRED revient RETIRED. Seules les ACTIVE seront collectées, parce que `loadActiveSources`
 * filtre sur `status='ACTIVE'` — et ce filtre n'est pas contourné ici.
 *
 * Les 99 sources RETIRED et PAUSED sont restaurées parce qu'elles portent le travail de
 * découverte qui a mené à les écarter. Les perdre reviendrait à redécouvrir puis réécarter les
 * mêmes sources.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : reimporter-registre-sources.mts <registre.json> [--ecrire]');
  process.exit(2);
}
const ECRIRE = process.argv.includes('--ecrire');

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

type LigneSource = {
  key: string; maison: string; tenantKey: string | null; kind: string;
  careersDomain: string | null; jobUrlPattern: string | null; status: string; tier: string;
  note: string | null; config: unknown;
  revisionId: string | null; revisionVersion: number | null; revisionHash: string | null;
  revisionConfig: unknown;
};

async function main(): Promise<number> {
  const chemin = resolve(fichier);
  const brut = readFileSync(chemin, 'utf8');
  const empreinte = createHash('sha256').update(brut).digest('hex');
  const registre = JSON.parse(brut) as { sources: LigneSource[]; reconciliation?: { total?: number } };
  const sources = registre.sources ?? [];

  /*
   * PRÉMISSE — un export vide ou tronqué réimporterait « avec succès » un registre inutilisable,
   * et la collecte suivante échouerait sur « Source table is empty » sans qu'on sache pourquoi.
   */
  if (!sources.length) {
    console.error('REFUS : le registre est vide.');
    return 2;
  }
  if (registre.reconciliation?.total !== undefined && registre.reconciliation.total !== sources.length) {
    console.error(`REFUS : le fichier annonce ${registre.reconciliation.total} sources et en porte ${sources.length}.`);
    return 2;
  }
  const sansConfig = sources.filter((s) => s.status === 'ACTIVE' && !s.config);
  if (sansConfig.length) {
    console.error(`REFUS : ${sansConfig.length} sources ACTIVE sans config — elles seraient incollectables.`);
    return 2;
  }
  /*
   * `tenantKey` est NOT NULL en base, et c'est la clé qui empêche qu'un même locataire soit
   * catalogué deux fois sous deux noms (la dette des 17 doublons que cette contrainte a attrapée).
   * Mesuré sur l'export du 17/09 : les 536 en portent une. On le vérifie quand même plutôt que de
   * l'affirmer par une assertion de type — un `null` ici ferait échouer l'insertion à mi-parcours.
   */
  const sansLocataire = sources.filter((s) => !s.tenantKey);
  if (sansLocataire.length) {
    console.error(`REFUS : ${sansLocataire.length} sources sans tenantKey (colonne NOT NULL) : ${sansLocataire.slice(0, 5).map((s) => s.key).join(', ')}`);
    return 2;
  }

  const [base] = await prisma.$queryRawUnsafe<Array<{ b: string }>>('SELECT current_database() AS b');
  const [avant] = await prisma.$queryRawUnsafe<Array<{ n: number }>>('SELECT count(*)::int AS n FROM "Source"');

  const parStatut = new Map<string, number>();
  for (const s of sources) parStatut.set(s.status, (parStatut.get(s.status) ?? 0) + 1);

  console.log(`\nRÉIMPORT DU REGISTRE — base ${base.b}`);
  console.log(`   fichier   : ${chemin}`);
  console.log(`   empreinte : ${empreinte}`);
  console.log(`   sources   : ${sources.length}  (${[...parStatut].map(([s, n]) => `${s}=${n}`).join(' · ')})`);
  console.log(`   en base actuellement : ${avant.n}`);

  if (!ECRIRE) {
    console.log(`\nINSPECTION SEULEMENT — rien n'a été écrit. Ajouter --ecrire pour exécuter.`);
    return 0;
  }

  /*
   * UNE SEULE TRANSACTION, et l'ordre compte : `Source.currentRevisionId` référence
   * `SourceRevision`, qui référence `Source.id`. On crée donc la source SANS révision, puis la
   * révision, puis on rattache. Un réimport à moitié fait laisserait des sources sans
   * configuration de collecte — incollectables et silencieuses.
   */
  console.log(`\nÉCRITURE...`);
  let creees = 0;
  let revisions = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const s of sources) {
        const cree = await tx.source.create({
          data: {
            key: s.key, maison: s.maison, tenantKey: s.tenantKey!, kind: s.kind,
            careersDomain: s.careersDomain, jobUrlPattern: s.jobUrlPattern,
            status: s.status as never, tier: s.tier as never, note: s.note,
            config: s.config as never,
          },
          select: { id: true },
        });
        creees += 1;

        if (s.revisionId && s.revisionConfig) {
          const rev = await tx.sourceRevision.create({
            data: {
              id: s.revisionId, sourceId: cree.id, sourceKey: s.key,
              version: s.revisionVersion ?? 1,
              payload: s.revisionConfig as never,
              payloadHash: s.revisionHash ?? '',
            },
            select: { id: true },
          });
          await tx.source.update({ where: { id: cree.id }, data: { currentRevisionId: rev.id } });
          revisions += 1;
        }
      }
    },
    { maxWait: 60_000, timeout: 900_000 },
  );

  /*
   * VÉRIFICATION APRÈS COUP — sur la population qui compte pour la collecte.
   *
   * Un réimport qui rendrait 536 sources dont 400 sans révision passerait un contrôle de total et
   * échouerait à la collecte. On vérifie donc les ACTIVE, une par une.
   */
  const [apres] = await prisma.$queryRawUnsafe<Array<{ n: number }>>('SELECT count(*)::int AS n FROM "Source"');
  const [actives] = await prisma.$queryRawUnsafe<Array<{ n: number; rev: number; cfg: number }>>(`
    SELECT count(*)::int AS n,
           count("currentRevisionId")::int AS rev,
           count(*) FILTER (WHERE config IS NOT NULL)::int AS cfg
      FROM "Source" WHERE status='ACTIVE'`);

  console.log(`\n   sources créées    : ${creees}`);
  console.log(`   révisions créées  : ${revisions}`);
  console.log(`   total en base     : ${apres.n}`);
  console.log(`\n   ACTIVE : ${actives.n} · avec révision : ${actives.rev} · avec config : ${actives.cfg}`);

  const ok = apres.n === sources.length && actives.rev === actives.n && actives.cfg === actives.n;
  console.log(ok
    ? `\n✔ REGISTRE RESTAURÉ — toutes les sources ACTIVE portent leur config et leur révision.`
    : `\n⚠ ÉTAT INCOMPLET — ne pas lancer de collecte avant vérification.`);
  return ok ? 0 : 1;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
