import { localeAffichage, nomFacette } from './presentation-locale';
import { langueDesLibelles } from '@catwalks/db/presentation';
import { libelleInconnu } from './taxonomy-labels';
import { getSectorPresentation, sectorWhere } from './sectors';
import { companyIdentityWhere } from './company-identity';
import { prisma } from '@catwalks/db';
import { publicJobWhere } from '@catwalks/db/availability';
import { facettesContrat, filtresDuMarche, TYPE_FILTRE_PAR_DEFAUT, type Perimetre } from '@catwalks/db/marches';
import { Prisma } from '@prisma/client';
import { DatabaseUnavailableError, MAX_VALUES, perimetreServi, type PerimetreServi } from './jobs';
import { CURSEUR_MAX, CurseurInvalideError, decoderCurseur, empreinteCriteres, encoderCurseur } from './curseur';
import { PREFIXE_DIRECT, directPubliable, directPubliableSql } from './direct-offers';
import { expandCompanyTerm } from './groups';
import { echapperLike } from './like';
import { exigerPerimetre } from './perimetre';
import type { FacetteServie } from './facettes';
import type { FiltreRefuse } from './search-plan';
import { companySlug } from './company-slug';

export { companySlug } from './company-slug';

/**
 * Employers, ranked by how many live offers they hold IN THE PERIMETER.
 *
 * The counterpart to the offer list: the same data read by employer rather than
 * by posting — "who is hiring right now" instead of "what can I apply to". Both
 * views are bounded by the same perimeter (lot 6): a Maison without a live
 * offer in the market answers no question a candidate of that market is asking.
 *
 * Deux origines (D-423) : une Maison qui publie sur Catwalks est un employeur
 * de l'annuaire au même titre. Quand le registre la connaît (même nom), ses
 * offres directes s'ajoutent à ses offres agrégées sous UNE ligne ; sinon elle
 * a sa ligne à elle, sans domaine ni groupe, identifiée dans l'espace `cw_`.
 */
export type CompanyRow = {
  id: string;
  name: string;
  /** Sector labels of the reviewed classification, for the "Secteur · Groupe" caption. */
  sectors: { code: string; slug: string; label: string }[];
  /** Parent group (LVMH, Kering…), when the Maison belongs to one. */
  group: string | null;
  /** The Maison's own domain, for its logo; null when no source names it (monogram). */
  domain: string | null;
  jobCount: number;
  /** Cities where this employer currently has openings in the perimeter, busiest first. */
  cities: { city: string; count: number }[];
};

export type CompaniesResult = {
  companies: CompanyRow[];
  total: number;
  /** Le curseur de la page suivante (lot 7), ou `null` quand cette page est la dernière. */
  suivant: string | null;
  perimetre: PerimetreServi;
  /** `secteur`, et `pays` quand le marché l'expose : mêmes clés, mêmes libellés que la recherche. */
  facettes: FacetteServie[];
  filtresRefuses: FiltreRefuse[];
};

export const COMPANY_PAGE_SIZE = 40;

/** D-426 — secteur et pays portent PLUSIEURS valeurs, comme sur la liste d'offres. */
export type CompanyFilters = {
  locale?: string;
  q?: string;
  secteur?: string[];
  pays?: string[];
  /** Le curseur de la page suivante, tel que la réponse précédente l'a rendu dans `suivant`. */
  apres?: string;
  marche?: string;
};

/**
 * The URL keys are French because the URL is user-visible. Shared by every
 * consumer of `/api/companies`, with the same bounds as `parseFilters`.
 */
export function parseCompanyFilters(
  params: Record<string, string | string[] | undefined>,
): CompanyFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) || undefined;
  };
  const many = (key: string): string[] | undefined => {
    const value = params[key];
    if (value === undefined) return undefined;
    const brut = Array.isArray(value) ? value : [value];
    const vues = new Set<string>();
    for (const x of brut) {
      const propre = x?.trim().slice(0, 200);
      if (propre) vues.add(propre);
      if (vues.size >= MAX_VALUES) break;
    }
    return vues.size ? [...vues] : undefined;
  };

  const pays = many('pays')?.filter((v) => v !== 'monde').map((v) => v.toUpperCase());
  const apres = params.apres;
  const jeton = (Array.isArray(apres) ? apres[0] : apres)?.trim().slice(0, CURSEUR_MAX + 1) || undefined;

  return {
    locale: one('locale'),
    q: one('q'),
    secteur: many('secteur'),
    pays: pays?.length ? pays : undefined,
    apres: jeton,
    marche: one('marche') ?? one('market'),
  };
}

export async function getCompanies(filters: CompanyFilters = {}): Promise<CompaniesResult> {
  const perimetre = exigerPerimetre(filters.marche);
  // Same contract as getJobs (decision D1): no database, no invented data — the
  // page renders the error state rather than crashing unhandled.
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    return await queryCompanies(filters, perimetre);
  } catch (error) {
    // Un curseur refusé (lot 7) est une erreur du client, jamais une base indisponible.
    if (error instanceof DatabaseUnavailableError || error instanceof CurseurInvalideError) throw error;
    throw new DatabaseUnavailableError(error);
  }
}

/** Une ligne de l'annuaire avant lecture des détails : l'employeur, ses volumes par origine. */
type Entree = {
  /** Company id when the registry knows the Maison, else `cw_<nom>`. */
  cle: string;
  companyId: string | null;
  /** Noms sous lesquels ses offres directes sont publiées (le nom de Maison du backend). */
  nomsDirects: string[];
  count: number;
};

/** L'empreinte des critères de l'annuaire : ce qui, changé, rendrait un curseur vide de sens. */
function empreinteAnnuaire(perimetre: Perimetre, filters: CompanyFilters): string {
  return empreinteCriteres({ perimetre: perimetre.code, q: filters.q?.trim() ?? '', secteur: [...(filters.secteur ?? [])].sort(), pays: [...(filters.pays ?? [])].sort() });
}

async function queryCompanies(filters: CompanyFilters, perimetre: Perimetre): Promise<CompaniesResult> {
  const empreinte = empreinteAnnuaire(perimetre, filters);
  // Lot 7 — la clé ordonnée de la dernière ligne servie : (offres, clé de ligne) ; refusée si elle vient d'autres critères.
  const curseur = filters.apres ? decoderCurseur(filters.apres, empreinte, 2) : null;
  if (curseur && (typeof curseur[0] !== 'number' || typeof curseur[1] !== 'string')) throw new CurseurInvalideError('clé');
  const locale = localeAffichage(filters.locale, perimetre);
  const langue = langueDesLibelles(locale);
  const presentation = await getSectorPresentation(langue);
  const contrat = facettesContrat(perimetre);
  const refus: FiltreRefuse[] = [];

  /*
   * Le pays est une facette DANS le périmètre : une valeur hors périmètre est
   * refusée explicitement, jamais honorée ni ignorée en silence (lot 6).
   */
  let pays: readonly string[] = perimetre.pays;
  if (filters.pays?.length) {
    const dedans = filters.pays.filter((p) => perimetre.pays.includes(p));
    const dehors = filters.pays.filter((p) => !perimetre.pays.includes(p));
    // Même règle que `planifierRecherche` : hors périmètre → refus ; dans le
    // périmètre → filtre seulement si le marché sert la facette, sinon sans effet.
    if (dehors.length) refus.push({ cle: 'pays', valeurs: dehors, motif: 'PAYS_HORS_MARCHE' });
    if (dedans.length && contrat.some((f) => f.cle === 'pays')) pays = dedans;
  }

  // Sector and search both constrain the joined Company, so they share ONE
  // `company` object — two separate spreads collided and dropped the sector.
  // Search matches the employer name OR its parent group (and group synonyms),
  // so "SMCP" reaches Sandro and Maje like it does on the offer list.
  const secteurs = filters.secteur ?? [];
  const query = filters.q?.trim();
  const companyAnd = [
    ...(secteurs.length ? [{ OR: secteurs.map((s) => sectorWhere(s)) }] : []),
    ...(query
      ? [
          {
            OR: expandCompanyTerm(query).flatMap((name) => [
              companyIdentityWhere(name, 'contains'),
              { parentGroup: { contains: name, mode: 'insensitive' as const } },
            ]),
          },
        ]
      : []),
  ];
  const company = companyAnd.length ? { AND: companyAnd } : {};
  const at = new Date();
  const jobWhere: Prisma.JobWhereInput = {
    ...publicJobWhere(at),
    countryCode: { in: [...pays] },
    ...(Object.keys(company).length ? { company } : {}),
  };
  // Les mêmes filtres sur l'origine directe : secteur par ses codes, recherche sur son nom de Maison.
  const directAnd: Prisma.DirectOfferWhereInput[] = [
    ...(secteurs.length ? [{ OR: secteurs.map((s) => sectorWhere(s)) }] : []),
    ...(query ? [{ OR: expandCompanyTerm(query).map((name) => ({ company: { contains: name, mode: 'insensitive' as const } })) }] : []),
  ];
  const directWhere: Prisma.DirectOfferWhereInput = { ...directPubliable(at), countryCode: { in: [...pays] }, ...(directAnd.length ? { AND: directAnd } : {}) };

  const [grouped, directGrouped] = await Promise.all([
    prisma.job.groupBy({ by: ['companyId'], where: jobWhere, _count: true, orderBy: { _count: { companyId: 'desc' } } }),
    prisma.directOffer.groupBy({ by: ['company'], where: directWhere, _count: true, orderBy: { _count: { company: 'desc' } } }),
  ]);
  // Une Maison directe que le registre connaît par son nom rejoint sa ligne agrégée.
  const connues = directGrouped.length
    ? await prisma.company.findMany({ where: { name: { in: directGrouped.map((r) => r.company) }, mergedIntoId: null }, select: { id: true, name: true } })
    : [];
  const idParNom = new Map(connues.map((c) => [c.name, c.id]));
  const parCle = new Map<string, Entree>(grouped.map((row) => [row.companyId, { cle: row.companyId, companyId: row.companyId, nomsDirects: [], count: row._count }]));
  for (const row of directGrouped) {
    const companyId = idParNom.get(row.company) ?? null;
    const cle = companyId ?? `${PREFIXE_DIRECT}${row.company}`;
    const avant = parCle.get(cle) ?? { cle, companyId, nomsDirects: [], count: 0 };
    parCle.set(cle, { ...avant, nomsDirects: [...avant.nomsDirects, row.company], count: avant.count + row._count });
  }
  const entrees = [...parCle.values()].sort((a, b) => b.count - a.count || a.cle.localeCompare(b.cle));

  // Lot 7 — la page reprend APRÈS la clé du curseur (offres décroissantes, clé croissante), jamais à un décalage.
  const apresCurseur = curseur
    ? entrees.filter((e) => e.count < (curseur[0] as number) || (e.count === curseur[0] && e.cle.localeCompare(curseur[1] as string) > 0))
    : entrees;
  const pageEntrees = apresCurseur.slice(0, COMPANY_PAGE_SIZE);
  const derniere = pageEntrees[pageEntrees.length - 1];
  const suivant = apresCurseur.length > COMPANY_PAGE_SIZE && derniere ? encoderCurseur(empreinte, [derniere.count, derniere.cle]) : null;
  const pageIds = pageEntrees.flatMap((e) => (e.companyId ? [e.companyId] : []));
  const pageNoms = pageEntrees.flatMap((e) => e.nomsDirects);

  const [companies, cityRows, directCityRows, directSecteurs] = await Promise.all([
    prisma.company.findMany({
      where: { id: { in: pageIds } },
      select: { id: true, name: true, sectorCodes: true, parentGroup: true, domain: true },
    }),
    // One grouped query for every city of every company on this page, rather
    // than a query per company.
    prisma.job.groupBy({
      by: ['companyId', 'city'],
      where: { ...jobWhere, companyId: { in: pageIds }, city: { not: null } },
      _count: true,
    }),
    pageNoms.length
      ? prisma.directOffer.groupBy({ by: ['company', 'city'], where: { ...directWhere, company: { in: pageNoms }, city: { not: null } }, _count: true })
      : [],
    pageNoms.length
      ? prisma.directOffer.findMany({ where: { ...directWhere, company: { in: pageNoms } }, select: { company: true, sectorCodes: true }, distinct: ['company', 'sectorCodes'] })
      : [],
  ]);

  const byCompany = new Map(companies.map((company) => [company.id, company]));
  const cleDuNom = (nom: string) => idParNom.get(nom) ?? `${PREFIXE_DIRECT}${nom}`;
  const villes = new Map<string, Map<string, number>>();
  const ajouterVille = (cle: string, city: string | null, n: number) => {
    if (!city) return;
    const liste = villes.get(cle) ?? new Map<string, number>();
    liste.set(city, (liste.get(city) ?? 0) + n);
    villes.set(cle, liste);
  };
  for (const row of cityRows) ajouterVille(row.companyId, row.city, row._count);
  for (const row of directCityRows) ajouterVille(cleDuNom(row.company), row.city, row._count);
  const codesDirects = new Map<string, Set<string>>();
  for (const o of directSecteurs) {
    const codes = codesDirects.get(cleDuNom(o.company)) ?? new Set<string>();
    for (const code of o.sectorCodes) codes.add(code);
    codesDirects.set(cleDuNom(o.company), codes);
  }

  const rows: CompanyRow[] = pageEntrees
    .map((entree): CompanyRow => {
      const company = entree.companyId ? byCompany.get(entree.companyId) : undefined;
      const codes = new Set([...(company?.sectorCodes ?? []), ...(codesDirects.get(entree.cle) ?? [])]);
      return {
        id: entree.companyId ?? `${PREFIXE_DIRECT}${companySlug(entree.nomsDirects[0])}`,
        name: company?.name ?? entree.nomsDirects[0] ?? '—',
        sectors: presentation.sectors.filter((s) => codes.has(s.code)),
        group: company?.parentGroup ?? null,
        domain: company?.domain ?? null,
        jobCount: entree.count,
        cities: [...(villes.get(entree.cle) ?? [])].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)),
      };
    })
    // groupBy cannot order by the joined name, so ties are settled here.
    .sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name, 'fr'));

  /*
   * Les facettes de l'annuaire suivent le contrat de la recherche : les comptes
   * de `secteur` excluent la sélection de secteur, ceux de `pays` excluent la
   * sélection de pays (D-426, union dans une dimension) — deux origines.
   */
  const sansSecteur: Prisma.JobWhereInput = { ...publicJobWhere(at), countryCode: { in: [...pays] },
    ...(query ? { company: { AND: companyAnd.slice(secteurs.length ? 1 : 0) } } : {}) };
  const sansPays: Prisma.JobWhereInput = { ...publicJobWhere(at), countryCode: { in: [...perimetre.pays] },
    ...(Object.keys(company).length ? { company } : {}) };
  const directSansPays: Prisma.DirectOfferWhereInput = { ...directPubliable(at), countryCode: { in: [...perimetre.pays] },
    ...(directAnd.length ? { AND: directAnd } : {}) };
  const [sectorRows, countryRows, directCountryRows, directSectorRows] = await Promise.all([
    prisma.job.groupBy({ by: ['companyId'], where: sansSecteur, _count: true }),
    prisma.job.groupBy({ by: ['countryCode'], where: { ...sansPays, countryCode: { in: [...perimetre.pays] } }, _count: true }),
    prisma.directOffer.groupBy({ by: ['countryCode'], where: directSansPays, _count: true }),
    prisma.$queryRaw<{ code: string; n: number }[]>(Prisma.sql`
      SELECT code, count(*)::int AS n FROM "DirectOffer" d
      CROSS JOIN LATERAL unnest(CASE WHEN cardinality(d."sectorCodes") = 0 THEN ARRAY['unclassified'] ELSE d."sectorCodes" END) code
      WHERE ${directPubliableSql(Prisma.sql`d`, at)} AND d."countryCode" IN (${Prisma.join(pays.map((p) => Prisma.sql`${p}`))})
        ${query ? Prisma.sql`AND (${Prisma.join(expandCompanyTerm(query).map((name) => Prisma.sql`d.company ILIKE ${`%${echapperLike(name)}%`}`), ' OR ')})` : Prisma.empty}
      GROUP BY code`),
  ]);
  const sectorCompanies = await prisma.company.findMany({
    where: { id: { in: sectorRows.map((row) => row.companyId) } },
    select: { id: true, sectorCodes: true },
  });
  const sectorById = new Map(sectorCompanies.map((company) => [company.id, company.sectorCodes]));
  const sectorCounts = new Map<string, number>();
  for (const row of sectorRows) {
    const codes = sectorById.get(row.companyId) ?? [];
    for (const sector of codes.length ? codes : ['unclassified']) sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + row._count);
  }
  for (const row of directSectorRows) sectorCounts.set(row.code, (sectorCounts.get(row.code) ?? 0) + row.n);
  const paysCounts = new Map<string, number>();
  for (const row of [...countryRows, ...directCountryRows]) {
    if (row.countryCode) paysCounts.set(row.countryCode, (paysCounts.get(row.countryCode) ?? 0) + row._count);
  }
  const nomsPays = (() => {
    try {
      // La locale SERVIE, pas la locale cible : un marché en repli rend sa page en anglais, noms
      // de pays compris. Voir `localeServie` dans le registre.
      return new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
    } catch {
      return null;
    }
  })();

  /* Le type d'interaction vient du registre, comme pour la recherche d'offres. */
  const typesFiltre = new Map(filtresDuMarche(perimetre).map((f) => [f.cle, f.type]));
  const facettes: FacetteServie[] = contrat.flatMap(({ cle, libelle: natif }): FacetteServie[] => {
    const libelle = nomFacette(cle, natif, perimetre, locale);
    const type = typesFiltre.get(cle) ?? TYPE_FILTRE_PAR_DEFAUT[cle];
    if (cle === 'secteur') return [{ cle, libelle, type, options: [...sectorCounts.entries()]
      .map(([value, count]) => ({ value, count, label: presentation.labels[value] ?? libelleInconnu(langue, 'secteur') }))
      .filter((o) => o.count > 0).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)) }];
    if (cle === 'pays') return [{ cle, libelle, type, options: [...paysCounts.entries()]
      .map(([value, count]) => ({ value, count, label: nomsPays?.of(value) ?? value }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)) }];
    return [];
  });

  return {
    companies: rows,
    total: entrees.length,
    suivant,
    perimetre: perimetreServi(perimetre),
    facettes,
    filtresRefuses: refus,
  };
}
