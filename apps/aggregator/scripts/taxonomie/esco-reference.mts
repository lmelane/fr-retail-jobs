/**
 * RÉFÉRENCE ESCO DATÉE (D-475 lot 2, sous-lot 2A ; plan `docs/architecture/classification-metiers.md` §3.1).
 *
 * L'ESCO est l'amorce et la référence de la machine, jamais affiché tel quel (D-475 §29). Ce script télécharge une
 * version PUBLIÉE et fixe de la classification (`selectedVersion`), complète, et l'écrit compressée avec son empreinte :
 * `data/reference/esco-<version>.json.gz`.
 *
 * Complétude prouvée, pas supposée : la liste des métiers vient de la recherche de l'API (qui annonce son total), puis
 * chaque fiche est lue par son URI — ce qui contourne le défaut de certaines pages de la liste (« More than one value
 * found for field 'hasSkillType' », mesuré le 28/09/2026) qui avait fait perdre une centaine de métiers au premier
 * téléchargement de la preuve du pivot. Les groupes ISCO sont lus depuis les liens des métiers, puis remontés jusqu'à la
 * racine. Le script échoue si un métier annoncé manque.
 *
 * Aucune donnée Catwalks n'est lue ni envoyée. ESCO © Union européenne, réutilisation autorisée avec mention de la source
 * (décision 2011/833/UE) ; la mention est portée dans le fichier.
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/esco-reference.mts [--version=v1.2.1]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const VERSION = process.argv.find((a) => a.startsWith('--version='))?.split('=')[1] ?? 'v1.2.1';
const API = 'https://ec.europa.eu/esco/api';
const SORTIE = fileURLToPath(new URL(`../../data/reference/esco-${VERSION}.json.gz`, import.meta.url));
const PARALLELE = 6;

type Fiche = Record<string, unknown> & {
  uri: string; code?: string; status?: string;
  preferredLabel?: Record<string, string>; alternativeLabel?: Record<string, string[]>;
  hiddenLabel?: Record<string, string[]>; description?: Record<string, { literal?: string }>;
  _links?: Record<string, { uri: string; code?: string }[] | undefined>;
};

// Reprise : les fiches déjà lues sont gardées dans un cache local (dossier `scratchpad/`, ignoré par git).
const CACHE = fileURLToPath(new URL(`../../../../scratchpad/esco-${VERSION}-cache.json`, import.meta.url));
const cache: Record<string, unknown> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let nonSauves = 0;
const sauver = () => { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(cache)); nonSauves = 0; };

async function lire<T>(url: string): Promise<T> {
  if (cache[url]) return cache[url] as T;
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = (await r.json()) as T;
        cache[url] = j;
        if (++nonSauves >= 200) sauver();
        return j;
      }
      if (essai >= 8) throw new Error(`ESCO ${r.status} ${url} : ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      // Coupure réseau (ECONNRESET, délai) : on réessaie ; une erreur HTTP persistante remonte.
      if (essai >= 8 || (e instanceof Error && e.message.startsWith('ESCO '))) throw e;
    }
    await new Promise((ok) => setTimeout(ok, 1500 * essai));
  }
}

async function enParallele<A, B>(entrees: A[], f: (a: A) => Promise<B>): Promise<B[]> {
  const sorties: B[] = new Array(entrees.length);
  let suivant = 0;
  await Promise.all(Array.from({ length: PARALLELE }, async () => {
    while (suivant < entrees.length) {
      const i = suivant++;
      sorties[i] = await f(entrees[i]);
    }
  }));
  return sorties;
}

// 1. La liste annoncée des métiers (l'`offset` de l'API est un NUMÉRO DE PAGE, vérifié).
type Page = { total: number; _embedded?: { results?: { uri: string }[] } };
const premiere = await lire<Page>(`${API}/search?type=occupation&language=en&selectedVersion=${VERSION}&limit=100&offset=0&full=false`);
const annonces = premiere.total;
const uris: string[] = [];
for (let page = 0; page * 100 < annonces; page++) {
  const p = page === 0 ? premiere : await lire<Page>(`${API}/search?type=occupation&language=en&selectedVersion=${VERSION}&limit=100&offset=${page}&full=false`);
  uris.push(...(p._embedded?.results ?? []).map((r) => r.uri));
}
const uniques = [...new Set(uris)];
if (uniques.length !== annonces) throw new Error(`liste incomplète : ${uniques.length} URI distinctes pour ${annonces} annoncées`);

// 2. Chaque fiche, par son URI.
const liens = (f: Fiche, cle: string) => (f._links?.[cle] ?? []).map((l) => l.uri);
const metiers = await enParallele(uniques, async (uri) => {
  const f = await lire<Fiche>(`${API}/resource/occupation?uri=${encodeURIComponent(uri)}&selectedVersion=${VERSION}`);
  return {
    uri: f.uri, code: f.code ?? null, statut: f.status ?? null,
    libelles: f.preferredLabel ?? {}, synonymes: f.alternativeLabel ?? {}, caches: f.hiddenLabel ?? {},
    // Descriptions en français et en anglais seulement : elles aident le modèle à trancher ; les 28 langues triplaient
    // le fichier (17 Mo compressé mesuré le 28/09/2026). Libellés et synonymes restent dans toutes les langues.
    description: Object.fromEntries(Object.entries(f.description ?? {}).filter(([l]) => l === 'fr' || l === 'en').map(([l, d]) => [l, d?.literal ?? ''])),
    parents: liens(f, 'broaderOccupation'), groupesIsco: liens(f, 'broaderIscoGroup'),
  };
});

// 3. Les groupes ISCO, remontés jusqu'à la racine.
const groupes = new Map<string, { uri: string; code: string | null; libelles: Record<string, string>; parents: string[] }>();
let aLire = [...new Set(metiers.flatMap((m) => m.groupesIsco))];
while (aLire.length) {
  const lus = await enParallele(aLire, async (uri) => {
    const f = await lire<Fiche>(`${API}/resource/concept?uri=${encodeURIComponent(uri)}&selectedVersion=${VERSION}`);
    return { uri: f.uri, code: f.code ?? null, libelles: f.preferredLabel ?? {}, parents: liens(f, 'broaderConcept') };
  });
  for (const g of lus) groupes.set(g.uri, g);
  aLire = [...new Set(lus.flatMap((g) => g.parents))].filter((u) => !groupes.has(u) && u.includes('/isco/'));
}

// 4. Contrôles, puis écriture.
const orphelins = metiers.filter((m) => !m.parents.length && !m.groupesIsco.length).length;
const parentsInconnus = metiers.flatMap((m) => m.parents).filter((u) => !uniques.includes(u)).length;
const langues = [...new Set(metiers.flatMap((m) => Object.keys(m.libelles)))].sort();
const contenu = {
  source: `${API} (selectedVersion=${VERSION})`,
  licence: 'ESCO © Union européenne — réutilisation autorisée avec mention de la source (décision 2011/833/UE)',
  version: VERSION, telechargeLe: new Date().toISOString(),
  comptes: { annonces, metiers: metiers.length, groupesIsco: groupes.size, orphelins, parentsInconnus, langues: langues.length },
  langues, metiers, groupesIsco: [...groupes.values()],
};
sauver();
const octets = gzipSync(Buffer.from(JSON.stringify(contenu)));
writeFileSync(SORTIE, octets);
const empreinte = createHash('sha256').update(octets).digest('hex');
console.log(JSON.stringify({ fichier: SORTIE.split('/apps/aggregator/')[1], sha256: empreinte, octets: octets.length, ...contenu.comptes }, null, 1));
