import type { Prisma, PrismaClient } from '@prisma/client';
import { MARCHES } from '@catwalks/db/marches';
import type { MotifAbstentionPays } from '../geo/frontieres.js';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { log } from '../observability/logger.js';
import { ContratInvalideError } from './contrat.js';
import { chargerContexte, type ContexteProjection } from './contexte.js';
import {
  LISTE_CONTRAT_VERSION, LISTE_PLAFOND, ListeIndisponibleError, ListeInvalideError, lireCompte, lireListe, offreCatalogueDepuisListe,
  type LectureListe, type RefusListe, type SourceListe,
} from './liste.js';
import { colonnesProjetees, empreinteStable } from './projection.js';
import { reprojeterStock, type StatsReprojection } from './reprojection.js';

/**
 * LA PHOTO DES OFFRES CATWALKS (D-444) — la liste publique du backend, relue toutes les 5 minutes, tenue à jour dans
 * `DirectOffer` sans le backend ni son flux d'outbox.
 *
 *  - présente dans la liste : publiable (`eligible`), projetée par `colonnesProjetees` (employeur de D-455, groupe et
 *    métier de D-444, pays par les coordonnées) ;
 *  - absente d'une photo COMPLÈTE : retirée, projection gardée (la fiche dit « fermée »), réversible à la passe où elle
 *    revient ;
 *  - une photo n'est complète que si la réponse compte au moins une offre, moins que le plafond du backend (500),
 *    autant d'offres que le backend en compte lui-même (`GET /api/jobs/filters`, sans plafond : une troncature sous le
 *    plafond, pagination ou `take` abaissé, se voit ici) et aucune offre refusée. Sinon — vide, tronquée, compte
 *    différent ou indisponible, offre illisible — les offres lues sont écrites, AUCUNE n'est retirée, et la passe
 *    échoue pour alerter ;
 *  - une panne du backend (transport, HTTP, JSON) ou une réponse invalide (pas un tableau, identifiant répété) : rien
 *    n'est écrit dans les offres ; l'état du lecteur garde l'erreur et la passe échoue (alerte).
 *
 * N'ÉCRIT QUE CE QUI CHANGE. Une offre dont le contenu reçu (`payloadHash`) et la projection (`projectionHash`) n'ont pas
 * bougé n'est pas touchée : la file d'indexation de la recherche ne reçoit rien, et une passe sur une liste inchangée
 * n'écrit que l'état du lecteur. Un effacement suivi d'une réinsertion toutes les 5 minutes inonderait cette file, et
 * au-delà de 300 s de retard toute recherche par mots répondrait 503 (`requireSearchIndex`).
 *
 * Les écritures d'une passe tiennent dans UNE transaction, sous un verrou consultatif : deux passes simultanées n'en
 * font qu'une (la seconde s'arrête sans rien écrire). La lecture HTTP précède la transaction ; l'état du lecteur garde
 * l'instant de la lecture la plus récente, pris à l'horloge de la BASE (une machine à l'horloge décalée ne peut pas
 * figer le lecteur), et qui ne recule jamais, même quand une passe plus ancienne tombe en panne après une plus
 * récente. Une passe dont la lecture n'a pas commencé après cet instant n'écrit rien (jamais une lecture commencée plus
 * tôt par-dessus une plus récente ; l'instant est celui du départ de la lecture, pas de la réponse du backend) et
 * échoue, comme une passe qui trouve le verrou tenu (`passeReussie`).
 */
export const ETAT_LISTE = 'catwalks-liste';
const VERROU = 'catwalks-direct-liste';
/** Les pays que sert un marché de `/emplois` : une offre Catwalks hors de ces pays n'apparaît dans aucune liste. */
const PAYS_SERVIS: ReadonlySet<string> = new Set(Object.values(MARCHES).flatMap((m) => m.pays));

export type MotifIncomplet = 'VIDE' | 'TRONQUEE' | 'COMPTE_INDISPONIBLE' | 'COMPTE_DIFFERENT' | 'OFFRES_REFUSEES';
export type Abstention = { id: string; lieu: string; motif: MotifAbstentionPays };
export type StatsPhoto = {
  /** Éléments du tableau reçu, offres lues et refusées comprises. */
  recues: number;
  /** Les offres candidatables que le backend compte lui-même (`/api/jobs/filters`), ou `null` si ce compte manque. */
  annoncees: number | null;
  /** Pourquoi le compte manque (panne, réponse illisible), pour l'alerte ; `null` quand il a été lu. */
  compteErreur: string | null;
  lues: number;
  refusees: RefusListe[];
  complete: boolean;
  motifIncomplet: MotifIncomplet | null;
  publiees: number;
  misesAJour: number;
  retablies: number;
  inchangees: number;
  retirees: number;
  /** Les offres qu'une photo complète aurait retirées, gardées parce que la photo ne l'est pas. */
  retraitsSuspendus: number;
  /** Les offres lues, par pays établi ; celles qui s'abstiennent, avec leur motif. */
  parPays: Record<string, number>;
  abstentions: Abstention[];
  /**
   * Les offres lues dont le pays établi n'est servi par aucun marché de `/emplois` (aucune au 25/09/2026 depuis que le
   * marché France sert Monaco, D-468 §2) : publiables, mais dans aucune liste. Comme les abstentions, elles sont
   * signalées à chaque passe, sans la faire échouer.
   */
  horsMarche: { id: string; lieu: string; pays: string }[];
  reprojection: StatsReprojection;
  /** Une autre passe tenait le verrou : celle-ci n'a rien écrit. */
  concurrente: boolean;
  /** Une passe qui avait lu la liste APRÈS celle-ci (ou dans la même milliseconde) l'a déjà notée : celle-ci n'a rien écrit. */
  perimee: boolean;
};

type Projetee = { id: string; payload: Prisma.InputJsonValue; payloadHash: string; colonnes: ReturnType<typeof colonnesProjetees> };

/**
 * L'état du lecteur : l'instant de la lecture la plus récente (réussie ou non) et son erreur. L'instant ne recule
 * jamais, et une lecture qui n'est pas plus récente que celle déjà notée ne remplace pas son erreur : une passe lente
 * tombée en panne après une passe plus récente (ou de la même milliseconde, la précision de la colonne) ne fait ni
 * reculer la garde de péremption, ni croire à une panne en cours.
 */
async function noterEtat(db: PrismaClient | Prisma.TransactionClient, luLe: Date, erreur: string | null): Promise<void> {
  // Les colonnes DateTime de Prisma portent l'heure UTC sans fuseau : même conversion que `directPubliableSql`.
  await db.$executeRaw`
    INSERT INTO "DirectFeedCursor" (id, "lastSeq", "contractVersion", "lastReadAt", "lastError", "updatedAt")
    VALUES (${ETAT_LISTE}, 0, ${LISTE_CONTRAT_VERSION}, (${luLe}::timestamptz AT TIME ZONE 'UTC'), ${erreur}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (id) DO UPDATE SET
      "contractVersion" = CASE WHEN EXCLUDED."lastReadAt" > "DirectFeedCursor"."lastReadAt" THEN EXCLUDED."contractVersion" ELSE "DirectFeedCursor"."contractVersion" END,
      "lastError" = CASE WHEN EXCLUDED."lastReadAt" > "DirectFeedCursor"."lastReadAt" THEN EXCLUDED."lastError" ELSE "DirectFeedCursor"."lastError" END,
      "lastReadAt" = GREATEST("DirectFeedCursor"."lastReadAt", EXCLUDED."lastReadAt"),
      "updatedAt" = (now() AT TIME ZONE 'UTC')`;
}

/** L'instant de lecture, à l'horloge de la base : la même pour toutes les passes, quelle que soit la machine. */
async function instantBase(db: PrismaClient): Promise<Date> {
  const [{ maintenant }] = await db.$queryRaw<{ maintenant: Date }[]>`SELECT clock_timestamp() AS maintenant`;
  return maintenant;
}

/**
 * Une passe réussie a écrit une photo complète, sans ligne du stock laissée à sa projection antérieure. Une passe
 * périmée ou concurrente n'a rien écrit : elle échoue aussi, pour que sa répétition se voie (horloge, passes
 * superposées).
 */
export const passeReussie = (s: StatsPhoto): boolean =>
  s.complete && !s.perimee && !s.concurrente && s.reprojection.nonReprojetees.length === 0;

function motifIncomplet(lecture: LectureListe, annoncees: number | null, refus: number): MotifIncomplet | null {
  if (lecture.taille === 0) return 'VIDE';
  if (lecture.taille >= LISTE_PLAFOND) return 'TRONQUEE';
  if (annoncees === null) return 'COMPTE_INDISPONIBLE';
  if (annoncees !== lecture.taille) return 'COMPTE_DIFFERENT';
  if (refus > 0) return 'OFFRES_REFUSEES';
  return null;
}

/** Le compte du backend, ou `null` et sa cause s'il manque ou ne se lit pas : la complétude n'est alors pas prouvée. */
async function compterAnnoncees(source: SourceListe): Promise<{ annoncees: number | null; erreur: string | null }> {
  try {
    return { annoncees: lireCompte(await source.compter()), erreur: null };
  } catch (error) {
    if (error instanceof ListeIndisponibleError || error instanceof ListeInvalideError) return { annoncees: null, erreur: error.message.slice(0, 300) };
    throw error;
  }
}

export async function synchroniserListe(db: PrismaClient, source: SourceListe, options: { contexte?: ContexteProjection } = {}): Promise<StatsPhoto> {
  assertPipelineRunning();
  const contexte = options.contexte ?? await chargerContexte(db);
  const luLe = await instantBase(db);
  let lecture: LectureListe;
  try {
    lecture = lireListe(await source.lire());
  } catch (error) {
    // Panne ou réponse invalide : la copie reste figée, l'erreur est gardée, la passe échoue.
    if (error instanceof ListeIndisponibleError || error instanceof ListeInvalideError) await noterEtat(db, luLe, error.message.slice(0, 500));
    throw error;
  }
  const { annoncees, erreur: compteErreur } = await compterAnnoncees(source);

  // La projection est pure (contexte chargé) : elle précède la transaction. Une offre qui ne se projette pas est refusée.
  const refus: RefusListe[] = [...lecture.refus];
  const projetees: Projetee[] = [];
  const parPays: Record<string, number> = {};
  const abstentions: Abstention[] = [];
  const horsMarche: StatsPhoto['horsMarche'] = [];
  for (const lue of lecture.offres) {
    try {
      const verdict = contexte.pays(lue.item.latitude, lue.item.longitude);
      const colonnes = colonnesProjetees(offreCatalogueDepuisListe(lue.item, verdict.pays), contexte);
      projetees.push({ id: lue.id, payload: lue.brut as Prisma.InputJsonValue, payloadHash: empreinteStable(lue.brut), colonnes });
      if (verdict.pays === null) abstentions.push({ id: lue.id, lieu: lue.item.lieu, motif: verdict.motif });
      else {
        parPays[verdict.pays] = (parPays[verdict.pays] ?? 0) + 1;
        if (!PAYS_SERVIS.has(verdict.pays)) horsMarche.push({ id: lue.id, lieu: lue.item.lieu, pays: verdict.pays });
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      refus.push({ index: lue.index, id: lue.id, chemin: error instanceof ContratInvalideError ? error.chemin : `liste[${lue.index}]`, detail: `${error.name} : ${error.message}`.slice(0, 300) });
    }
  }
  const motif = motifIncomplet(lecture, annoncees, refus.length);
  const stats: StatsPhoto = {
    recues: lecture.taille, annoncees, compteErreur, lues: projetees.length, refusees: refus, complete: motif === null, motifIncomplet: motif,
    publiees: 0, misesAJour: 0, retablies: 0, inchangees: 0, retirees: 0, retraitsSuspendus: 0,
    parPays, abstentions, horsMarche, reprojection: { reprojetees: 0, nonReprojetees: [] }, concurrente: false, perimee: false,
  };

  return db.$transaction(async (tx) => {
    const [{ verrou }] = await tx.$queryRaw<{ verrou: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${VERROU}, 0)) AS verrou`;
    if (!verrou) return { ...stats, concurrente: true };
    // Une passe qui a lu la liste après celle-ci, ou dans la même milliseconde (la précision de la colonne), a déjà
    // écrit ou noté sa lecture : cette photo est périmée, elle n'écrit rien. Une passe ne note jamais sa propre lecture
    // avant ce contrôle : l'égalité vient toujours d'une autre passe.
    const etat = await tx.directFeedCursor.findUnique({ where: { id: ETAT_LISTE }, select: { lastReadAt: true } });
    if (etat && etat.lastReadAt >= luLe) return { ...stats, perimee: true };
    stats.reprojection = await reprojeterStock(tx, contexte);
    const existantes = await tx.directOffer.findMany({ select: { id: true, eligible: true, payloadHash: true, projectionHash: true } });
    const parId = new Map(existantes.map((e) => [e.id, e]));
    for (const p of projetees) {
      const existante = parId.get(p.id);
      if (!existante) {
        // La liste ne porte ni version ni séquence : elles restent à zéro, jamais inventées.
        await tx.directOffer.create({ data: { id: p.id, version: BigInt(0), appliedSeq: BigInt(0), eligible: true, payload: p.payload, payloadHash: p.payloadHash, ...p.colonnes } });
        stats.publiees++;
      } else if (existante.eligible && existante.payloadHash === p.payloadHash && existante.projectionHash === p.colonnes.projectionHash) {
        stats.inchangees++;
      } else {
        await tx.directOffer.update({ where: { id: p.id }, data: { eligible: true, payload: p.payload, payloadHash: p.payloadHash, ...p.colonnes } });
        if (existante.eligible) stats.misesAJour++; else stats.retablies++;
      }
    }
    const presentes = new Set(projetees.map((p) => p.id));
    // Une offre refusée mais identifiée est présente dans la liste : jamais retirée (la photo n'est de toute façon pas complète).
    for (const r of refus) if (r.id) presentes.add(r.id);
    const absentes = existantes.filter((e) => e.eligible && !presentes.has(e.id)).map((e) => e.id);
    if (stats.complete) {
      if (absentes.length) stats.retirees = (await tx.directOffer.updateMany({ where: { id: { in: absentes }, eligible: true }, data: { eligible: false } })).count;
    } else stats.retraitsSuspendus = absentes.length;
    await noterEtat(tx, luLe, motif
      ? `${motif} : ${lecture.taille} offre(s) reçue(s), ${annoncees ?? 'compte indisponible'} annoncée(s)${compteErreur ? ` (${compteErreur})` : ''}, ${refus.length} refusée(s), aucun retrait`
      : null);
    return stats;
  }, { maxWait: 10_000, timeout: 60_000 }).then(async (resultat) => {
    if (resultat.concurrente) await log.warn('direct.liste_concurrente', '[direct-liste] une autre passe tenait le verrou ; rien n’a été écrit', {});
    else if (resultat.perimee) await log.warn('direct.liste_perimee', '[direct-liste] une lecture plus récente est déjà écrite ; rien n’a été écrit', {});
    else if (!resultat.complete) await log.warn('direct.liste_incomplete', `[direct-liste] photo incomplète (${resultat.motifIncomplet}) : aucun retrait`,
      { recues: resultat.recues, annoncees: resultat.annoncees, compteErreur: resultat.compteErreur, refusees: resultat.refusees, retraitsSuspendus: resultat.retraitsSuspendus });
    // Publiables mais dans aucune liste de `/emplois` : sans pays établi, ou dans un pays qu'aucun marché ne sert.
    if (resultat.abstentions.length || resultat.horsMarche.length)
      await log.warn('direct.liste_hors_listes', `[direct-liste] ${resultat.abstentions.length + resultat.horsMarche.length} offre(s) Catwalks dans aucune liste de /emplois (pays non établi ou hors marché)`,
        { abstentions: resultat.abstentions, horsMarche: resultat.horsMarche });
    return resultat;
  });
}
