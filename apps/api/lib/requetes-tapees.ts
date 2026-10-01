import { prisma, Prisma } from '@catwalks/db';
import { replierRequete } from '@catwalks/db/search-comprendre';
import { searchWords } from './search-intent';

/**
 * D-501 §2 — LES REQUÊTES TAPÉES, ANONYMES ET AGRÉGÉES, SOURCE DES RECHERCHES POPULAIRES (comme Indeed).
 *
 * Ce qui est gardé : par marché et par requête normalisée, un nombre d'occurrences, le jour de la première et de la
 * dernière (table `RequeteTapee`, migration `20261001200000_requetes_tapees`). Ce qui ne l'est jamais : un identifiant
 * de compte ou d'appareil, une adresse IP, l'heure d'une recherche. Le site seul les transmet (clé du catalogue), au
 * moment où une recherche tapée est lancée depuis la barre, et seulement avec `REQUETES_TAPEES_ACTIF=1`, posée après la
 * validation juridique (D-501, garde ; R-137).
 *
 * POURQUOI L'AGRÉGATEUR, ET NON LE BACKEND : ces requêtes ne servent qu'aux suggestions, que l'agrégateur calcule à chaque
 * frappe sous 300 ms (cahier §3.3) ; les garder ailleurs ajouterait un appel réseau par frappe. Le backend ne voit pas les
 * recherches d'un visiteur (le site interroge le catalogue directement) ; il n'aurait rien à y ajouter.
 *
 * Une requête n'est suggérée qu'à partir de `SEUIL_POPULAIRE` occurrences, et seulement si chacun de ses mots est écrit
 * dans l'intitulé d'une offre du marché (`suggestions-canoniques.ts`) : une suite de mots poussée à la main au-delà du
 * seuil ne devient pas une suggestion si aucune offre ne la porte. Une requête restée sous le seuil s'efface
 * `PURGE_JOURS` jours après sa dernière occurrence.
 */
export const SEUIL_POPULAIRE = 10;
export const PURGE_JOURS = 30;
/** Au plus une purge par heure et par instance : elle part après un enregistrement, jamais sur le chemin d'une recherche. */
const PURGE_INTERVALLE_MS = 60 * 60_000;
const MOTS_MAX = 6, LONGUEUR_MAX = 80;

/**
 * La forme gardée d'une requête tapée, ou `null` si elle ne doit pas l'être : repliée comme la recherche la comprend
 * (écriture inclusive, marques de genre), en minuscules, sans ponctuation de bord. Écartées : plus de 6 mots ou de 80
 * caractères, moins de 2 lettres, une adresse, un courriel, un numéro (4 chiffres de suite : code postal, téléphone,
 * référence), ce qui n'a aucune lettre.
 */
export function formeGardee(q: string): { cle: string; libelle: string } | null {
  if (typeof q !== 'string' || q.length > 500) return null;
  if (/@|:\/\/|www\.|\d{4}/i.test(q)) return null;
  const libelle = replierRequete(q).toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}'’\- ]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s'’-]+|[\s'’-]+$/g, '').trim();
  const mots = searchWords(libelle);
  const cle = mots.join(' ');
  if (!mots.length || mots.length > MOTS_MAX || cle.length < 2 || cle.length > LONGUEUR_MAX || libelle.length > LONGUEUR_MAX) return null;
  if (!/\p{L}{2}/u.test(cle)) return null;
  return { cle, libelle };
}

let dernierePurge = 0;

/** Compte une requête tapée sur un marché. Rend `false` quand la forme n'est pas gardée. */
export async function enregistrerRequete(marche: string, q: string): Promise<boolean> {
  if (!/^[A-Z]{2}$/.test(marche)) return false;
  const forme = formeGardee(q);
  if (!forme) return false;
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "RequeteTapee"("marche", "cle", "libelle") VALUES (${marche}, ${forme.cle}, ${forme.libelle})
    ON CONFLICT ("marche", "cle") DO UPDATE SET "occurrences" = LEAST("RequeteTapee"."occurrences" + 1, 2000000000),
      "derniereLe" = GREATEST("RequeteTapee"."derniereLe", CURRENT_DATE)`);
  if (Date.now() - dernierePurge > PURGE_INTERVALLE_MS) {
    dernierePurge = Date.now();
    await purgerRequetes().catch(() => { dernierePurge = 0; });
  }
  return true;
}

/** Efface les requêtes restées sous le seuil `PURGE_JOURS` jours après leur dernière occurrence. Rend leur nombre. */
export async function purgerRequetes(): Promise<number> {
  return prisma.$executeRaw(Prisma.sql`DELETE FROM "RequeteTapee"
    WHERE "occurrences" < ${SEUIL_POPULAIRE} AND "derniereLe" < CURRENT_DATE - ${PURGE_JOURS}::int`);
}

/** Les requêtes populaires d'un marché dont un mot commence par la frappe (mots normalisés), les plus tapées d'abord. */
export async function requetesPopulaires(marche: string, frappe: string, limite = 10): Promise<{ libelle: string; cle: string; occurrences: number }[]> {
  const f = searchWords(frappe).join(' ');
  if (f.length < 2) return [];
  // `f` n'a que des lettres, des chiffres et des espaces (`searchWords`) : aucun caractère spécial de LIKE.
  return prisma.$queryRaw(Prisma.sql`SELECT "libelle", "cle", "occurrences" FROM "RequeteTapee"
    WHERE "marche" = ${marche} AND "occurrences" >= ${SEUIL_POPULAIRE} AND (' ' || "cle") LIKE ${`% ${f}%`}
    ORDER BY "occurrences" DESC, "cle" LIMIT ${limite}`);
}
