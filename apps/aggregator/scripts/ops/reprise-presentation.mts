/**
 * REPRISE DE LA PROJECTION `JobSource.presentation` — la colonne créée vide par la migration
 * `20260915230000_publication_presentation`.
 *
 * ── LE DÉFAUT QUE CE SCRIPT RÉPARE ────────────────────────────────────────────────────────
 *
 * Mesuré le 2026-09-17, après l'application des 37 migrations en attente : **85 327 représentations
 * actives sur 85 327** n'ont aucune présentation. La migration a ajouté la colonne ; aucune reprise
 * de données ne l'a remplie. Le catalogue est donc INTÉGRALEMENT invisible côté API : `toRow`
 * (`apps/api/lib/jobs.ts`) refuse de servir une offre dont il ne peut pas construire la présentation
 * et lève `PUBLICATION_PRESENTATION_REBUILD_REQUIRED`, que la route traduit en 503. Le visiteur lit
 * « La recherche est momentanément indisponible ».
 *
 * Ce refus est le bon comportement : servir une offre à demi projetée vaudrait moins que rien.
 * Le défaut est l'absence de reprise, pas le garde-fou.
 *
 * ── POURQUOI LA RECONSTRUCTION EST LÉGITIME, ET NON UNE INVENTION ─────────────────────────
 *
 * La présentation est explicitement « a replaceable projection of one observation, never a source
 * of publisher truth » (`packages/db/publication-presentation.ts`). Chacun de ses 42 champs EXISTE
 * déjà sur la ligne `Job` correspondante : on recopie, on ne déduit rien. Aucune valeur n'est
 * inventée, aucune n'est corrigée en passant — une reprise qui « améliore » les données au vol
 * serait une modification silencieuse du catalogue.
 *
 * ── L'EMPREINTE D'ENTRÉE, LE SEUL POINT SUBTIL ────────────────────────────────────────────
 *
 * `publicationContentOf` exige un `inputHash` de 64 caractères hexadécimaux. Quand la
 * représentation porte des `sourceFacts`, le cache doit reprendre LEUR empreinte, à l'identique :
 * c'est le lien qui prouve que la projection décrit bien cette observation-là.
 *
 * Mesuré sur ce stock : `sourceFacts` est nul sur les 85 327 lignes. La comparaison est alors sautée
 * par le contrat (`publication-presentation.ts:39`), mais le format reste obligatoire. L'empreinte est
 * donc calculée sur l'identifiant de la ligne et ses `values` — et sur rien d'autre : elle ne couvre
 * ni `sourceKey`, ni `url`, ni les identifiants de capture, que le contrat compare déjà un par un.
 * Ce n'est pas une preuve de complétude de la projection, seulement une valeur stable et
 * recalculable à l'identique par un rejeu. Ne pas la citer pour autre chose.
 *
 * ── CE QUE CE SCRIPT NE FAIT PAS ──────────────────────────────────────────────────────────
 *
 * Il n'écrit QUE la colonne `presentation`, et seulement là où elle est nulle. Il ne touche à aucun
 * autre champ, ne crée ni ne supprime aucune ligne, ne ferme ni ne rouvre aucune offre, ne modifie
 * aucune source, aucune décision, aucune preuve. Une ligne déjà projetée est laissée intacte : le
 * script est rejouable sans effet de bord.
 *
 * Il ne touche pas non plus à `readerVersion`, au sens où il n'en dérive aucune décision : la
 * révision du lecteur y est inscrite comme provenance de la projection, jamais comme attestation.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────
 *
 *   Compter, sans rien écrire (par défaut) :
 *     python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/scripts/ops/reprise-presentation.mts
 *
 *   Écrire réellement :
 *     python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/reprise-presentation.mts --ecrire
 *
 *   `--lot=<n>` borne la taille des transactions (défaut 500).
 */
import { createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PRESENTATION_FIELDS, PRESENTATION_VERSION, publicationContentOf } from '@catwalks/db/publication-presentation';
import { captureReaderRevision } from '../../src/capture/revision.js';

const ECRIRE = process.argv.includes('--ecrire');
const LOT = Number(process.argv.find(a => a.startsWith('--lot='))?.slice(6) ?? 500);

/**
 * LA VRAIE RÉVISION DU LECTEUR, pas une chaîne fabriquée.
 *
 * Une première version inscrivait ici `reprise-presentation-<date>`, au motif que le contrat
 * n'exige qu'une chaîne non vide (`publication-presentation.ts:36`) et que personne ne compare
 * ce champ aujourd'hui. Les deux constats sont exacts — et insuffisants.
 *
 * CINQ champs de la même forme SONT comparés à `captureReaderRevision()` pour détecter une
 * péremption : `sourceAccess.ts:24`, `sourceCertification.ts:20`, `sourceAccessEvidence.ts:34`,
 * `sourceExpiry.ts:312`, `facts/repair.ts:51`. Que la présentation échappe à ce contrôle est une
 * propriété du code d'aujourd'hui, pas une garantie du schéma. Le jour où un contrôle de fraîcheur
 * est ajouté — le geste naturel, vu ses cinq frères — 85 327 lignes porteraient une révision qui
 * n'a jamais existé et qu'aucun rejeu ne peut reproduire.
 *
 * On inscrit donc la révision réelle, et la trace de la reprise va dans un champ SÉPARÉ.
 */
const REVISION = captureReaderRevision();
/** Provenance de la ligne : reconstruite par cette reprise, et non écrite par l'ingestion normale. */
const REPRISE = `reprise-presentation-${new Date().toISOString().slice(0, 10)}`;

const db = new PrismaClient();

/** Une valeur de base rendue dans la forme que `publicationContentOf` relira. */
function projeter(valeur: unknown): unknown {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return valeur.toISOString();
  if (valeur instanceof Prisma.Decimal) return valeur.toString();
  return valeur;
}

async function main() {
  const restant = await db.jobSource.count({ where: { isActive: true, presentation: { equals: Prisma.DbNull } } });
  console.log(JSON.stringify({ mode: ECRIRE ? 'ECRITURE' : 'COMPTAGE', aReprendre: restant, lot: LOT }));
  if (restant === 0) { console.log('Rien à reprendre.'); return; }

  let vues = 0, ecrites = 0, refusees = 0;
  const echecs: Array<{ id: string; raison: string }> = [];

  for (;;) {
    const lignes = await db.jobSource.findMany({
      where: { isActive: true, presentation: { equals: Prisma.DbNull } },
      select: {
        id: true, sourceKey: true, externalId: true, url: true, sourceTier: true,
        captureBatchId: true, captureOutputId: true, sourceFacts: true,
        job: { select: Object.fromEntries(PRESENTATION_FIELDS.map(f => [f, true])) as never },
      },
      orderBy: { id: 'asc' },
      take: LOT,
    });
    if (lignes.length === 0) break;

    for (const ligne of lignes) {
      vues += 1;
      const job = ligne.job as Record<string, unknown> | null;
      if (!job) { refusees += 1; echecs.push({ id: ligne.id, raison: 'AUCUNE_OFFRE_LIEE' }); continue; }

      const values: Record<string, unknown> = {};
      for (const champ of PRESENTATION_FIELDS) values[champ] = projeter(job[champ]);

      /*
       * Trois champs décrivent la REPRÉSENTATION, pas l'offre : le contrat les compare à la ligne
       * `JobSource` elle-même (`publicationContentOf`, dernières vérifications). Les recopier depuis
       * `Job` ferait échouer une représentation secondaire, dont l'URL diffère de l'URL canonique.
       */
      values.externalId = ligne.externalId;
      values.canonicalExternalId = ligne.externalId;
      values.canonicalSourceKey = ligne.sourceKey;
      values.url = ligne.url;

      const facts = ligne.sourceFacts as Record<string, unknown> | null;
      const empreinteAmont = typeof facts?.inputHash === 'string' ? facts.inputHash : null;
      const inputHash = empreinteAmont
        ?? createHash('sha256').update(JSON.stringify({ id: ligne.id, values })).digest('hex');

      /*
       * `reprise` est une clé SUPPLÉMENTAIRE du cache, hors des `values` que le contrat valide champ
       * par champ. `publicationContentOf` ne lit ni ne recopie les clés qu'il ne connaît pas — le
       * commentaire d'en-tête du contrat le dit du lot F1, qui a laissé quatre champs projetés
       * devenir des clés en trop sans changer de version. La trace survit donc sans rien fausser.
       */
      const cache = {
        version: PRESENTATION_VERSION,
        readerVersion: REVISION,
        reprise: REPRISE,
        sourceKey: ligne.sourceKey,
        externalId: ligne.externalId,
        url: ligne.url,
        captureBatchId: ligne.captureBatchId ?? null,
        captureOutputId: ligne.captureOutputId ?? null,
        inputHash,
        values,
      } as Prisma.InputJsonValue;

      /*
       * LE GARDE-FOU : on relit la projection avec le MÊME contrat que l'API avant de l'écrire.
       * Une ligne que `publicationContentOf` refuse n'est pas écrite — elle est comptée et nommée.
       * Écrire une projection invalide ne ferait que déplacer le 503 de la lecture vers l'écriture.
       */
      const relu = publicationContentOf({
        sourceKey: ligne.sourceKey, externalId: ligne.externalId, url: ligne.url,
        sourceTier: ligne.sourceTier, captureBatchId: ligne.captureBatchId,
        captureOutputId: ligne.captureOutputId, sourceFacts: ligne.sourceFacts, presentation: cache,
      });
      if (!relu) { refusees += 1; echecs.push({ id: ligne.id, raison: 'PROJECTION_REFUSEE_PAR_LE_CONTRAT' }); continue; }

      if (ECRIRE) {
        await db.jobSource.update({ where: { id: ligne.id }, data: { presentation: cache } });
        ecrites += 1;
      } else {
        ecrites += 1; // simulation : compte ce qui SERAIT écrit
      }
    }

    console.log(JSON.stringify({ vues, ecrites, refusees }));
    if (!ECRIRE) break; // en comptage, un seul lot suffit à établir le taux
  }

  /*
   * En comptage, `vues` porte sur UN SEUL lot quand `aReprendre` porte sur toute la table : deux
   * portées différentes dans un même bloc JSON. Sans le dire, un taux de refus de 0 sur 500 se lit
   * comme un taux sur 85 327 — et personne ne relit le code avant de citer le chiffre.
   */
  console.log(JSON.stringify({
    mode: ECRIRE ? 'ECRITURE' : 'COMPTAGE',
    vues, ecrites, refusees,
    ...(ECRIRE ? {} : {
      echantillon: `${vues} ligne(s) sur ${restant} : taux mesuré sur un lot, PAS sur la table entière`,
    }),
    echantillonEchecs: echecs.slice(0, 5),
  }, null, 1));
}

try { await main(); } finally { await db.$disconnect(); }
