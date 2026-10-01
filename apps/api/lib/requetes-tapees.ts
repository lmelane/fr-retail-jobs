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
 * Une requête n'est suggérée qu'à partir de `SEUIL_POPULAIRE` occurrences tapées sur `JOURS_MIN_POPULAIRE` jours
 * distincts, sans négation ni critère refusé, sans contrat, niveau ni lieu, et seulement si ses mots (métier, famille, mots
 * libres) sont écrits dans l'intitulé d'une même offre du marché (`suggestions-canoniques.ts`) : une suite de mots poussée à
 * la main au-delà du seuil ne devient pas une suggestion si aucune offre ne la porte. Une requête jamais devenue populaire
 * s'efface `PURGE_JOURS` jours après sa dernière occurrence ; toute requête, `CONSERVATION_MAX_JOURS` jours après.
 */
export const SEUIL_POPULAIRE = 10;
/** Et tapée au moins ces jours distincts : une seule personne qui insiste un soir ne fait pas une recherche populaire. */
export const JOURS_MIN_POPULAIRE = 3;

/**
 * LES REQUÊTES QUI NE SONT NI GARDÉES NI SUGGÉRÉES (audits métier et technique du 01/10/2026) : une négation (« vendeuse
 * sans … » ferait suggérer n'importe quel mot exclu) ; un mot qui désigne une personne par son sexe, son âge, une grossesse
 * ou une religion, en français, anglais, allemand, italien et espagnol (Code du travail, L1132-1, L1142-1) : Catwalks ne
 * suggère jamais une recherche qui se lirait comme ce critère. C'est une LISTE, pas une compréhension : l'origine n'y est
 * pas (« français », « arabe » sont aussi des langues demandées), ni un âge écrit en chiffres ; « féminin » et
 * « masculin » n'y sont pas, ils qualifient une collection (« prêt-à-porter féminin »). Mots normalisés (`searchWords` :
 * minuscules, sans accents).
 */
export const NEGATIONS: ReadonlySet<string> = new Set(['sans', 'without', 'excluding', 'except', 'not', 'hors', 'pas', 'non', 'no', 'ohne', 'senza', 'sin']);
export const CRITERES_REFUSES: ReadonlySet<string> = new Set([
  // Le sexe : français, anglais, allemand, italien, espagnol.
  'homme', 'hommes', 'femme', 'femmes', 'garcon', 'garcons', 'fille', 'filles', 'monsieur', 'madame', 'mademoiselle',
  'man', 'men', 'mens', 'woman', 'women', 'womens', 'male', 'males', 'female', 'females', 'lady', 'ladies', 'gentleman', 'gentlemen',
  'girl', 'girls', 'boy', 'boys', 'frau', 'frauen', 'mann', 'manner', 'damen', 'herren', 'donna', 'donne', 'uomo', 'uomini', 'ragazza',
  'ragazze', 'ragazzo', 'ragazzi', 'mujer', 'mujeres', 'hombre', 'hombres', 'chica', 'chicas', 'chico', 'chicos',
  // L'âge.
  'jeune', 'jeunes', 'vieux', 'vieille', 'young', 'jung', 'junge', 'giovane', 'giovani', 'joven', 'jovenes',
  // La grossesse.
  'enceinte', 'enceintes', 'grossesse', 'pregnant', 'schwanger', 'incinta', 'embarazada',
  // La religion.
  'voile', 'voilee', 'hijab', 'kopftuch', 'musulman', 'musulmane', 'muslim', 'muslima', 'musulmana', 'juif', 'juive', 'jewish', 'ebreo',
  'judio', 'judia', 'chretien', 'chretienne', 'christian', 'cristiano', 'cristiana', 'catholique', 'religion', 'ethnie', 'race']);
/** La requête (mots normalisés) porte-t-elle une négation ou un critère refusé ? */
export const requeteRefusee = (mots: readonly string[]) => mots.some((m) => NEGATIONS.has(m) || CRITERES_REFUSES.has(m));
export const PURGE_JOURS = 30;
/** Une requête, même populaire, que plus personne ne tape depuis un an s'efface aussi (durée à relire avec le juriste). */
export const CONSERVATION_MAX_JOURS = 365;
/** La purge tourne au plus une fois par heure et par instance, dans la boucle de l'API (`instrumentation.ts`). */
const PURGE_INTERVALLE_MS = 60 * 60_000;

/**
 * LA GARDE DE L'AGRÉGATEUR (D-501, audit de réconciliation du 01/10/2026) : en production, rien n'est enregistré tant que
 * cette constante n'est pas passée à `true` par un commit et une release, après la validation juridique. La préversion
 * du site interroge l'API de production : la variable du site (`REQUETES_TAPEES_ACTIF`) ne suffit pas à elle seule.
 * Hors production (poste local, témoins), l'enregistrement est actif sur la base locale.
 */
export const ENREGISTREMENT_EN_PRODUCTION = false;
export const enregistrementActif = () => process.env.NODE_ENV !== 'production' || ENREGISTREMENT_EN_PRODUCTION;
const MOTS_MAX = 6, LONGUEUR_MAX = 80;

/**
 * La forme gardée d'une requête tapée, ou `null` si elle ne doit pas l'être : repliée comme la recherche la comprend
 * (écriture inclusive, marques de genre), en minuscules, sans ponctuation de bord. Écartées : plus de 6 mots ou de 80
 * caractères, moins de 2 lettres, une adresse, un courriel, un numéro (4 chiffres de suite : code postal, téléphone,
 * référence), ce qui n'a aucune lettre.
 */
export function formeGardee(q: string): { cle: string; libelle: string } | null {
  if (typeof q !== 'string' || q.length > 500) return null;
  // Une adresse, un courriel, ou quatre chiffres en tout (code postal, téléphone écrit avec des espaces, référence).
  if (/@|:\/\/|www\./i.test(q) || (q.match(/\d/g)?.length ?? 0) >= 4) return null;
  const libelle = replierRequete(q).toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}'’\- ]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s'’-]+|[\s'’-]+$/g, '').trim();
  const mots = searchWords(libelle);
  const cle = mots.join(' ');
  if (!mots.length || mots.length > MOTS_MAX || cle.length < 2 || cle.length > LONGUEUR_MAX || libelle.length < 2 || libelle.length > LONGUEUR_MAX) return null;
  if (!/\p{L}{2}/u.test(cle) || requeteRefusee(mots)) return null;
  return { cle, libelle };
}

let dernierePurge = 0;

/** Compte une requête tapée sur un marché. Rend `false` quand la forme n'est pas gardée. */
export async function enregistrerRequete(marche: string, q: string): Promise<boolean> {
  if (!enregistrementActif() || !/^[A-Z]{2}$/.test(marche)) return false;
  const forme = formeGardee(q);
  if (!forme) return false;
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "RequeteTapee"("marche", "cle", "libelle") VALUES (${marche}, ${forme.cle}, ${forme.libelle})
    ON CONFLICT ("marche", "cle") DO UPDATE SET "occurrences" = LEAST("RequeteTapee"."occurrences" + 1, 2000000000),
      "jours" = LEAST("RequeteTapee"."jours" + (CASE WHEN "RequeteTapee"."derniereLe" < CURRENT_DATE THEN 1 ELSE 0 END),
        LEAST("RequeteTapee"."occurrences" + 1, 2000000000)),
      "derniereLe" = GREATEST("RequeteTapee"."derniereLe", CURRENT_DATE)`);
  return true;
}

/**
 * Efface les requêtes jamais devenues populaires (sous le seuil d'occurrences OU de jours distincts) `PURGE_JOURS` jours
 * après leur dernière occurrence, et toute requête que personne n'a tapée depuis `CONSERVATION_MAX_JOURS`. Rend leur
 * nombre. Une insistance d'un seul soir (500 occurrences, un jour) n'est pas populaire : elle part à 30 jours (audit 2).
 */
export async function purgerRequetes(): Promise<number> {
  return prisma.$executeRaw(Prisma.sql`DELETE FROM "RequeteTapee"
    WHERE (("occurrences" < ${SEUIL_POPULAIRE} OR "jours" < ${JOURS_MIN_POPULAIRE}) AND "derniereLe" < CURRENT_DATE - ${PURGE_JOURS}::int)
       OR "derniereLe" < CURRENT_DATE - ${CONSERVATION_MAX_JOURS}::int`);
}

/** La purge de la boucle de l'API : au plus une fois par heure, qu'il y ait eu des enregistrements ou non. Un échec (table
 * absente, base indisponible) ne casse rien : il est journalisé, au plus une fois par heure. */
export async function purgerRequetesSiDue(): Promise<void> {
  if (Date.now() - dernierePurge < PURGE_INTERVALLE_MS) return;
  dernierePurge = Date.now();
  try {
    const n = await purgerRequetes();
    if (n) console.info(JSON.stringify({ event: 'requetes_tapees.purge', supprimees: n }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'requetes_tapees.purge_echec', error: error instanceof Error ? error.name : 'unknown' }));
  }
}

/** Les requêtes populaires d'un marché dont un mot commence par la frappe (mots normalisés), les plus tapées d'abord. */
export async function requetesPopulaires(marche: string, frappe: string, limite = 10): Promise<{ libelle: string; cle: string; occurrences: number }[]> {
  const f = searchWords(frappe).join(' ');
  if (f.length < 2) return [];
  // `f` n'a que des lettres, des chiffres et des espaces (`searchWords`) : aucun caractère spécial de LIKE.
  const lignes = await prisma.$queryRaw<{ libelle: string; cle: string; occurrences: number }[]>(Prisma.sql`SELECT "libelle", "cle", "occurrences" FROM "RequeteTapee"
    WHERE "marche" = ${marche} AND "occurrences" >= ${SEUIL_POPULAIRE} AND "jours" >= ${JOURS_MIN_POPULAIRE} AND (' ' || "cle") LIKE ${`% ${f}%`}
    ORDER BY "occurrences" DESC, "cle" LIMIT ${limite}`);
  // Une ligne gardée avant un durcissement de la liste ne passe pas non plus.
  return lignes.filter((l) => !requeteRefusee(l.cle.split(' ')));
}
