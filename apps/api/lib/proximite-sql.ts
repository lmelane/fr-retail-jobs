import { Prisma } from '@catwalks/db';
import { ANNEAUX_KM, OFFRES_PAR_ANNEAU, RAYON_MAX_KM, anneauSql, compteDansLeCercle } from './geo';
import type { Dimension, PlanRecherche } from './search-plan';

/**
 * D-496 — LES CERCLES D'UNE RECHERCHE. Chaque ville cherchée a son cercle, qui s'élargit seul (15, 30, 50, 100 km) tant
 * qu'il compte moins de 20 offres : le lieu de la barre (colonne `dl` de `base`) et chaque ville du filtre `ville`
 * (`dv0`, `dv1`…). Plusieurs villes du filtre se cumulent en union (R-121 §1) : « Paris + Annecy » garde Paris à 15 km et
 * laisse Annecy s'élargir jusqu'à ses 20 offres. Le lieu de la barre et le filtre se cumulent en intersection.
 *
 * Une offre sans point que le nom de sa ville retient (`dl` nul pour le lieu, `vt` pour une ville du filtre) ou qu'une
 * valeur inconnue de la base retient par égalité de texte (`vi`) est retenue à tout rayon et compte dans chaque anneau.
 * D-510 : les cercles retiennent les offres ; ils ne les trient plus (le tri est la fraîcheur, `fraicheur.ts`).
 */
export type Cercle = { colonne: string; lieu: boolean };

/** Les cercles qui s'appliquent à une restriction (`sauf` : la dimension qu'une facette retire d'elle-même). */
export function cercles(plan: PlanRecherche, sauf?: Dimension): Cercle[] {
  const p = plan.proximite;
  const liste: Cercle[] = p?.lieu ? [{ colonne: 'dl', lieu: true }] : [];
  if (p?.villes && sauf !== 'ville' && plan.selections.ville?.length) {
    p.villes.resolues.forEach((_v, i) => liste.push({ colonne: `dv${i}`, lieu: false }));
  }
  return liste;
}

/** Les noms de colonnes viennent d'ici (`dl`, `dv<n>`), jamais d'une saisie. */
const colonne = (c: Cercle, t: string) => Prisma.raw(`${t}.${c.colonne}`);
const lettre = (t: string) => Prisma.raw(t);

/**
 * La ligne est-elle retenue par le cercle `c` de rayon `rayon` ? Une offre retenue sans point (`dl` nul pour le lieu ;
 * `vt`, `vi` pour le filtre) l'est à tout rayon : elle compte dans chaque anneau, pour la liste comme pour les facettes
 * (une seule définition, sinon la facette « CDI (25) » et la liste choisiraient deux cercles différents).
 */
function dans(c: Cercle, rayon: Prisma.Sql, t: string): Prisma.Sql {
  return c.lieu ? Prisma.sql`(${colonne(c, t)} IS NULL OR ${colonne(c, t)} <= ${rayon})`
    : Prisma.sql`(${colonne(c, t)} <= ${rayon} OR ${lettre(t)}.vt OR ${lettre(t)}.vi)`;
}

/** Le rayon retenu pour un cercle : le plus petit anneau dont le compte atteint 20, sinon le plus large. */
function rayonChoisi(c: Cercle, compte: (condition: Prisma.Sql) => Prisma.Sql, t: string): Prisma.Sql {
  const branches = ANNEAUX_KM.slice(0, -1).map((km) =>
    Prisma.sql`WHEN ${compte(dans(c, Prisma.sql`${km}::float8`, t))} >= ${OFFRES_PAR_ANNEAU} THEN ${km}::float8`);
  return Prisma.sql`(CASE ${Prisma.join(branches, ' ')} ELSE ${RAYON_MAX_KM}::float8 END)`;
}

/** Les rayons d'un ensemble de lignes (alias `t`), en colonnes `r0`, `r1`… (agrégats). */
export function rayonsSql(cs: readonly Cercle[], t: string): Prisma.Sql {
  return Prisma.join(cs.map((c, i) =>
    Prisma.sql`${rayonChoisi(c, (cond) => Prisma.sql`count(*) FILTER (WHERE ${cond})`, t)} AS ${Prisma.raw(`r${i}`)}`), ', ');
}

/** La ligne (alias `t`) est-elle retenue, chaque cercle `i` ayant le rayon `rayon(i)` ? */
export function appartient(cs: readonly Cercle[], rayon: (i: number) => Prisma.Sql, t: string): Prisma.Sql {
  const lieu = cs.flatMap((c, i) => (c.lieu ? [dans(c, rayon(i), t)] : []));
  const villes = cs.flatMap((c, i) => (c.lieu ? [] : [dans(c, rayon(i), t)]));
  const ville = villes.length ? [Prisma.sql`(${lettre(t)}.vt OR ${lettre(t)}.vi OR ${Prisma.join(villes, ' OR ')})`] : [];
  const parts = [...lieu, ...ville];
  return parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`true`;
}

/** L'anneau d'une ligne de `base` pour un seul cercle (0 : dans les 15 km, ou retenue sans point). */
function anneauUnique(c: Cercle): Prisma.Sql {
  return c.lieu ? anneauSql(Prisma.sql`b.dl`) : Prisma.sql`(CASE WHEN b.vt OR b.vi THEN 0 ELSE ${anneauSql(colonne(c, 'b'))} END)`;
}

/**
 * LA FACETTE D'UNE RECHERCHE DE PROXIMITÉ : chaque option est comptée dans ses propres cercles, ceux que la recherche
 * restreinte à cette option choisirait. La facette « CDI (25) » annonce la liste qu'un clic sur CDI affichera, même
 * quand ce clic élargit un cercle. Exception connue : la facette « Ville » compte les offres DONT la ville est l'option
 * (dans le cercle du lieu de la barre) ; un clic montre cette ville ET ses environs (lecture D-492 sous D-496).
 * Un seul cercle : des agrégats par anneau. Plusieurs : les rayons de chaque option
 * par fenêtre (`OVER (PARTITION BY` l'option`)`), puis l'appartenance ligne à ligne.
 *
 * `source` : la clause `FROM` sur l'alias `b` (avec un `CROSS JOIN LATERAL unnest(...) valeur` pour les dimensions à
 * plusieurs valeurs par offre) ; `valeur` : l'expression de l'option ; `distinct` : compter les offres et non les lignes.
 */
export function facetteDeProximite(plan: PlanRecherche, dimension: Dimension, o: {
  source: Prisma.Sql; valeur: Prisma.Sql; filtre: Prisma.Sql; distinct?: boolean; limite?: number;
}): Prisma.Sql {
  const cs = cercles(plan, dimension);
  const quoi = o.distinct ? Prisma.sql`count(DISTINCT b.id)` : Prisma.sql`count(*)`;
  const limite = o.limite ? Prisma.sql`LIMIT ${o.limite}` : Prisma.empty;
  if (cs.length <= 1) {
    const n = cs.length ? compteDansLeCercle(anneauUnique(cs[0]), quoi) : quoi;
    return Prisma.sql`
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT ${o.valeur}::text AS value, ${n}::int AS n FROM ${o.source} WHERE ${o.filtre}
     GROUP BY ${o.valeur} ORDER BY n DESC, value ${limite}) f)`;
  }
  const fenetre = Prisma.sql`OVER (PARTITION BY ${o.valeur})`;
  const rayons = cs.map((c, i) => Prisma.sql`${rayonChoisi(c, (cond) => Prisma.sql`count(*) FILTER (WHERE ${cond}) ${fenetre}`, 'b')} AS ${Prisma.raw(`r${i}`)}`);
  const colonnes = Prisma.raw(['dl', 'vt', 'vi', ...cs.filter((c) => !c.lieu).map((c) => c.colonne)].map((x) => `b.${x}`).join(', '));
  const garde = (i: number) => Prisma.raw(`x.r${i}`);
  return Prisma.sql`
  (SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC, value), '[]'::jsonb)
   FROM (SELECT value, (${o.distinct ? Prisma.sql`count(DISTINCT x.id)` : Prisma.sql`count(*)`}
       FILTER (WHERE ${appartient(cs, garde, 'x')}))::int AS n
     FROM (SELECT ${o.valeur}::text AS value, b.id, ${colonnes}, ${Prisma.join(rayons)} FROM ${o.source} WHERE ${o.filtre}) x
     GROUP BY value HAVING count(*) FILTER (WHERE ${appartient(cs, garde, 'x')}) > 0 ORDER BY n DESC, value ${limite}) f)`;
}
