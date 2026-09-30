import type { AccessScope } from './accessScope.js';

/**
 * Dérivation d'un périmètre d'accès HTTP public depuis les requêtes RÉELLEMENT observées pendant une collecte de
 * qualification (campagne F3). La décision n'invente aucune origine, aucun chemin, aucune méthode ; elle déclare ce
 * qui a été vu, et un répertoire d'offres par son préfixe. Cinq règles, dans cet ordre :
 *
 *   1. chaque chemin observé est un périmètre EXACT (origine, chemin, méthodes, contrat de requête) ; deux périmètres
 *      ne se regroupent jamais s'ils ne partagent pas la même origine ET le même ensemble de méthodes : un point
 *      d'entrée POST (la recherche Workday, l'API DigitalRecruiters) reste déclaré tel quel, jamais absorbé dans le
 *      préfixe GET des pages d'offres ;
 *   2. deux chemins frères ou plus sous un même répertoire (jamais la racine) sont déclarés par ce répertoire, en
 *      PRÉFIXE, même sous le budget : un chemin par offre (`/postings/{id}`, `/job/{slug}`) n'est pas un périmètre,
 *      et une décision qui énumérerait les identifiants d'aujourd'hui refuserait la première offre de demain ;
 *      2 bis. deux chemins ou plus, chacun seul dans son répertoire, à la même profondeur sous un même grand-parent
 *      (jamais la racine), sont déclarés par ce grand-parent (`mergeCousins`, 29/09/2026) ;
 *      2 ter. les chemins exacts restants d'au moins trois niveaux, deux ou plus sous un même premier répertoire,
 *      sont déclarés par leur plus long répertoire commun ; une offre isolée sur son origine l'est par le répertoire
 *      que cette règle déclare, au même niveau, sur une autre origine de la source (`mergeUnderCommonDirectory`,
 *      30/09/2026) ;
 *   3. un préfixe absorbe tout périmètre de sa famille qu'il couvre (chemin exact ou préfixe plus long, méthodes
 *      comprises dans les siennes) : deux périmètres qui se recouvrent sont une ambiguïté, et `matchingAccessScope`
 *      la refuse. Les vagues définitives F3b l'ont montré : Workday sert des offres avec et sans segment de lieu
 *      (`/job/{lieu}/{slug}` et `/job/{slug}`), DigitalRecruiters intercale parfois un identifiant de site
 *      (`/fr/annonce/{site}/{id}-{slug}`), TalentView un répertoire de campagnes sous celui de la société ;
 *   4. tant que la liste dépasse le budget de `parseAccessScopes` (64), seuls les périmètres LES PLUS PROFONDS de
 *      l'origine la plus peuplée remontent d'un répertoire, chemin isolé compris (SuccessFactors loge chaque offre
 *      dans son propre répertoire `/job/{lieu}/{titre}/{id}`, qu'aucun frère ne regroupe), jamais jusqu'à la
 *      racine, jamais une autre origine, jamais un point d'entrée moins profond. Au-delà, le motif est nommé
 *      (`ACCESS_SCOPE_BUDGET`) plutôt qu'un refus opaque ;
 *   5. la surface déclarée vient du type de contenu servi et de la famille (JSON d'un éditeur ATS = API d'offres ATS,
 *      HTML = page ATS ou page officielle, XML nommé sitemap = plan de site) ; pour un périmètre qui mêle plusieurs
 *      types, la surface majoritaire, à égalité dans un ordre fixe, jamais l'ordre d'arrivée des captures.
 *
 * Ce que la règle 2 et la règle 4 couvrent au-delà de l'observé est nommé dans l'énoncé de la décision : un préfixe
 * couvre les entrées futures de son répertoire, rien d'autre ; le nombre de remontées est rendu avec les périmètres.
 */
export type ObservedRequest = { method: string; url: URL; contentType: string };
export type ScopeDerivation = { exact: number; prefix: number; climbs: number; origins: number };

export const ACCESS_SCOPE_BUDGET = 64;

export class AccessScopeBudgetError extends Error {
  readonly code = 'ACCESS_SCOPE_BUDGET';
  constructor(count: number, origins: string[]) {
    super(`ACCESS_SCOPE_BUDGET: ${count} périmètres observés, non regroupables sans élargir à la racine (${origins.join(', ')})`);
    this.name = 'AccessScopeBudgetError';
  }
}

/** Familles servies par un éditeur ATS : leurs réponses JSON sont une API d'offres ATS, leur HTML une page ATS. */
export const ATS_KINDS = new Set(['teamtailor', 'ashby', 'recruitee', 'workday', 'greenhouse', 'lever', 'personio', 'smartrecruiters-whitelabel',
  'smartrecruiters', 'successfactors', 'digitalrecruiters', 'workable', 'talentrecruiter', 'talentsoft', 'flatchr', 'talentview', 'phenom', 'jibe']);

/** Ordre fixe de départage quand un périmètre mêle plusieurs surfaces à égalité. */
const SURFACE_ORDER: AccessScope['surface'][] = ['PUBLIC_ATS_JOB_API', 'PUBLIC_PORTAL_JSON', 'PUBLIC_ATS_HTML', 'PUBLIC_OFFICIAL_HTML', 'PUBLIC_SITEMAP', 'PUBLIC_XML_OR_RSS'];

function surfaceOfType(kind: string, path: string, contentType: string): AccessScope['surface'] {
  const type = contentType.toLowerCase();
  if (/xml|rss|atom/.test(type)) return /sitemap/i.test(path) ? 'PUBLIC_SITEMAP' : 'PUBLIC_XML_OR_RSS';
  if (/json/.test(type)) return ATS_KINDS.has(kind) ? 'PUBLIC_ATS_JOB_API' : 'PUBLIC_PORTAL_JSON';
  if (/html/.test(type)) return ATS_KINDS.has(kind) ? 'PUBLIC_ATS_HTML' : 'PUBLIC_OFFICIAL_HTML';
  return ATS_KINDS.has(kind) ? 'PUBLIC_ATS_JOB_API' : 'PUBLIC_PORTAL_JSON';
}

/** La surface majoritaire des types de contenu observés (règle 5) ; indépendante de l'ordre des observations. */
export function observedSurface(kind: string, path: string, contentTypes: string[]): AccessScope['surface'] {
  const votes = new Map<AccessScope['surface'], number>();
  for (const type of contentTypes.length ? contentTypes : ['']) {
    const surface = surfaceOfType(kind, path, type);
    votes.set(surface, (votes.get(surface) ?? 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1] || SURFACE_ORDER.indexOf(a[0]) - SURFACE_ORDER.indexOf(b[0]))[0][0];
}

type Node = { origin: string; path: string; prefix: boolean; methods: string[]; members: ObservedRequest[] };

/** Le répertoire d'un chemin : `/a/b/c` → `/a/b/`, `/a/b/` → `/a/`, `/a` → `/`. */
export function parentDirectory(path: string): string {
  return path.endsWith('/') ? path.replace(/[^/]+\/$/, '') : path.replace(/[^/]*$/, '');
}

const depthOf = (path: string) => path.split('/').length - (path.endsWith('/') ? 2 : 1);
const methodsOf = (members: ObservedRequest[]) => [...new Set(members.map(member => member.method))].sort();
const familyOf = (node: Node) => `${node.origin} ${node.methods.join('/')}`;
const signature = (nodes: Node[]) => nodes.map(node => `${node.prefix ? 'P' : 'E'}${familyOf(node)}${node.path}`).sort().join('\n');

function merged(members: Node[], path: string): Node {
  const requests = members.flatMap(member => member.members);
  return { origin: members[0].origin, path, prefix: true, methods: methodsOf(requests), members: requests };
}

/** Règle 2 : les frères d'une même famille sous un même répertoire (jamais la racine) deviennent ce répertoire. */
function mergeSiblings(nodes: Node[]): Node[] {
  const byParent = new Map<string, Node[]>();
  for (const node of nodes) {
    const key = `${familyOf(node)} ${parentDirectory(node.path)}`;
    byParent.set(key, [...(byParent.get(key) ?? []), node]);
  }
  return [...byParent.entries()].flatMap(([, members]) => {
    const parent = parentDirectory(members[0].path);
    return parent === '/' || members.length < 2 ? members : [merged(members, parent)];
  });
}

/**
 * Règle 2 bis (29/09/2026) : une offre logée dans SON PROPRE répertoire (`/jobs/job/{titre}/{id}` chez Selfridges,
 * `/job/{lieu}/{offre}` chez Workday quand un lieu n'a qu'une offre) n'a pas de frère, et la règle 2 l'énumérait :
 * l'offre publiée le lendemain sortait du périmètre et arrêtait la source. Deux chemins exacts ou plus de la même
 * famille, chacun seul dans son répertoire, à la même profondeur et sous un même grand-parent (jamais la racine), sont
 * déclarés par ce grand-parent, en PRÉFIXE — un niveau, comme deux frères le sont par leur parent.
 */
function mergeCousins(nodes: Node[]): Node[] {
  const perParent = new Map<string, number>();
  for (const node of nodes) {
    const key = `${familyOf(node)} ${parentDirectory(node.path)}`;
    perParent.set(key, (perParent.get(key) ?? 0) + 1);
  }
  const lone = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.prefix || perParent.get(`${familyOf(node)} ${parentDirectory(node.path)}`) !== 1) continue;
    const grand = parentDirectory(parentDirectory(node.path));
    if (grand === '/' || grand === '') continue;
    const key = `${familyOf(node)} ${grand} ${depthOf(node.path)}`;
    lone.set(key, [...(lone.get(key) ?? []), node]);
  }
  const groups = [...lone.values()].filter(members => members.length >= 2);
  const absorbed = new Set(groups.flat());
  return [...nodes.filter(node => !absorbed.has(node)), ...groups.map(members => merged(members, parentDirectory(parentDirectory(members[0].path))))];
}

/** Le premier répertoire d'un chemin (`/jobs/1/a/job` → `/jobs/`), absent pour un chemin à la racine. */
const topDirectory = (path: string) => /^\/[^/]+\//.exec(path)?.[0];

/** Le plus long répertoire commun à des répertoires (`/a/b/c/` et `/a/b/d/` → `/a/b/`). */
function commonDirectory(directories: string[]): string {
  const parts = directories.map(directory => directory.split('/').slice(1, -1));
  const common: string[] = [];
  for (let i = 0; parts.every(segments => i < segments.length && segments[i] === parts[0][i]); i++) common.push(parts[0][i]);
  return `/${common.map(segment => `${segment}/`).join('')}`;
}

/**
 * Règle 2 ter (30/09/2026) : une offre dont le chemin porte son identifiant ET son titre, chacun dans un répertoire
 * (`/jobs/{id}/{titre}/job` chez iCIMS, `/job/{ville}/{titre}/{tenant}/{id}` chez Radancy), n'a ni frère ni cousin :
 * chaque offre a son propre grand-parent. Les règles 2 et 2 bis l'énuméraient en EXACT (urbn-hub : 30 fiches EXACTES
 * sur `homeoffice-eu-urbn.icims.com` dans l'autorisation du 30/09 à 09:16), et l'offre publiée ensuite arrêtait la source
 * au RUN du soir (ACCESS_SCOPE à 18:04). Deux chemins exacts ou plus d'une même famille, d'au moins trois niveaux, sous
 * un même PREMIER répertoire (jamais la racine), sont déclarés par leur plus long répertoire commun, en PRÉFIXE. Borne :
 * jamais au-dessus du premier répertoire que partagent au moins deux offres observées.
 *
 * Une origine qui n'a qu'une offre ce jour-là (`supplychain-eu-urbn.icims.com` : une fiche) la garde en EXACT, sauf
 * si ce même répertoire, à la même profondeur, est déclaré par cette règle sur une AUTRE origine de la même source et
 * aux mêmes méthodes : c'est alors le même gabarit d'éditeur, et l'offre isolée est déclarée par ce répertoire sur sa
 * propre origine (`/jobs/`), jamais au-delà.
 */
function mergeUnderCommonDirectory(nodes: Node[]): Node[] {
  const groups = new Map<string, Node[]>();
  for (const node of nodes) {
    const top = topDirectory(node.path);
    if (node.prefix || !top || depthOf(node.path) < 3) continue;
    const key = `${familyOf(node)} ${top}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const absorbed = new Set<Node>(); const declared: { methods: string; path: string; depths: Set<number>; origin: string }[] = [];
  const result: Node[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const path = commonDirectory(members.map(member => parentDirectory(member.path)));
    result.push(merged(members, path)); members.forEach(member => absorbed.add(member));
    declared.push({ methods: members[0].methods.join('/'), path, depths: new Set(members.map(member => depthOf(member.path))), origin: members[0].origin });
  }
  for (const members of groups.values()) {
    if (members.length !== 1) continue;
    const [node] = members;
    const template = declared.filter(scope => scope.origin !== node.origin && scope.methods === node.methods.join('/') &&
      scope.depths.has(depthOf(node.path)) && node.path.startsWith(scope.path)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!template) continue;
    result.push(merged([node], template.path)); absorbed.add(node);
  }
  return [...nodes.filter(node => !absorbed.has(node)), ...result];
}

/** Règle 3 : un préfixe absorbe, dans sa famille ou une famille aux méthodes comprises dans les siennes, ce qu'il couvre. */
function absorbCovered(nodes: Node[]): Node[] {
  let result = [...nodes];
  for (const prefix of nodes.filter(node => node.prefix).sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))) {
    if (!result.includes(prefix)) continue;
    const covered = result.filter(node => node !== prefix && node.origin === prefix.origin && node.path.startsWith(prefix.path) &&
      node.methods.every(method => prefix.methods.includes(method)));
    if (!covered.length) continue;
    result = result.filter(node => node !== prefix && !covered.includes(node))
      .concat({ ...merged([prefix, ...covered], prefix.path), methods: prefix.methods });
  }
  return result;
}

/** Règle 4 : les périmètres les plus profonds de l'origine la plus peuplée remontent d'un répertoire ; `null` si aucun ne le peut. */
function climbDeepest(nodes: Node[]): Node[] | null {
  const population = new Map<string, number>();
  for (const node of nodes) population.set(node.origin, (population.get(node.origin) ?? 0) + 1);
  const origin = [...population.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const candidates = nodes.filter(node => node.origin === origin && parentDirectory(node.path) !== '/');
  if (!candidates.length) return null;
  const deepest = Math.max(...candidates.map(node => depthOf(node.path)));
  const climbing = candidates.filter(node => depthOf(node.path) === deepest);
  const byParent = new Map<string, Node[]>();
  for (const node of climbing) {
    const key = `${familyOf(node)} ${parentDirectory(node.path)}`;
    byParent.set(key, [...(byParent.get(key) ?? []), node]);
  }
  const climbed = [...byParent.values()].map(members => merged(members, parentDirectory(members[0].path)));
  return absorbCovered([...nodes.filter(node => !climbing.includes(node)), ...climbed]);
}

function scopeOf(kind: string, node: Node): AccessScope {
  const fixed: Record<string, string> = {}; const variable: string[] = [];
  const values = new Map<string, Set<string>>();
  for (const request of node.members) {
    for (const [key, value] of request.url.searchParams) values.set(key, new Set([...(values.get(key) ?? []), value]));
  }
  for (const [key, seen] of values) {
    if (seen.size === 1 && node.members.every(request => request.url.searchParams.has(key))) fixed[key] = [...seen][0];
    else variable.push(key);
  }
  return {
    origin: node.origin,
    path: node.prefix ? { kind: 'PREFIX', value: node.path } : { kind: 'EXACT', value: node.path },
    methods: node.methods as AccessScope['methods'],
    query: { fixed, variable },
    surface: observedSurface(kind, node.path, node.members.map(request => request.contentType)),
  };
}

/** Les périmètres dérivés et le compte de ce que la dérivation a fait (exacts, préfixes, remontées, origines). */
export function deriveAccessScopeDocument(kind: string, requests: readonly ObservedRequest[], budget = ACCESS_SCOPE_BUDGET): { scopes: AccessScope[]; derivation: ScopeDerivation } {
  if (!requests.length) throw new Error('ACCESS_JOURNAL: aucune requête observée');
  const exact = new Map<string, Node>();
  for (const request of requests) {
    const key = `${request.url.origin}${request.url.pathname}`;
    const node = exact.get(key) ?? { origin: request.url.origin, path: request.url.pathname, prefix: false, methods: [], members: [] };
    node.members.push(request); exact.set(key, node);
  }
  for (const node of exact.values()) node.methods = methodsOf(node.members);
  let nodes = absorbCovered(mergeUnderCommonDirectory(mergeCousins(mergeSiblings([...exact.values()]))));
  let climbs = 0;
  while (nodes.length > budget) {
    const climbed = climbDeepest(nodes);
    if (!climbed || signature(climbed) === signature(nodes)) break;
    nodes = climbed; climbs++;
  }
  if (nodes.length > budget) throw new AccessScopeBudgetError(nodes.length, [...new Set(nodes.map(node => node.origin))].sort());
  const sorted = [...nodes].sort((a, b) => a.origin.localeCompare(b.origin) || a.path.localeCompare(b.path) || a.methods.join('/').localeCompare(b.methods.join('/')));
  return {
    scopes: sorted.map(node => scopeOf(kind, node)),
    derivation: { exact: sorted.filter(node => !node.prefix).length, prefix: sorted.filter(node => node.prefix).length, climbs, origins: new Set(sorted.map(node => node.origin)).size },
  };
}

/** Les périmètres d'accès dérivés des requêtes observées d'une collecte, sous le budget de la liste bornée. */
export function deriveAccessScopes(kind: string, requests: readonly ObservedRequest[], budget = ACCESS_SCOPE_BUDGET): AccessScope[] {
  return deriveAccessScopeDocument(kind, requests, budget).scopes;
}
