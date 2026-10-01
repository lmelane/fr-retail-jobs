/**
 * D-500 / D-501 — LE LOT MESURÉ CONTRE LES CRITÈRES DU CAHIER, en LECTURE SEULE sur la production.
 *
 * Le VRAI code de la révision (suggestions canoniques, requête comprise, classement, SQL servi) tourne ici contre la
 * production : le client Prisma est remplacé, avant tout import du code, par un client de MESURE dont chaque `$queryRaw`
 * devient un fichier SQL exécuté par `apps/aggregator/scripts/ops/db.py readonly` (psql, transaction en lecture seule
 * par défaut, délai de 25 s), dont la durée est relevée (`\timing`). Toute écriture lève une erreur. Aucun Prisma ne
 * parle à la production.
 *
 * Parties (argument, défaut : toutes) :
 *   comprise    Q1 : recouvrement texte compris / `metier=` (FR, GB), offres perdues par rapport à la lecture d'avant ;
 *   suggestions Q2 : les 20 frappes de la mesure du 01/10/2026, au contrat 2 : bruit, villes, capitales, doublons, offres au
 *               choix, durée par frappe (requêtes relevées) ;
 *   classement  Q4 : les 20 premières offres de « conseillère de vente » et « responsable de boutique » (France) ;
 *   grille      vitesse : la requête servie des 137 recherches de D-488, avant (contrat d'avant) et après (contrat 2),
 *               capturée ici puis rejouée par tours alternés dans une seule session psql (`bilan-servie.py` de D-488).
 *
 * Usage (racine d'un arbre de l'agrégateur à la révision mesurée) :
 *   CATWALKS_DB_ACCESS=<dossier des accès> npx tsx audits/2026-10-01/d500-requete/mesure-lot.mts [parties]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { capteur, etat as etatMesure, executer, journal, litteral, texte, un } from './client-mesure.mts';

const ICI = new URL('.', import.meta.url).pathname;
const SORTIE = join(ICI, 'resultats');
mkdirSync(SORTIE, { recursive: true });
const PARTIES = (process.argv[2] ?? 'comprise,suggestions,classement,grille').split(',');
const { MARCHES } = await import('@catwalks/db/marches');
const { searchWords } = await import('@catwalks/db/search-intent');
const { replierRequete } = await import('@catwalks/db/search-comprendre');
const { publicJobSql } = await import('@catwalks/db/availability');
const { getSearchContext, SEARCH_VERSION } = await import('../../../apps/api/lib/search-index');
const { searchSql } = await import('../../../apps/api/lib/search-sql');
const { metiersSansIndex, repartitionDuPerimetre } = await import('../../../apps/api/lib/search-chemin');
const { directPubliableSql, PREFIXE_DIRECT } = await import('../../../apps/api/lib/direct-offers');
const { suggestTitlesCanoniques } = await import('../../../apps/api/lib/suggestions-canoniques');
const { planifierRecherche } = await import('../../../apps/api/lib/search-plan');
const { searchSummary } = await import('../../../apps/api/lib/job-search-query');
const { exigerPerimetre } = await import('../../../apps/api/lib/perimetre');
type CodeMarche = keyof typeof MARCHES;

const { model } = await getSearchContext();
const etat = un<{ release: string; generation: string | null; mesureA: string }>(`SELECT r.id AS release,
  (SELECT version FROM "SearchGeneration" WHERE version = ${litteral(SEARCH_VERSION)} AND "readyAt" IS NOT NULL) AS generation, now() AS "mesureA"
  FROM "OccupationState" s JOIN "OccupationRelease" r ON r.id = s."releaseId"`);
if (!etat.generation) throw new Error(`${SEARCH_VERSION} n'est pas servie`);
const ecrire = (nom: string, donnees: unknown, lignes: string[]) => {
  writeFileSync(join(SORTIE, `${nom}.json`), JSON.stringify({ etat, donnees }, null, 1));
  writeFileSync(join(SORTIE, `${nom}.txt`), [`# ${nom} — ${etat.mesureA} — ${etat.release} — ${SEARCH_VERSION}`, ...lignes, ''].join('\n'));
  console.log(lignes.join('\n'));
};
const paysDe = (code: CodeMarche) => Prisma.join(MARCHES[code].pays.map((p) => Prisma.sql`${p}`));

/** Les offres (id, intitulé) de la recherche par le texte : la base de `sqlBase`, sans lieu ni filtre. */
async function ensembleTexte(q: string, code: CodeMarche, comprendre: boolean, asOf: Date) {
  const intention = model.intention(q, MARCHES[code], { comprendre });
  const repartition = await repartitionDuPerimetre(MARCHES[code].pays);
  const { condition } = searchSql(intention, { metiersSansIndex: !!repartition && metiersSansIndex(intention, repartition) });
  const pays = paysDe(code);
  return Prisma.sql`SELECT j.id, j.title FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      JOIN "SearchDocument" s ON s.id = j.id AND s.version = ${SEARCH_VERSION} AND s.country IN (${pays})
      WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND ${condition}
    UNION ALL SELECT ${PREFIXE_DIRECT} || d.id, d.title FROM "DirectOffer" d
      JOIN "SearchDocument" s ON s.id = ${PREFIXE_DIRECT} || d.id AND s.version = ${SEARCH_VERSION} AND s.country IN (${pays})
      WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}) AND ${condition}`;
}
/** Les offres que retient `metier=<code>` (prédicat de `job-search-query.ts`). */
function ensembleMetier(cle: string, code: CodeMarche, asOf: Date) {
  const pays = paysDe(code);
  return Prisma.sql`SELECT j.id, j.title FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      WHERE ${publicJobSql(Prisma.sql`j`, asOf)} AND j."countryCode" IN (${pays}) AND (j."occupationCode" = ${cle} OR j."titleRoles" @> ARRAY[${cle}]::text[])
    UNION ALL SELECT ${PREFIXE_DIRECT} || d.id, d.title FROM "DirectOffer" d
      WHERE ${directPubliableSql(Prisma.sql`d`, asOf)} AND d."countryCode" IN (${pays}) AND (d."occupationCode" = ${cle} OR d."titleRoles" @> ARRAY[${cle}]::text[])`;
}
const resume = (i: ReturnType<typeof model.intention>) => i.clauses.map((c) => `${c.exclude ? '-' : ''}${c.kind}:${c.kind === 'text' ? c.phrases.join('|') : c.keys.join('+')}`).join(' & ');

// ── Q1 : la requête comprise ────────────────────────────────────────────────────────────────────────────────────────
if (PARTIES.includes('comprise')) {
  const REQUETES: [string, string][] = [
    ['conseiller(ère) de vente', 'sales-advisor'], ['CONSEILLER DE VENTE /NB', 'sales-advisor'], ['conseiller·ère de vente', 'sales-advisor'],
    ['conseiller.e de vente', 'sales-advisor'], ['conseillère de vente H/F', 'sales-advisor'], ['conseillère de vente', 'sales-advisor'],
    ['vendeur/vendeuse', 'sales-advisor'], ['conseillère de vente luxe', 'sales-advisor'], ['conseillère', 'sales-advisor'],
    ['responsable boutique', 'store-manager'], ['responsable de boutique', 'store-manager'], ['sales advisor', 'sales-advisor'],
  ];
  const donnees: unknown[] = [];
  const lignes = ['marché | requête | comprise (contrat 2) | offres texte avant | offres texte contrat 2 | offres metier= | metier= trouvées (contrat 2) | perdues par rapport à avant | titres « Conseiller … » trouvés'];
  for (const code of ['FR', 'GB'] as CodeMarche[]) for (const [q, cle] of REQUETES) {
    const asOf = new Date();
    const sql = Prisma.sql`WITH a AS MATERIALIZED (${await ensembleTexte(q, code, false, asOf)}), b AS MATERIALIZED (${await ensembleTexte(q, code, true, asOf)}),
      m AS MATERIALIZED (${ensembleMetier(cle, code, asOf)})
      SELECT (SELECT count(*) FROM a) AS avant, (SELECT count(*) FROM b) AS apres, (SELECT count(*) FROM m) AS metier,
        (SELECT count(*) FROM m WHERE id IN (SELECT id FROM b)) AS trouvees, (SELECT count(*) FROM a WHERE id NOT IN (SELECT id FROM b)) AS perdues,
        (SELECT coalesce(json_agg(title), '[]') FROM (SELECT title FROM a WHERE id NOT IN (SELECT id FROM b) LIMIT 5) t) AS exemples_perdues,
        (SELECT count(*) FROM b WHERE catwalks_normaliser_texte(title) LIKE 'conseiller %') AS conseiller`;
    const r = executer(texte(sql)).lignes[0] as { avant: number; apres: number; metier: number; trouvees: number; perdues: number; exemples_perdues: string[]; conseiller: number };
    const pc = r.metier ? (100 * r.trouvees) / r.metier : 0;
    donnees.push({ marche: code, q, cle, comprise: resume(model.intention(q, MARCHES[code], { comprendre: true })), ...r, part: pc });
    lignes.push(`${code} | ${q} | ${resume(model.intention(q, MARCHES[code], { comprendre: true }))} | ${r.avant} | ${r.apres} | ${r.metier} | ${r.trouvees} (${pc.toFixed(1)} %) | ${r.perdues}${r.perdues ? ` (${r.exemples_perdues.join(' ‖ ')})` : ''} | ${r.conseiller}`);
  }
  ecrire('lot-comprise', donnees, lignes);
}

// ── Q2 : les suggestions canoniques ─────────────────────────────────────────────────────────────────────────────────
if (PARTIES.includes('suggestions')) {
  const FRAPPES = process.env.FRAPPES?.split(',') ?? ['conseill', 'conseillère', 'vendeu', 'store man', 'responsable bout', 'visual', 'make up', 'sales ad', 'assistant', 'directeur'];
  const BRUIT = /\b(cdd|cdi|h\s*\/\s*f|f\s*\/\s*h|nb|interim|intérim|stage|alternance|\d+\s*h)\b|\/|\(|\)|\s-\s/i;
  const donnees: unknown[] = [];
  const lignes: string[] = [];
  const durees: number[] = [], dureesBase: number[] = [];
  // L'aller-retour du proxy : la plus courte de 10 lectures triviales.
  const allerRetour = Math.min(...Array.from({ length: 10 }, () => executer('SELECT 1 AS un').ms));
  for (const code of (process.env.MARCHES_MESURES?.split(',') ?? ['FR', 'GB']) as CodeMarche[]) {
    const perimetre = exigerPerimetre(code);
    const villes = new Set((executer(texte(Prisma.sql`SELECT lower(trim(j.city)) AS v FROM "Job" j WHERE ${publicJobSql(Prisma.sql`j`, new Date())}
      AND j."countryCode" IN (${paysDe(code)}) AND length(trim(j.city)) >= 4 GROUP BY 1 HAVING count(*) >= 3`)).lignes as { v: string }[])
      .map((l) => searchWords(l.v).join(' ')).filter(Boolean));
    // Les mémos par marché (offres par métier, villes) se remplissent une fois : relevés à part, comme un premier appel.
    etatMesure.etiquette = `${code} mémos`;
    await suggestTitlesCanoniques('zq', perimetre, code === 'FR' ? 'fr' : 'en');
    const memos = journal.filter((r) => r.etiquette === etatMesure.etiquette).reduce((s, r) => s + r.ms, 0);
    lignes.push(`\n# ${code} : mémos du marché (offres par métier, villes), une fois toutes les 10 minutes à une heure : ${memos.toFixed(0)} ms`);
    for (const f of FRAPPES) {
      etatMesure.etiquette = `${code} ${f}`;
      const s = await suggestTitlesCanoniques(f, perimetre, code === 'FR' ? 'fr' : 'en');
      const releves = journal.filter((r) => r.etiquette === etatMesure.etiquette);
      const ms = releves.reduce((x, r) => x + r.ms, 0);
      durees.push(ms);
      // Côté base : moins un aller-retour par requête (le proxy TCP de la mesure ; l'API joint la base par le réseau privé).
      dureesBase.push(ms - releves.length * allerRetour);
      const detail = [];
      for (const x of s) {
        const asOf = new Date();
        const ensemble = x.metier ? ensembleMetier(x.metier.identifiant, code, asOf) : await ensembleTexte(x.valeur, code, true, asOf);
        const n = (executer(texte(Prisma.sql`SELECT count(*) AS n FROM (${ensemble}) e`)).lignes[0] as { n: number }).n;
        const mots = searchWords(x.valeur).join(' ');
        const ville = [...villes].find((v) => ` ${mots} `.includes(` ${v} `)) ?? null;
        detail.push({ ...x, offresAuChoix: n, bruit: BRUIT.test(x.valeur), ville, majuscules: x.valeur === x.valeur.toUpperCase() && /\p{Lu}{3}/u.test(x.valeur) });
      }
      const doublons = detail.length - new Set(detail.map((d) => d.metier?.identifiant ?? searchWords(d.valeur).join(' '))).size;
      donnees.push({ marche: code, frappe: f, ms, requetes: releves.length, releves: releves.map((r) => ({ ms: r.ms, sql: r.sql })), suggestions: detail, doublons });
      lignes.push(`\n## ${code} « ${f} » — ${ms.toFixed(0)} ms (${releves.length} requêtes) ; ${doublons} doublon(s)`,
        ...detail.map((d) => `- ${d.valeur} [${d.nature}]${d.metier ? ` → metier=${d.metier.identifiant}` : ' → q (texte compris)'} : ${d.offresAuChoix} offres`
          + `${d.bruit ? ' · BRUIT' : ''}${d.ville ? ` · VILLE ${d.ville}` : ''}${d.majuscules ? ' · MAJUSCULES' : ''}${d.offresAuChoix === 0 ? ' · ZÉRO' : ''}`));
    }
  }
  const tri = [...durees].sort((a, b) => a - b);
  const p95 = tri[Math.ceil(0.95 * tri.length) - 1];
  const tout = donnees as { suggestions: { bruit: boolean; ville: string | null; majuscules: boolean; offresAuChoix: number }[]; doublons: number }[];
  const bilan = {
    frappes: tout.length, suggestions: tout.reduce((s, d) => s + d.suggestions.length, 0),
    bruit: tout.reduce((s, d) => s + d.suggestions.filter((x) => x.bruit).length, 0),
    villes: tout.reduce((s, d) => s + d.suggestions.filter((x) => x.ville).length, 0),
    majuscules: tout.reduce((s, d) => s + d.suggestions.filter((x) => x.majuscules).length, 0),
    zero: tout.reduce((s, d) => s + d.suggestions.filter((x) => x.offresAuChoix === 0).length, 0),
    doublons: tout.reduce((s, d) => s + d.doublons, 0), medianeMs: tri[Math.floor(tri.length / 2)], p95Ms: p95, maxMs: tri.at(-1),
    sous300: durees.filter((d) => d <= 300).length, allerRetourMs: allerRetour,
    sous300CoteBase: dureesBase.filter((d) => d <= 300).length,
    p95CoteBaseMs: [...dureesBase].sort((a, b) => a - b)[Math.ceil(0.95 * dureesBase.length) - 1],
  };
  lignes.unshift(`Bilan : ${JSON.stringify(bilan)}`,
    'Durée d\'une frappe : la somme des durées serveur de ses requêtes (psql \\timing), mémos du marché déjà remplis ; les requêtes parallèles du code sont comptées bout à bout (majorant).');
  ecrire('lot-suggestions', { bilan, donnees }, lignes);
}

// ── Q4 : le classement ──────────────────────────────────────────────────────────────────────────────────────────────
if (PARTIES.includes('classement')) {
  const lignes: string[] = [];
  const donnees: unknown[] = [];
  for (const [q, cle] of [['conseillère de vente', 'sales-advisor'], ['responsable de boutique', 'store-manager']] as const) {
    for (const comprendre of [false, true]) {
      const plan = planifierRecherche(exigerPerimetre('FR'), { q, filtres: {}, ...(comprendre ? { comprendre: true } : {}) });
      const r = await searchSummary(plan, null, 20);
      const titres = executer(texte(Prisma.sql`SELECT x.id, coalesce(j.title, d.title) AS title,
          (j."occupationCode" = ${cle} OR j."titleRoles" @> ARRAY[${cle}]::text[] OR d."occupationCode" = ${cle} OR d."titleRoles" @> ARRAY[${cle}]::text[]) AS du_metier
        FROM unnest(${r.ids}::text[]) WITH ORDINALITY x(id, rang) LEFT JOIN "Job" j ON j.id = x.id
        LEFT JOIN "DirectOffer" d ON ${PREFIXE_DIRECT} || d.id = x.id ORDER BY x.rang`)).lignes as { title: string; du_metier: boolean }[];
      const phrases = model.intention(q, MARCHES.FR, { comprendre: true }).clauses.flatMap((c) => c.phrases);
      // L'intitulé lu comme la requête (écriture inclusive repliée) : « Conseiller·ère de vente » nomme le métier.
      const nomme = (t: string) => phrases.some((p) => ` ${searchWords(replierRequete(t)).join(' ')} `.includes(` ${p} `));
      const nommant = titres.filter((t) => nomme(t.title)).length;
      const vendeurs = titres.filter((t) => /^vendeu/i.test(searchWords(t.title).join(' '))).length;
      donnees.push({ q, comprendre, total: r.total, titres });
      lignes.push(`\n## « ${q} » FR — ${comprendre ? 'contrat 2' : 'contrat d\'avant'} — ${r.total} offres ; ${nommant}/20 intitulés nomment le métier ; ${vendeurs} « Vendeur… »`,
        ...titres.map((t, i) => `${String(i + 1).padStart(2)}. ${t.title}${t.du_metier ? '' : ' (hors métier)'}${nomme(t.title) ? '' : ' · NE NOMME PAS'}`));
    }
  }
  ecrire('lot-classement', donnees, lignes);
}

// ── Vitesse : la grille des 137 recherches de D-488 ────────────────────────────────────────────────────────────────
if (PARTIES.includes('grille')) {
  const cas = readFileSync(join(ICI, '..', 'd488-langues-marche', 'resultats', 'cas-grille.txt'), 'utf8').trim().split(',')
    .map((c) => [c.slice(0, c.indexOf(':')), c.slice(c.indexOf(':') + 1)] as [CodeMarche, string]);
  const blocs: Record<'avant' | 'apres', string[]> = { avant: [], apres: [] };
  for (const [code, q] of cas) for (const variante of ['avant', 'apres'] as const) {
    const plan = planifierRecherche(exigerPerimetre(code), { q, filtres: {}, ...(variante === 'apres' ? { comprendre: true } : {}) });
    const capture: { marque: string; texte?: string; reponse: unknown[] } = { marque: 'WITH base AS MATERIALIZED', reponse: [{ total: 0, totalConfirmes: 0, page: [], facettes: {} }] };
    capteur.capture = capture;
    await searchSummary(plan, null, 25);
    capteur.capture = null;
    if (!capture.texte) throw new Error(`requête servie non capturée : ${code} ${q}`);
    blocs[variante].push(`\\echo '${code} ${q.replace(/'/g, "''")}'`, `SELECT r.total, md5(r.page::text) FROM (${capture.texte}) r;`);
  }
  // Tours alternés, comme D-488 : avant, après, avant, après.
  const tours = Number(process.env.TOURS ?? 4);
  const fichier = join(SORTIE, 'lot-grille-137.sql');
  writeFileSync(fichier, ['SET default_transaction_read_only = on;', '\\timing on', '\\pset tuples_only on',
    ...Array.from({ length: tours }, (_v, i) => blocs[i % 2 ? 'apres' : 'avant']).flat()].join('\n') + '\n');
  console.log(`grille : ${cas.length} cas, ${tours} tours ; ${fichier}`);
}
process.exit(0);
