import { createIntentResolver, searchWords, type SearchCompany, type SearchIntent } from './search-intent';
import { formesDeBase, lexiqueDe, replierRequete } from '@catwalks/db/search-comprendre';
import { searchEvidence } from './search-evidence';
import { searchConcepts } from './search-vocabulary';
import { languesDuVocabulaire } from './search-langues';
import type { OccupationManifest } from '@catwalks/db/occupations';

export type Company = { id: string; name: string; parentGroup: string | null; parentGroupId: string | null; mergedIntoId: string | null; sectorCodes: string[] };
export type SnapshotMetadata = {
  asOf: string;
  occupationRelease: { id: string; manifest: OccupationManifest };
  companies: Company[];
  aliases: { companyId: string; displayName: string; reviewId: string }[];
  sectorConcepts: { code: string; labels: Record<string, string> }[];
};
export type NativeJob = {
  id: string; title: string; rawTitle?: string; companyId?: string; company?: string;
  description?: string; countryCode: string | null; city?: string; location?: string;
  department?: string; occupationCode?: string; jobFunction?: string;
  /** Les métiers lus dans l'intitulé, écrits par l'agrégateur avec la classification (D-475 point 38). */
  titleRoles?: string[];
  sectorCodes?: string[]; postedAt?: string; firstSeenAt?: string; receivedAt?: string;
  employmentTerm?: string; workTime?: string; programType?: string; language?: string;
  /** A direct offer's indexed text, written by the aggregator's projection (`texteRecherche`): it carries the
   * offer's univers as sector words (D-455), which no other served field holds. */
  searchText?: string;
};
export type SearchDocument = {
  id: string; origin: number; country: string | null; city: string;
  title: string; company: string; body: string; duties: string;
  titleRoles: string[]; roles: string[]; families: string[]; sectors: string[]; companyKeys: string[];
  postedAt: number; firstSeenAt: number;
  occupationCode: string | null; employmentTerm: string | null; workTime: string | null;
  programType: string | null; language: string | null;
};
const normalized = (s: string | null | undefined) => searchWords(s ?? '').join(' ');

export function snapshotModel(metadata: SnapshotMetadata) {
  const concepts = searchConcepts(metadata.occupationRelease.manifest, metadata.sectorConcepts);
  const roleFamilies = new Map(metadata.occupationRelease.manifest.occupations.map(o => [o.key, o.family]));
  const companies = new Map(metadata.companies.map(c => [c.id, c]));
  const names: SearchCompany[] = metadata.companies.filter(c => !c.mergedIntoId).map(c => ({
    id: c.id, names: [c.name, ...metadata.aliases.filter(a => a.companyId === c.id && a.reviewId).map(a => a.displayName),
      ...metadata.companies.filter(old => old.mergedIntoId === c.id).map(old => old.name)],
  }));
  // A group query reaches its known members; a brand query never expands to
  // every sister brand or to the whole parent catalogue.
  const groups = [...new Set(metadata.companies.flatMap(c => c.parentGroup ? [c.parentGroup] : []))];
  for (const name of groups) {
    if (!names.some(c => c.names.some(n => normalized(n) === normalized(name)))) names.push({ id: `group:${normalized(name)}`, names: [name] });
  }
  const resolver = createIntentResolver(concepts, names);
  // Employer aliases affect queries, never the role inferred from a native title.
  const nativeResolver = createIntentResolver(concepts, []);
  // D-488 : une recherche par métier ne porte que les variantes des langues du marché (`search-langues.ts`).
  const langues = languesDuVocabulaire(metadata.occupationRelease.manifest);
  // D-500 (Q1) : le résolveur des requêtes du contrat 2, qui reconnaît aussi une variante sans ses mots de liaison ; et le
  // lexique des métiers et des familles, qui borne les formes de base d'un mot tapé seul.
  const resolverCompris = createIntentResolver(concepts, names, { liaisonsFacultatives: true });
  const lexique = lexiqueDe(concepts.filter((c) => c.kind !== 'sector').flatMap((c) => c.aliases));
  /** D-500 (Q1, cahier §3.2) : la requête comprise. Repliée (écriture inclusive, marques de genre), lue avec les liaisons
   * facultatives ; un mot resté libre cherche aussi ses formes de base que le vocabulaire connaît (« conseillère » →
   * « conseiller », « vendeuses » → « vendeuse », « vendeur »). Une requête faite de seules marques reste lue telle quelle. */
  const comprendre = (q: string): SearchIntent => {
    const repliee = replierRequete(q);
    const intent = resolverCompris.resolve(searchWords(repliee).length ? repliee : q);
    // Une requête repliée en un seul métier garde aussi sa forme tapée comme expression : une offre sans métier dont
    // l'intitulé l'écrit telle quelle (« Conseiller(ère) de vente ») reste trouvée, comme par la lecture d'avant.
    const tapee = searchWords(q).join(' ');
    const seulMetier = intent.clauses.length === 1 && intent.clauses[0].kind === 'role' && repliee !== q && tapee;
    return { ...intent, original: q, clauses: intent.clauses.map((c) => {
      if (seulMetier && c.kind === 'role' && !c.phrases.includes(tapee)) return { ...c, phrases: [...c.phrases, tapee] };
      if (c.kind !== 'text' || c.phrases.length !== 1) return c;
      const bases = formesDeBase(c.phrases[0]).filter((f) => lexique.has(f));
      return bases.length ? { ...c, phrases: [c.phrases[0], ...bases] } : c;
    }) };
  };
  return { resolver, resolverCompris, concepts, names, langues, manifest: metadata.occupationRelease.manifest,
    /** L'intention d'une requête, lue par le résolveur puis restreinte aux langues du marché (sans marché : entière).
     * `comprendre` (contrat 2, D-500) : la requête comprise ; sans lui, la lecture d'avant, à l'identique. */
    intention(q: string, marche: { readonly locales: readonly string[] } | undefined, options: { comprendre?: boolean } = {}) {
      return langues.restreindre(options.comprendre ? comprendre(q) : resolver.resolve(q), marche);
    },
    document(j: NativeJob, direct = false): SearchDocument {
      const matchingNames = direct ? names.filter(n => n.names.some(name => normalized(name) === normalized(j.company))) : [];
      const c = j.companyId ? companies.get(j.companyId) : matchingNames.length === 1 ? companies.get(matchingNames[0].id) : undefined;
      const titleConcepts = nativeResolver.titleConcepts(j.rawTitle || j.title);
      const evidence = searchEvidence(j.description);
      // D-475 point 38 (sous-lot 2B-4) : les métiers de l'offre sont ceux de ses colonnes, son code et ses métiers lus
      // dans l'intitulé (`titleRoles`, packages/db/occupation-title-roles.ts : expressions vérifiées, jamais sous un mot
      // d'encadrement). Relire ici tout le vocabulaire était faux pour 18,5 % des offres où la lecture ajoutait un
      // métier, et faisait passer ce métier devant le code du moteur (« Responsable vendeur » indexé Conseiller de vente).
      // Sans aucun des deux, le texte de l'intitulé reste cherchable (`search-sql.ts`).
      const titleRoles = [...new Set(j.titleRoles ?? [])].sort();
      const roles = [...new Set([...(j.occupationCode ? [j.occupationCode] : []), ...titleRoles])];
      const parent = c?.parentGroupId || (c?.parentGroup && names.find(n => n.names.some(x => normalized(x) === normalized(c.parentGroup)))?.id);
      return {
        id: direct ? `cw_${j.id}` : j.id, origin: direct ? 0 : 1, country: j.countryCode,
        city: normalized(j.city), title: normalized(j.rawTitle || j.title), company: normalized([c?.name || j.company, evidence.affiliations].filter(Boolean).join(' ')), duties: normalized(evidence.duties),
        body: normalized([j.description?.replace(/<[^>]*>/g, ' '), j.department, j.city, j.location, j.employmentTerm, direct ? j.searchText : undefined].filter(Boolean).join(' ')),
        titleRoles, roles, families: [...new Set([...roles.map(r => roleFamilies.get(r)).filter((f): f is string => !!f),
          ...(j.jobFunction ? [j.jobFunction] : titleConcepts.families)])],
        sectors: direct ? j.sectorCodes ?? [] : c?.sectorCodes ?? [], companyKeys: [c?.id, parent].filter((x): x is string => !!x),
        postedAt: j.postedAt ? Date.parse(j.postedAt) : -1e15,
        firstSeenAt: Date.parse(j.firstSeenAt || j.receivedAt || metadata.asOf),
        occupationCode: j.occupationCode ?? null, employmentTerm: j.employmentTerm ?? null,
        workTime: j.workTime ?? null, programType: j.programType ?? null, language: j.language ?? null,
      };
    },
  };
}
