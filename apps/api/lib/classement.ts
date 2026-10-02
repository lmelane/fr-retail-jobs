import { Prisma } from '@catwalks/db';
import { CONTRATS_CLASSABLES, type PlanRecherche } from './search-plan';
import { fraicheurSql } from './fraicheur';

/**
 * R-143 §7 (D-513, décision du CEO du 02/10/2026, précision « une recherche tapée compte ») — LE CLASSEMENT PERTINENT.
 *
 * « S'il ne nous a encore rien dit sur lui, on lui montre avant tout ce qui vient d'arriver. Dès qu'il nous a donné ses
 * préférences, Catwalks doit commencer à travailler pour lui : ce qui correspond le mieux à sa recherche passe devant,
 * tout en gardant la fraîcheur comme signal important. » Sans requête ni préférences, l'ordre reste celui de D-510
 * (`fraicheur.ts`) ; dès qu'il y en a (`Pertinence`, `search-plan.ts`), au contrat 2 :
 *
 *   SCORE = (BASE + intitulé + lieu + contrat + télétravail + salaire) × ½ ^ (âge en jours / 14)
 *
 * Des points simples, sans apprentissage, lisibles offre par offre (`criteres`, servi dans la réponse) :
 *   · BASE, 5 : toute offre qui répond à la recherche. Sans elle, une offre trouvée seulement par sa description
 *     resterait derrière une offre qui nomme la recherche à n'importe quel âge : la fraîcheur ne jouerait plus pour elle ;
 *   · intitulé, 40 / 25 / 0 : l'intitulé nomme la requête (chaque mot de chaque clause de métier, de famille ou de mots
 *     y est écrit, hors mots de liaison, l'écriture inclusive comprise), ou le métier tapé ou choisi est son métier
 *     principal (`occupationCode`) ; 25 : elle porte un métier cherché parmi ceux lus dans son intitulé ; 0 : trouvée
 *     ailleurs (description, missions). Comparé à la requête tapée ou au métier choisi ; sans eux, aux métiers des
 *     préférences ;
 *   · lieu, 20 / 13 / 7 / 0 : dans les 15 km du lieu cherché (ou dans la ville, une offre sans point retenue par son nom),
 *     à 30, à 50 km, plus loin. Sans lieu cherché : 20 dans l'une des villes des préférences, 0 ailleurs (une autre
 *     ville n'est jamais un désaccord, R-141 §5). Un lieu non géographique (pays, code postal, télétravail) n'est pas
 *     comparé : il retient déjà toutes les offres de la même façon ;
 *   · contrat, 30 / 15 / 0 : l'un des contrats de l'offre est voulu (le filtre `contrat`, sinon les préférences) ; 15 :
 *     l'offre ne dit pas son contrat, ou rien de comparable ; 0 : elle déclare un autre contrat. Le deuxième critère après
 *     le métier : pour un alternant, un CDI n'est pas une option (audit métier : à 15 points, un CDI de 2 jours passait
 *     devant l'alternance de 6 jours voulue) ;
 *   · télétravail, 10 / 5 / 0 et salaire, 10 / 5 / 0 : de même, aux règles exactes des pastilles du site (`coches.ts`,
 *     [[D-502]], R-141 §5) : vert = accord, gris ou absent = neutre, rouge = désaccord.
 *
 * Une donnée inconnue ne devient jamais une donnée négative (R-143 §10, [[D-515]] §1) : elle vaut le neutre, la moitié
 * d'un accord, jamais le zéro d'un désaccord. La fraîcheur divise le score par deux tous les 14 jours : une offre de
 * deux semaines doit correspondre deux fois mieux pour passer devant une offre du jour. Les offres Catwalks restent en
 * tête (D-419 §1) ; un filtre de contrat ou de temps de travail sert toujours d'abord les offres reconnues (D-513, R-143
 * §6). À score égal : la plus fraîche, puis l'identifiant.
 */
export const BASE = 5;
export const POINTS = {
  intitule: { requete: 40, metier: 25 },
  lieu: { dedans: 20, a30: 13, a50: 7 },
  contrat: { accord: 30, neutre: 15 },
  teletravail: { accord: 10, neutre: 5 },
  salaire: { accord: 10, neutre: 5 },
} as const;
export const DEMI_VIE_JOURS = 14;

/** L'instant de référence d'un classement : secondes entières, porté par le curseur pour que les pages ne bougent pas. */
export const instantDeReference = (at = Date.now()) => Math.floor(at / 1000);

/** Les points de l'intitulé contre des codes de métier : principal 40, lu dans l'intitulé 25, sinon 0. */
function metierPoints(codes: readonly string[]): Prisma.Sql {
  const liste = Prisma.join(codes.map((c) => Prisma.sql`${c}`));
  return Prisma.sql`(CASE WHEN b."occupationCode" IN (${liste}) THEN ${POINTS.intitule.requete}
    WHEN b."titleRoles" && ARRAY[${liste}]::text[] THEN ${POINTS.intitule.metier} ELSE 0 END)`;
}

/** Une ville des préférences telle que la carte l'écrit (« Paris (75) » : la ville « Paris », D-496). */
export const nomDeVille = (lieu: string) => lieu.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Les points de chaque critère, sur l'alias `b` de `base` ; `NULL` : critère non comparé pour cette recherche. */
export function composantes(plan: PlanRecherche): { intitule: Prisma.Sql; lieu: Prisma.Sql; contrat: Prisma.Sql; teletravail: Prisma.Sql; salaire: Prisma.Sql } {
  const prefs = plan.pertinence?.preferences ?? {};
  const NUL = Prisma.sql`NULL::int`;

  // L'intitulé : la requête tapée (`ri`, calculé dans `base` sur le document indexé) et le métier choisi ; sinon les
  // métiers des préférences.
  const choisis = plan.selections.metier?.filter((m) => m !== 'unclassified') ?? [];
  const sources = [
    ...(plan.q ? [Prisma.sql`b.ri`] : []),
    ...(choisis.length ? [metierPoints(choisis)] : []),
  ];
  const intitule = sources.length
    ? (sources.length === 1 ? sources[0] : Prisma.sql`GREATEST(${Prisma.join(sources)})`)
    : prefs.metiers?.length ? metierPoints(prefs.metiers) : NUL;

  // Le lieu : le cercle du lieu cherché (`dl`), sinon celui des villes du filtre (`dv`, `vt`, `vi`), sinon les villes des
  // préférences par leur nom.
  const paliers = (d: Prisma.Sql, dedans: Prisma.Sql) => Prisma.sql`(CASE WHEN ${dedans} OR ${d} <= 15 THEN ${POINTS.lieu.dedans}
    WHEN ${d} <= 30 THEN ${POINTS.lieu.a30} WHEN ${d} <= 50 THEN ${POINTS.lieu.a50} ELSE 0 END)`;
  const p = plan.proximite;
  const lieu = p?.lieu ? paliers(Prisma.sql`b.dl`, Prisma.sql`b.dl IS NULL`)
    : p?.villes && plan.selections.ville?.length ? paliers(Prisma.sql`b.dv`, Prisma.sql`(b.vt OR b.vi)`)
    : plan.lieu || plan.selections.ville?.length ? NUL
    : prefs.lieux?.length
      ? Prisma.sql`(CASE WHEN b.ville IN (${Prisma.join(prefs.lieux.map((l) => Prisma.sql`lower(trim(${nomDeVille(l)}))`))}) THEN ${POINTS.lieu.dedans} ELSE 0 END)`
      : NUL;

  // Le contrat : les choix de l'offre (durée, dispositif, nature ; l'indépendant compte comme freelance, comme la pastille).
  // L'indépendant compte comme freelance des deux côtés : un filtre `INDEPENDENT_CONTRACTOR` ne note pas son offre en désaccord.
  const voulus = (plan.selections.contrat?.length ? plan.selections.contrat : prefs.contrats ?? [])
    .map((v) => (v === 'INDEPENDENT_CONTRACTOR' ? 'FREELANCE' : v));
  const choix = Prisma.sql`array_remove(ARRAY[b."employmentTerm", b."programType",
    CASE WHEN b."engagementType" IN ('FREELANCE', 'INDEPENDENT_CONTRACTOR') THEN 'FREELANCE' END], NULL)::text[]`;
  const contrat = voulus.length
    ? Prisma.sql`(CASE WHEN ${choix} && ARRAY[${Prisma.join(voulus.map((v) => Prisma.sql`${v}`))}]::text[] THEN ${POINTS.contrat.accord}
        WHEN ${choix} && ARRAY[${Prisma.join(CONTRATS_CLASSABLES.map((v) => Prisma.sql`${v}`))}]::text[] THEN 0 ELSE ${POINTS.contrat.neutre} END)`
    : NUL;

  // Le télétravail : ouvert, le télétravail et l'hybride s'accordent, le site est neutre ; sur site, le site s'accorde,
  // le télétravail complet est un désaccord, l'hybride neutre (`etatTeletravail` du site, D-507 §4).
  const w = Prisma.sql`b."workplaceType"`;
  const teletravail = prefs.teletravail === true
    ? Prisma.sql`(CASE WHEN ${w} IN ('REMOTE', 'HYBRID') THEN ${POINTS.teletravail.accord} ELSE ${POINTS.teletravail.neutre} END)`
    : prefs.teletravail === false
      ? Prisma.sql`(CASE WHEN ${w} = 'ONSITE' THEN ${POINTS.teletravail.accord} WHEN ${w} = 'REMOTE' THEN 0 ELSE ${POINTS.teletravail.neutre} END)`
      : NUL;

  // Le salaire : comparé dans la même devise et la même période seulement ; le haut de la fourchette atteint le minimum :
  // accord ; il est en dessous : désaccord ; un « à partir de » sous le minimum ne dit pas jusqu'où il monte : neutre.
  const s = prefs.salaire;
  const haut = Prisma.sql`coalesce(b."salaryMax", b."salaryMin")`;
  const salaire = s
    ? Prisma.sql`(CASE WHEN b."salaryCurrency" = ${s.devise} AND b."salaryPeriod" = ${s.periode} AND ${haut} IS NOT NULL THEN
        (CASE WHEN ${haut} >= ${s.montant}::numeric THEN ${POINTS.salaire.accord} WHEN b."salaryMax" IS NOT NULL THEN 0 ELSE ${POINTS.salaire.neutre} END)
        ELSE ${POINTS.salaire.neutre} END)`
    : NUL;

  return { intitule, lieu, contrat, teletravail, salaire };
}

/** Les colonnes de `base` que le classement relit (`workplaceType`, salaire), à ajouter au seul contrat pertinent. */
export const COLONNES_CLASSEMENT = {
  agregee: Prisma.sql`, j."workplaceType", j."salaryMin", j."salaryMax", j."salaryCurrency", j."salaryPeriod"`,
  directe: Prisma.sql`, d."workplaceType", d."salaryMin", d."salaryMax", d."salaryCurrency", d."salaryPeriod"`,
};

/** L'âge d'une ligne en jours à l'instant de référence `t0` (secondes), jamais négatif. */
export const ageJoursSql = (t0: number) =>
  Prisma.sql`(greatest(0, ${t0}::float8 - extract(epoch FROM ${fraicheurSql()})::float8) / 86400.0)`;

/** Le score négatif quantifié (millièmes) : croissant comme le reste de la clé, le meilleur d'abord. */
export const scoreNegatifSql = (t0: number) =>
  Prisma.sql`(-round(((${BASE} + coalesce(pi, 0) + coalesce(pl, 0) + coalesce(pc, 0) + coalesce(pt, 0) + coalesce(ps, 0))
    * power(0.5::float8, ${ageJoursSql(t0)} / ${DEMI_VIE_JOURS}::float8) * 1000)::numeric)::bigint)`;

/** Un critère qui a joué pour une offre, tel que la réponse le sert. */
export type CritereClasse = {
  critere: 'intitule' | 'lieu' | 'contrat' | 'teletravail' | 'salaire';
  /**
   * intitulé : `nomme_la_recherche` (40), `porte_le_metier` (25), `trouvee_ailleurs` (0) ;
   * lieu : `dans_le_lieu` (20), `a_30_km` (13), `a_50_km` (7), `plus_loin` (0) ;
   * contrat, télétravail, salaire : `accord`, `neutre` (inconnu ou ni l'un ni l'autre), `desaccord` (0).
   */
  etat: string;
  points: number;
};

/** Le classement d'une offre, servi dans la réponse : ce qui a joué, son âge et son score. */
export type Classement = { score: number; points: number; ageJours: number; criteres: CritereClasse[] };

const ETATS: Record<CritereClasse['critere'], Record<number, string>> = {
  intitule: { [POINTS.intitule.requete]: 'nomme_la_recherche', [POINTS.intitule.metier]: 'porte_le_metier', 0: 'trouvee_ailleurs' },
  lieu: { [POINTS.lieu.dedans]: 'dans_le_lieu', [POINTS.lieu.a30]: 'a_30_km', [POINTS.lieu.a50]: 'a_50_km', 0: 'plus_loin' },
  contrat: { [POINTS.contrat.accord]: 'accord', [POINTS.contrat.neutre]: 'neutre', 0: 'desaccord' },
  teletravail: { [POINTS.teletravail.accord]: 'accord', [POINTS.teletravail.neutre]: 'neutre', 0: 'desaccord' },
  salaire: { [POINTS.salaire.accord]: 'accord', [POINTS.salaire.neutre]: 'neutre', 0: 'desaccord' },
};

/** Lit les points rendus par le SQL (`[intitulé, lieu, contrat, télétravail, salaire, âge]`) en critères lisibles. */
export function lireClassement(brut: readonly (number | null)[]): Classement {
  const noms = ['intitule', 'lieu', 'contrat', 'teletravail', 'salaire'] as const;
  const criteres = noms.flatMap((critere, i): CritereClasse[] => {
    const points = brut[i];
    if (points === null || points === undefined) return [];
    return [{ critere, etat: ETATS[critere][points] ?? 'inconnu', points }];
  });
  const points = BASE + criteres.reduce((n, c) => n + c.points, 0);
  const ageJours = Math.max(0, Number(brut[5] ?? 0));
  return { score: Math.round(points * 0.5 ** (ageJours / DEMI_VIE_JOURS) * 1000) / 1000, points, ageJours: Math.round(ageJours * 10) / 10, criteres };
}
