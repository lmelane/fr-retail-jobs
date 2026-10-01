/**
 * D-500 — LA RECHERCHE COMPREND-ELLE LA REQUÊTE ? Mesure de l'état réel, en LECTURE SEULE sur la production.
 *
 * Ce que le script mesure, avec le VRAI code de la révision où il tourne (modèle `snapshotModel`, `searchSql`,
 * `roleKeyword`, prédicats de publication) et les VRAIES données (manifeste actif, sociétés, alias et secteurs lus en
 * production, comme `getSearchContext`) :
 *   1. la couverture du manifeste v3 (libellés par langue, variantes) et ce que le résolveur comprend de formes courantes
 *      (genre, pluriel, écriture inclusive, accents, majuscules) ;
 *   2. la part des offres publiables qui portent un métier (`occupationCode`, `titleRoles`), par marché ;
 *   3. les suggestions d'intitulés que sert `suggestTitlesDetaillees` (`apps/api/lib/suggestions.ts`) pour 10 frappes,
 *      en France et au Royaume-Uni, rejouées requête par requête, avec ce que rend le choix de chaque suggestion ;
 *   4. pour 11 requêtes, les offres rendues par le texte (`q`) et par le code du métier (`metier=`), et leur recouvrement.
 *
 * Toutes les lectures passent par `apps/aggregator/scripts/ops/db.py readonly` : `psql`, transaction en lecture seule
 * par défaut, délai de 25 s par requête, uniquement des `SELECT`. Aucune écriture, aucun Prisma vers la production.
 *
 * Usage (racine d'un arbre de l'agrégateur à la révision mesurée) :
 *   CATWALKS_DB_ACCESS=<dossier des accès> npx tsx audits/2026-10-01/d500-requete/mesure.mts [parties]
 *   parties : liste parmi taxonomie,couverture,suggestions,recouvrement (défaut : toutes)
 * Sorties : `resultats/<partie>.json` (données) et `resultats/<partie>.txt` (lecture).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma } from '@catwalks/db';
import { publicJobSql } from '@catwalks/db/availability';
import { MARCHES, type CodeMarche } from '@catwalks/db/marches';
import { occupationManifestHash, type OccupationManifest } from '@catwalks/db/occupations';
import { langueDesLibelles } from '@catwalks/db/presentation';
import { snapshotModel, type SnapshotMetadata } from '../../../apps/api/lib/search-model';
import { searchSql } from '../../../apps/api/lib/search-sql';
import { searchWords, type SearchIntent } from '@catwalks/db/search-intent';
import { SEARCH_VERSION } from '../../../apps/api/lib/search-index';
import { directPubliableSql, PREFIXE_DIRECT } from '../../../apps/api/lib/direct-offers';
import { metiersSansIndex, type Repartition } from '../../../apps/api/lib/search-chemin';
import { roleKeyword } from '../../../apps/api/lib/suggestions';
import { echapperLike } from '../../../apps/api/lib/like';

const ICI = new URL('.', import.meta.url).pathname;
const SORTIE = join(ICI, 'resultats');
mkdirSync(SORTIE, { recursive: true });
const PARTIES = (process.argv[2] ?? 'taxonomie,couverture,suggestions,recouvrement').split(',');
const DB_PY = process.env.CATWALKS_DB_PY ?? 'apps/aggregator/scripts/ops/db.py';

// ── Lecture de production : psql, lecture seule par défaut (db.py readonly) ────────────────────────────────────────
const litteral = (v: unknown): string => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : v instanceof Date ? `'${v.toISOString()}'` : Array.isArray(v) ? `ARRAY[${v.map(litteral).join(',')}]::text[]`
  : `'${String(v).replace(/'/g, "''")}'`;
/** Un `Prisma.Sql` en texte exécutable par psql : chaque valeur liée devient un littéral. */
const texte = (s: Prisma.Sql) => s.strings.reduce((acc, part, i) => acc + part + (i < s.values.length ? litteral(s.values[i]) : ''), '');

/** Exécute un fichier SQL en lecture seule ; rend les lignes non vides (`-At`). `\timing` ajoute des lignes « Time: ». */
function lire(sql: string): string[] {
  const dossier = mkdtempSync(join(tmpdir(), 'd500-'));
  const fichier = join(dossier, 'requete.sql');
  writeFileSync(fichier, `SET default_transaction_read_only = on;\n${sql}\n`);
  const sortie = execFileSync('python3', [DB_PY, 'readonly', 'sh', '-c', `psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -f '${fichier}'`],
    { encoding: 'utf8', maxBuffer: 1 << 29 });
  return sortie.split('\n').filter((l) => l.trim() && l.trim() !== 'SET');
}
/** Une requête qui rend un seul JSON, et sa durée (psql `\timing`). */
function lireJson<T>(sql: string, chrono = false): { valeur: T; ms: number | null } {
  const lignes = lire(`${chrono ? '\\timing on\n' : ''}${sql}`);
  const temps = lignes.filter((l) => l.startsWith('Time: ')).map((l) => Number(l.slice(6).split(' ')[0]));
  const donnees = lignes.filter((l) => !l.startsWith('Time: ') && !l.startsWith('Timing is '));
  return { valeur: JSON.parse(donnees.join('\n')) as T, ms: temps.length ? temps[temps.length - 1] : null };
}

// ── Le contexte servi : manifeste actif, génération de recherche, modèle complet ─────────────────────────────────────
const manifest = JSON.parse(readFileSync(new URL('../../2026-09-28/curation-v3/6-manifeste-v3.json', import.meta.url), 'utf8')) as OccupationManifest;
const contexte = lireJson<{ release: string; hash: string; generation: string | null; mesureA: string }>(`SELECT json_build_object(
  'release', r.id, 'hash', r."contentHash",
  'generation', (SELECT version FROM "SearchGeneration" WHERE version = ${litteral(SEARCH_VERSION)} AND "readyAt" IS NOT NULL),
  'mesureA', now()) FROM "OccupationState" s JOIN "OccupationRelease" r ON r.id = s."releaseId";`).valeur;
if (contexte.hash !== occupationManifestHash(manifest)) throw new Error(`Manifeste local différent de la version active (${contexte.release})`);
if (!contexte.generation) throw new Error(`${SEARCH_VERSION} n'est pas la génération servie`);
const meta = lireJson<Pick<SnapshotMetadata, 'companies' | 'aliases' | 'sectorConcepts'>>(`SELECT json_build_object(
  'companies', (SELECT coalesce(json_agg(json_build_object('id', id, 'name', name, 'parentGroup', "parentGroup", 'parentGroupId', "parentGroupId",
     'mergedIntoId', "mergedIntoId", 'sectorCodes', "sectorCodes")), '[]') FROM "Company"),
  'aliases', (SELECT coalesce(json_agg(json_build_object('companyId', "companyId", 'displayName', "displayName", 'reviewId', "reviewId")), '[]')
     FROM "CompanyAlias" WHERE "reviewId" IS NOT NULL),
  'sectorConcepts', (SELECT coalesce(json_agg(json_build_object('code', code, 'labels', labels)), '[]') FROM "SectorConcept"));`).valeur;
const model = snapshotModel({ asOf: new Date().toISOString(), occupationRelease: { id: manifest.id, manifest }, ...meta } as SnapshotMetadata);
const occupation = new Map(manifest.occupations.map((o) => [o.key, o]));
const cleLibelle = (l: string) => (l === 'zh' ? 'zh-CN' : l);
const libelle = (cle: string, code: CodeMarche) => {
  const o = occupation.get(cle);
  return o ? (o.labels as Record<string, string>)[cleLibelle(langueDesLibelles(MARCHES[code].localeParDefaut))] ?? o.labels.en : null;
};
const resume = (i: SearchIntent) => i.clauses.map((c) => `${c.exclude ? '-' : ''}${c.kind}:${c.kind === 'text' ? c.observed : c.keys.join('+')}`).join(' & ');
const ecrire = (nom: string, donnees: unknown, lecture: string[]) => {
  writeFileSync(join(SORTIE, `${nom}.json`), JSON.stringify({ contexte, donnees }, null, 1));
  writeFileSync(join(SORTIE, `${nom}.txt`), [`# ${nom} — ${contexte.mesureA} — ${contexte.release} — ${SEARCH_VERSION}`, ...lecture, ''].join('\n'));
  console.log(lecture.join('\n'));
};

const paysDe = (code: CodeMarche) => Prisma.join(MARCHES[code].pays.map((p) => Prisma.sql`${p}`));
const MARCHES_MESURES: CodeMarche[] = ['FR', 'GB'];

/** La répartition par métier (`repartitionDuPerimetre`), pour choisir le même chemin que le code servi. */
const repartitions = new Map<CodeMarche, Repartition>();
function repartition(code: CodeMarche): Repartition {
  const memo = repartitions.get(code);
  if (memo) return memo;
  const lignes = lireJson<{ code: string | null; n: number }[]>(`SELECT coalesce(json_agg(t), '[]') FROM (SELECT j."occupationCode" AS code, count(*)::int AS n
    FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IN (${texte(Prisma.sql`${paysDe(code)}`)}) GROUP BY 1) t;`).valeur;
  const r = { total: lignes.reduce((s, l) => s + l.n, 0), parMetier: new Map(lignes.flatMap((l) => (l.code ? [[l.code, l.n] as const] : []))) };
  repartitions.set(code, r);
  return r;
}

/** Les offres (id, intitulé natif) que retient la recherche servie, sans lieu ni filtre : la base de `sqlBase`. */
function ensembleTexte(q: string, code: CodeMarche, asOf: Date): Prisma.Sql {
  const intention = model.intention(q, MARCHES[code]);
  const { condition } = searchSql(intention, { metiersSansIndex: metiersSansIndex(intention, repartition(code)) });
  const pays = paysDe(code);
  return Prisma.sql`SELECT j.id, j.title FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      JOIN "SearchDocument" s ON s.id = j.id AND s.version = ${SEARCH_VERSION} AND s.country IN (${pays})
      WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND ${condition}
    UNION ALL SELECT ${PREFIXE_DIRECT} || d.id, d.title FROM "DirectOffer" d
      JOIN "SearchDocument" s ON s.id = ${PREFIXE_DIRECT} || d.id AND s.version = ${SEARCH_VERSION} AND s.country IN (${pays})
      WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}) AND ${condition}`;
}
/** Les offres que retient `metier=<code>` (prédicat de `job-search-query.ts`, dimension « metier »). */
function ensembleMetier(cle: string, code: CodeMarche, asOf: Date): Prisma.Sql {
  const pays = paysDe(code);
  return Prisma.sql`SELECT j.id, j.title FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND (j."occupationCode" = ${cle} OR j."titleRoles" @> ARRAY[${cle}]::text[])
    UNION ALL SELECT ${PREFIXE_DIRECT} || d.id, d.title FROM "DirectOffer" d
      WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}) AND (d."occupationCode" = ${cle} OR d."titleRoles" @> ARRAY[${cle}]::text[])`;
}
/** Le métier qu'une chaîne nomme exactement (copie de `metierNomme`, `suggestions.ts:159-163`). */
function metierNomme(valeur: string): string | null {
  const { clauses } = model.resolver.resolve(valeur);
  const [c] = clauses;
  return clauses.length === 1 && c.kind === 'role' && !c.exclude && c.keys.length === 1 ? c.keys[0] : null;
}

// ── 1. Taxonomie : couverture et formes comprises ──────────────────────────────────────────────────────────────────
if (PARTIES.includes('taxonomie')) {
  const langues = new Map<string, number>();
  let identiquesAnglais = 0, libellesEtrangers = 0;
  for (const o of manifest.occupations) for (const [l, v] of Object.entries(o.labels as Record<string, string>)) {
    if (!v) continue;
    langues.set(l, (langues.get(l) ?? 0) + 1);
    if (l !== 'en') { libellesEtrangers++; if (v.trim().toLowerCase() === String(o.labels.en).trim().toLowerCase()) identiquesAnglais++; }
  }
  const variantes = manifest.occupations.map((o) => (o.aliases ?? []).length);
  const familles = manifest.families.map((f) => ({ cle: f.key, aliases: (f.aliases ?? []).length }));
  /** Formes qu'une personne tape ; le résolveur les rattache-t-il au métier attendu ? */
  const FORMES: [string, string][] = [
    ['conseiller de vente', 'sales-advisor'], ['conseillère de vente', 'sales-advisor'], ['conseillere de vente', 'sales-advisor'],
    ['CONSEILLERE DE VENTE', 'sales-advisor'], ['conseillers de vente', 'sales-advisor'], ['conseillères de vente', 'sales-advisor'],
    ['conseiller(ère) de vente', 'sales-advisor'], ['conseiller/conseillère de vente', 'sales-advisor'], ['conseiller·ère de vente', 'sales-advisor'],
    ['conseiller.e de vente', 'sales-advisor'], ['conseillère', 'sales-advisor'], ['vendeur', 'sales-advisor'], ['vendeuse', 'sales-advisor'],
    ['vendeuses', 'sales-advisor'], ['vendeur(se)', 'sales-advisor'], ['vendeur/vendeuse', 'sales-advisor'], ['sales advisor', 'sales-advisor'],
    ['sales advisors', 'sales-advisor'], ['client advisor', 'sales-advisor'], ['conseillère de vente luxe', 'sales-advisor'],
    ['CONSEILLER DE VENTE /NB', 'sales-advisor'], ['conseillère de vente CDD', 'sales-advisor'], ['conseillère de vente H/F', 'sales-advisor'],
    ['conseillère de vente Toulouse', 'sales-advisor'], ['conseillère de vente expérimentée', 'sales-advisor'],
    ['responsable de boutique', 'store-manager'], ['responsable boutique', 'store-manager'], ['directrice de magasin', 'store-manager'],
    ['directeur de magasin', 'store-manager'], ['directrice de boutique', 'store-manager'], ['store manager', 'store-manager'],
    ['store managers', 'store-manager'], ['make-up artist', 'makeup-artist'], ['make up artist', 'makeup-artist'], ['makeup artist', 'makeup-artist'],
    ['maquilleuse', 'makeup-artist'], ['maquilleur', 'makeup-artist'], ['conseillère beauté', 'beauty-consultant'], ['visual merchandiser', 'visual-merchandiser'],
  ];
  const formes = FORMES.map(([forme, attendu]) => {
    const intention = model.intention(forme, MARCHES.FR);
    const roles = intention.clauses.filter((c) => c.kind === 'role').flatMap((c) => c.keys);
    const textes = intention.clauses.filter((c) => c.kind === 'text').map((c) => c.observed);
    return { forme, attendu, comprise: resume(intention), metierSeul: metierNomme(forme), metierAttenduTrouve: roles.includes(attendu), motsObligatoires: textes };
  });
  const lecture = [
    `Métiers : ${manifest.occupations.length} ; familles : ${manifest.families.length} ; variantes de métier : ${variantes.reduce((a, b) => a + b, 0)} (médiane ${[...variantes].sort((a, b) => a - b)[Math.floor(variantes.length / 2)]} par métier)`,
    `Libellés par langue : ${[...langues].map(([l, n]) => `${l} ${n}`).join(', ')}`,
    `Libellés hors anglais identiques au libellé anglais : ${identiquesAnglais} sur ${libellesEtrangers}`,
    `Variantes de famille : ${familles.reduce((s, f) => s + f.aliases, 0)} (${familles.filter((f) => !f.aliases).length} familles sans variante)`,
    `Les variantes de métier ne portent pas de langue (champ absent du manifeste ${manifest.id}).`,
    '', 'Formes tapées (marché FR) → ce que comprend le résolveur | métier attendu trouvé | mots rendus obligatoires',
    ...formes.map((f) => `${f.forme} → ${f.comprise} | ${f.metierAttenduTrouve ? 'oui' : 'NON'} | ${f.motsObligatoires.join(', ') || '-'}`),
  ];
  ecrire('taxonomie', { langues: Object.fromEntries(langues), identiquesAnglais, libellesEtrangers, formes }, lecture);
}

// ── 2. Couverture des offres par un métier ──────────────────────────────────────────────────────────────────────────
if (PARTIES.includes('couverture')) {
  const asOf = new Date();
  const cas = (code: CodeMarche | 'ALL') => code === 'ALL' ? Prisma.sql`true` : Prisma.sql`x.pays IN (${paysDe(code)})`;
  const lignes = (['FR', 'GB', 'US', 'ALL'] as const).map((code) => Prisma.sql`SELECT ${code}::text AS marche, count(*)::int AS offres,
      count(*) FILTER (WHERE x.code IS NOT NULL)::int AS avec_code,
      count(*) FILTER (WHERE cardinality(x.roles) > 0)::int AS avec_metiers_lus,
      count(*) FILTER (WHERE x.code IS NOT NULL OR cardinality(x.roles) > 0)::int AS avec_un_metier,
      count(*) FILTER (WHERE x.code IS NULL AND cardinality(x.roles) = 0 AND x.famille IS NOT NULL)::int AS famille_seule,
      count(*) FILTER (WHERE x.code IS NULL AND cardinality(x.roles) = 0 AND x.famille IS NULL)::int AS rien
    FROM x WHERE ${cas(code)}`);
  const sql = Prisma.sql`WITH x AS MATERIALIZED (
      SELECT j."countryCode" AS pays, j."occupationCode" AS code, j."titleRoles" AS roles, j."jobFunction" AS famille FROM "Job" j WHERE ${publicJobSql(Prisma.sql`j`, asOf)}
      UNION ALL SELECT d."countryCode", d."occupationCode", d."titleRoles", NULL FROM "DirectOffer" d WHERE ${directPubliableSql(Prisma.sql`d`, asOf)})
    SELECT json_agg(t) FROM (${Prisma.join(lignes, ' UNION ALL ')}) t;`;
  const r = lireJson<{ marche: string; offres: number; avec_code: number; avec_metiers_lus: number; avec_un_metier: number; famille_seule: number; rien: number }[]>(texte(sql)).valeur;
  const pc = (a: number, b: number) => `${((100 * a) / b).toFixed(1)} %`;
  ecrire('couverture', r, ['marché | offres publiables | code métier | métiers lus dans l\'intitulé | au moins un métier | famille seule | rien',
    ...r.map((l) => `${l.marche} | ${l.offres} | ${pc(l.avec_code, l.offres)} | ${pc(l.avec_metiers_lus, l.offres)} | ${pc(l.avec_un_metier, l.offres)} | ${pc(l.famille_seule, l.offres)} | ${pc(l.rien, l.offres)}`)]);
}

// ── 3. Les suggestions d'intitulés servies aujourd'hui ─────────────────────────────────────────────────────────────
if (PARTIES.includes('suggestions')) {
  const FRAPPES = ['conseill', 'conseillère', 'vendeu', 'store man', 'responsable bout', 'visual', 'make up', 'sales ad', 'assistant', 'directeur'];
  const sansAccents = (v: string) => v.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’‘‛`´ʼ]/g, "'").toLowerCase();
  /** Copie de `dedupliquer` (`suggestions.ts:114-126`), non exportée. */
  const dedupliquer = (valeurs: readonly (string | null)[], limit = 8) => {
    const vues = new Set<string>(), propres: string[] = [];
    for (const brut of valeurs) { if (!brut) continue; const cle = brut.toLowerCase(); if (vues.has(cle)) continue; vues.add(cle); propres.push(brut); if (propres.length >= limit) break; }
    return propres;
  };
  // Les villes du marché (au moins 3 offres) : une suggestion qui en contient une porte un lieu, pas un métier.
  const villes = new Map<CodeMarche, string[]>();
  for (const code of MARCHES_MESURES) villes.set(code, lireJson<string[]>(texte(Prisma.sql`SELECT coalesce(json_agg(v), '[]') FROM (
      SELECT lower(trim(j.city)) v FROM "Job" j WHERE ${publicJobSql(Prisma.sql`j`, new Date())} AND j."countryCode" IN (${paysDe(code)}) AND length(trim(j.city)) >= 4
      GROUP BY 1 HAVING count(*) >= 3) t;`)).valeur.map((v) => searchWords(v).join(' ')).filter(Boolean));
  const BRUIT = /\b(cdd|cdi|h\s*\/\s*f|f\s*\/\s*h|h\s*f|nb|interim|intérim|stage|alternance|apprenti|saisonnier|temps partiel|part[- ]time|full[- ]time|\d+\s*h)\b|\/|\(|\)|\s-\s/i;
  const resultats: unknown[] = [];
  const lecture: string[] = [];
  for (const code of MARCHES_MESURES) for (const q of FRAPPES) {
    const asOf = new Date();
    const pays = paysDe(code);
    const motif = `%${echapperLike(q.trim())}%`;
    // `suggestions.ts:181-188`, à l'identique.
    const brutes = lireJson<{ valeur: string | null; n: number }[]>(texte(Prisma.sql`SELECT coalesce(json_agg(t ORDER BY t.n DESC, t.valeur ASC), '[]') FROM (
      SELECT valeur, sum(n)::int AS n FROM (
        SELECT j.title AS valeur, count(*) AS n FROM "Job" j
         WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND catwalks_normaliser_texte(j.title) LIKE catwalks_normaliser_texte(${motif}) GROUP BY j.title
        UNION ALL
        SELECT d.title, count(*) FROM "DirectOffer" d
         WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}) AND catwalks_normaliser_texte(d.title) LIKE catwalks_normaliser_texte(${motif}) GROUP BY d.title
      ) t GROUP BY valeur ORDER BY n DESC, valeur ASC LIMIT 40) t;`), true);
    // `suggestions.ts:190-192`, à l'identique.
    const normalized = searchWords(q).join(' ');
    const candidats = dedupliquer([...brutes.valeur.map((r) => r.valeur && roleKeyword(r.valeur)).filter((r): r is string => !!r && sansAccents(r).includes(sansAccents(q))),
      ...model.concepts.flatMap((c) => c.aliases.filter((a) => searchWords(a).join(' ').startsWith(normalized)))], 24);
    const issusDesOffres = new Set(brutes.valeur.map((r) => r.valeur && roleKeyword(r.valeur)).filter(Boolean) as string[]);
    // `suggestions.ts:198-208` : une recherche EXISTS par candidat, même restriction et même chemin que la recherche.
    let servies: string[] = [], msValidation: number | null = null;
    if (candidats.length) {
      const requetes = candidats.map((value, position) => {
        const intention = model.intention(value, MARCHES[code]);
        const { condition } = searchSql(intention, { metiersSansIndex: metiersSansIndex(intention, repartition(code)) });
        return Prisma.sql`SELECT ${value}::text AS value, ${position}::int AS position WHERE EXISTS (
          SELECT 1 FROM "SearchDocument" s JOIN "Job" j ON j.id=s.id
          WHERE s.version=${SEARCH_VERSION} AND ${condition} AND ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays})
          UNION ALL SELECT 1 FROM "SearchDocument" s JOIN "DirectOffer" d ON s.id='cw_'||d.id
          WHERE s.version=${SEARCH_VERSION} AND ${condition} AND ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}))`;
      });
      const r = lireJson<string[]>(texte(Prisma.sql`SELECT coalesce(json_agg(value), '[]') FROM (SELECT value FROM (${Prisma.join(requetes, ' UNION ALL ')}) suggestions ORDER BY position LIMIT 8) t;`), true);
      servies = r.valeur; msValidation = r.ms;
    }
    // Ce que rend le choix de chaque suggestion : `metier=` si elle nomme un métier (ChampSuggestions.tsx:444-450), sinon `q`.
    const detail = servies.map((valeur) => {
      const metier = metierNomme(valeur);
      const ensemble = metier ? ensembleMetier(metier, code, asOf) : ensembleTexte(valeur, code, asOf);
      const n = lireJson<number>(texte(Prisma.sql`SELECT count(*) FROM (${ensemble}) e;`)).valeur;
      const mots = searchWords(valeur).join(' ');
      const ville = (villes.get(code) ?? []).find((v) => ` ${mots} `.includes(` ${v} `)) ?? null;
      return { valeur, origine: issusDesOffres.has(valeur) ? 'intitulé d\'offre' : 'variante de la taxonomie', metier, libelle: metier ? libelle(metier, code) : null,
        offresAuChoix: n, bruit: BRUIT.test(valeur) || null, ville, majuscules: valeur === valeur.toUpperCase() && /\p{Lu}{3}/u.test(valeur) };
    });
    const doublonsGenre = detail.length - new Set(detail.map((d) => d.metier ?? sansAccents(d.valeur))).size;
    resultats.push({ marche: code, frappe: q, brutes: brutes.valeur.length, candidats, msTitres: brutes.ms, msValidation, servies: detail, doublonsMemeMetier: doublonsGenre });
    lecture.push(`\n## ${code} « ${q} » — ${brutes.ms?.toFixed(0)} + ${msValidation?.toFixed(0) ?? '-'} ms ; ${candidats.length} candidats ; ${doublonsGenre} doublon(s) du même métier`,
      ...detail.map((d) => `- ${d.valeur} [${d.origine}]${d.metier ? ` → metier=${d.metier} (« ${d.libelle} »)` : ' → q (texte)'} : ${d.offresAuChoix} offres`
        + `${d.bruit ? ' · BRUIT' : ''}${d.ville ? ` · VILLE ${d.ville}` : ''}${d.majuscules ? ' · MAJUSCULES' : ''}`));
  }
  ecrire('suggestions', resultats, lecture);
}

// ── 4. Le texte contre le métier : recouvrement ─────────────────────────────────────────────────────────────────────
if (PARTIES.includes('recouvrement')) {
  const REQUETES: [string, string][] = [
    ['conseillère de vente', 'sales-advisor'], ['conseiller de vente', 'sales-advisor'], ['conseiller(ère) de vente', 'sales-advisor'],
    ['sales advisor', 'sales-advisor'], ['vendeuse', 'sales-advisor'], ['CONSEILLER DE VENTE /NB', 'sales-advisor'],
    ['responsable de boutique', 'store-manager'], ['store manager', 'store-manager'], ['directrice de magasin', 'store-manager'],
    ['make-up artist', 'makeup-artist'], ['conseillère de vente luxe', 'sales-advisor'],
  ];
  const resultats: unknown[] = [];
  const lecture = ['marché | requête | comprise | offres q | offres metier= | communes | metier= absentes de q (% du métier) | q hors metier= | ms q (3 tours) | ms metier'];
  for (const code of MARCHES_MESURES) for (const [q, cle] of REQUETES) {
    const asOf = new Date();
    const intention = model.intention(q, MARCHES[code]);
    const sql = Prisma.sql`WITH q AS MATERIALIZED (${ensembleTexte(q, code, asOf)}), m AS MATERIALIZED (${ensembleMetier(cle, code, asOf)})
      SELECT json_build_object('q', (SELECT count(*) FROM q), 'm', (SELECT count(*) FROM m),
        'communes', (SELECT count(*) FROM q JOIN m USING (id)),
        'manquees', (SELECT count(*) FROM m WHERE id NOT IN (SELECT id FROM q)),
        'enPlus', (SELECT count(*) FROM q WHERE id NOT IN (SELECT id FROM m)),
        'exemplesManquees', (SELECT coalesce(json_agg(title), '[]') FROM (SELECT title FROM m WHERE id NOT IN (SELECT id FROM q) ORDER BY md5(id) LIMIT 8) t),
        'exemplesEnPlus', (SELECT coalesce(json_agg(title), '[]') FROM (SELECT title FROM q WHERE id NOT IN (SELECT id FROM m) ORDER BY md5(id) LIMIT 8) t));`;
    const r = lireJson<{ q: number; m: number; communes: number; manquees: number; enPlus: number; exemplesManquees: string[]; exemplesEnPlus: string[] }>(texte(sql)).valeur;
    // La durée de la seule condition de texte (compte), puis du filtre métier : trois tours, la médiane.
    const tours = (e: Prisma.Sql) => [0, 1, 2].map(() => lireJson<number>(texte(Prisma.sql`SELECT count(*) FROM (${e}) e;`), true).ms ?? NaN).sort((a, b) => a - b);
    const msQ = tours(ensembleTexte(q, code, asOf)), msM = tours(ensembleMetier(cle, code, asOf));
    resultats.push({ marche: code, q, cle, comprise: resume(intention), ...r, msQ, msM });
    lecture.push(`${code} | ${q} | ${resume(intention)} | ${r.q} | ${r.m} | ${r.communes} | ${r.manquees} (${r.m ? ((100 * r.manquees) / r.m).toFixed(1) : '-'} %) | ${r.enPlus} | ${msQ.map((x) => x.toFixed(0)).join('/')} | ${msM[1].toFixed(0)}`,
      `    manquées, par ex. : ${r.exemplesManquees.slice(0, 5).join(' ‖ ')}`, `    en plus, par ex. : ${r.exemplesEnPlus.slice(0, 5).join(' ‖ ')}`);
  }
  ecrire('recouvrement', resultats, lecture);
}
process.exit(0);
