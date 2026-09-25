/**
 * MULTI-PAYS — la prémisse de la limite « une publication multi-pays n'est servie que dans le
 * pays projeté » (docs/architecture/recherche-marche.md:12), mesurée avant toute conception.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Le catalogue projette UNE localisation par offre (`Job.countryCode`, `city`, `adminArea1`,
 * `postalCode`) depuis l'observation canonique (`publication/content.ts`, `dedup/upsert.ts`) ; la
 * recherche borne tout sur `Job.countryCode IN (périmètre)` (`apps/api/lib/job-search-query.ts`).
 * Les lieux natifs restent dans `JobSource.sourceFacts.locations`. Combien d'offres publiables
 * déclarent des lieux dans PLUSIEURS pays, et combien de couples (offre, pays non projeté) sont
 * donc absents du marché de ce pays ?
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Offres publiables = `publicJobSql` (packages/db/availability.ts:18-22), recopiée à l'identique
 * ci-dessous : `Job` actif, non fusionné, avec au moins une `JobSource` active et non échue.
 * Le pays d'un lieu déclaré suit la chaîne de la projection réelle (`retainedCountryOf`,
 * publication/content.ts:82-92) appliquée à CE lieu : champ pays normalisé, puis
 * `resolveGeography`, puis `countryFromLocation`, puis les signaux français. Une ville seule ne
 * produit jamais de pays (geography.ts) : un tel lieu est compté « sans pays », jamais deviné.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Par défaut : production, rôle `catwalks_audit` (docs/audit-lot0/L1-PROCEDURE-ACCES-AUDIT.md),
 * identifiants hors dépôt (`~/.catwalks/audit-access.json`), jamais affichés. `--repetition` :
 * la base `catwalks_consolide_rehearsal` par le tunnel local (`~/.catwalks/rehearsal-access.json`).
 * Aucun Prisma, aucune URL passée en argument : `psql` reçoit les identifiants par son
 * environnement. La transaction est ouverte `READ ONLY` et la garde (base attendue, lecture
 * seule effective, rôle non superutilisateur) est éprouvée AVANT toute mesure ; sinon rien ne
 * s'exécute.
 *
 *   npx tsx audits/2026-09-24/scripts/multi-pays-mesure.mts [--repetition] [--json]
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { CODES_MARCHE, marche } from '@catwalks/db/marches';
import { countryFromLocation, normalizeCountry } from '../../../apps/aggregator/src/normalize/country.ts';
import { resolveGeography } from '../../../apps/aggregator/src/normalize/geography.ts';
import { isFranceJob } from '../../../apps/aggregator/src/lib/france.ts';
import { parseRmkLocation } from '../../../apps/aggregator/src/ats/adapters/successfactors.ts';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const repetition = process.argv.includes('--repetition');
const sortieJson = process.argv.includes('--json');
const BASE = repetition ? 'catwalks_consolide_rehearsal' : 'railway';
const fichier = repetition
  ? process.env.CW_REHEARSAL_ACCESS ?? `${homedir()}/.catwalks/rehearsal-access.json`
  : process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (!repetition && acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');
if (repetition && !['127.0.0.1', 'localhost'].includes(String(acces.PGHOST))) refus('tunnel local requis');
// Le rôle que la garde exige : `catwalks_audit` en production, celui du fichier d'accès local en répétition.
const ROLE = repetition ? String(acces.PGUSER) : 'catwalks_audit';
if (!/^[a-z_][a-z0-9_]*$/.test(ROLE)) refus('rôle invalide');

const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;
const LIEUX = (s: string) => `CASE WHEN jsonb_typeof(${s}."sourceFacts"->'locations'->'value') = 'array'
  THEN ${s}."sourceFacts"->'locations'->'value' ELSE '[]'::jsonb END`;
const ligne = (tag: string, json: string) => `SELECT '${tag}' || E'\\t' || (${json})::text;`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = '${ROLE}' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
${ligne('G', `json_build_object('base', current_database(), 'role', current_user, 'lectureSeule', current_setting('transaction_read_only'),
  'isolation', current_setting('transaction_isolation'), 'superutilisateur', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), 'maintenant', now())`)}
\\if :garde_ok
${ligne('F', `json_build_object('jobMajMax', (SELECT max("updatedAt") FROM "Job"), 'jobVuMax', (SELECT max("firstSeenAt") FROM "Job"),
  'sourceVueMax', (SELECT max("lastSeenAt") FROM "JobSource"))`)}
SELECT 'L' || E'\\t' || json_build_object('id', j.id, 'cc', j."countryCode", 'maison', c.name, 'titre', left(j.title, 70),
  'sources', (SELECT json_agg(json_build_object('k', s."sourceKey", 'can', s."sourceKey" = j."canonicalSourceKey" AND s."externalId" = j."canonicalExternalId",
      't', coalesce(s."sourceFacts"->>'sourceType', j.source::text), 'st', coalesce(s."sourceFacts"->'locations'->>'status', 'NON_CALCULE'),
      'l', (SELECT json_agg(json_build_array(x->>'label', x->>'city', x->>'region', x->>'postalCode', x->>'country') ORDER BY o)
            FROM jsonb_array_elements(${LIEUX('s')}) WITH ORDINALITY e(x, o)),
      'wttj', CASE WHEN s."sourceFacts"->>'sourceType' = 'WTTJ' AND jsonb_typeof(s.raw->'offices') = 'array' AND jsonb_array_length(s.raw->'offices') > 1
        THEN (SELECT json_agg(o->>'country_code') FROM jsonb_array_elements(s.raw->'offices') o) END,
      'sf', CASE WHEN s."sourceFacts"->>'sourceType' = 'SUCCESSFACTORS' AND jsonb_typeof(s.raw->'jobLocationShort') = 'array'
        AND jsonb_array_length(s.raw->'jobLocationShort') > 1 THEN s.raw->'jobLocationShort' END) ORDER BY s.id)
    FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > ${MAINTENANT})))::text
FROM "Job" j JOIN "Company" c ON c.id = j."companyId" WHERE ${PUBLIABLE};
\\else
\\echo REFUS_GARDE
\\endif
COMMIT;`;

// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, encoding: 'utf8', maxBuffer: 1 << 29,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: repetition ? 'prefer' : 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'multi-pays-mesure' },
});
if (run.status !== 0) { console.error(run.stderr.replace(/password[^\n]*/gi, '<masqué>')); process.exit(run.status ?? 1); }
const lignes = run.stdout.split('\n').filter(Boolean);
if (lignes.includes('REFUS_GARDE')) refus('garde de lecture seule non satisfaite, aucune mesure exécutée');
const lire = <T,>(tag: string) => lignes.filter((l) => l.startsWith(`${tag}\t`)).map((l) => JSON.parse(l.slice(tag.length + 1)) as T);

type Lieu = [string | null, string | null, string | null, string | null, string | null];
type Source = { k: string; can: boolean; t: string; st: string; l: Lieu[] | null; wttj: (string | null)[] | null; sf: string[] | null };
type Offre = { id: string; cc: string | null; maison: string; titre: string; sources: Source[] };
const [garde] = lire<Record<string, unknown>>('G');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== ROLE) refus('garde absente');
const [fraicheur] = lire<Record<string, unknown>>('F');
const offres = lire<Offre>('L');

/** Le pays d'UN lieu déclaré, par la chaîne de `retainedCountryOf` (publication/content.ts:82-92). */
function paysDuLieu([label, city, region, postal, country]: Lieu) {
  const champ = country?.trim() || null;
  const iso = normalizeCountry(champ);
  const forme = !champ ? 'ABSENT' : iso && /^[a-z]{2}$/i.test(champ) ? 'CODE_ISO2' : iso ? 'NOM_DE_PAYS' : 'ILLISIBLE';
  const libelle = label ?? ([city, region, postal].filter(Boolean).join(', ') || null);
  const pays = iso ?? resolveGeography({ rawCountry: champ, location: libelle, city }).countryCode
    ?? countryFromLocation(libelle) ?? (isFranceJob(undefined, libelle ?? undefined) ? 'FR' : undefined);
  return { forme, pays };
}

const marcheDuPays = new Map<string, string>();
for (const code of CODES_MARCHE) for (const p of marche(code)!.pays) marcheDuPays.set(p, code);
const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m: Map<string, number>, n = 50) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

const statutCanon = new Map<string, number>(), formes = new Map<string, number>(), formesParType = new Map<string, number>();
const multiParType = new Map<string, number>(), multiParSource = new Map<string, number>(), parNombre = new Map<string, number>();
const combinaisons = new Map<string, number>(), choix = new Map<string, number>(), couples = new Map<string, number>();
const couplesParMarche = new Map<string, number>(), paysNonProjetes = new Map<string, number>();
let publiables = 0, declarees = 0, multiLieux = 0, multiPays = 0, incertaines = 0, unionSeule = 0, contradiction = 0;
let lieuxDeclares = 0, zoneWttj = 0, zoneSf = 0;
const exemples: unknown[] = [];

for (const o of offres) {
  publiables++;
  const canon = o.sources.find((s) => s.can);
  inc(statutCanon, `${canon?.t ?? 'SANS_CANONIQUE'}:${canon?.st ?? '-'}`);
  const union = new Set<string>();
  for (const s of o.sources) for (const l of s.l ?? []) { const p = paysDuLieu(l).pays; if (p) union.add(p); }
  // Sondes de la zone aveugle (lecteur de lieux non qualifié) : une offre comptée une fois.
  if (o.sources.some((s) => s.wttj && new Set(s.wttj.map((c) => normalizeCountry(c)).filter(Boolean)).size > 1)) zoneWttj++;
  // Lieux courts RMK en ISO-3 (« CHE ») : lus par le parseur de l'adaptateur, jamais devinés ; un lieu sans pays ne compte pas.
  if (canon?.sf && new Set(canon.sf.map((x) => normalizeCountry(parseRmkLocation(x).country)).filter(Boolean)).size > 1) zoneSf++;
  if (!canon || canon.st !== 'DECLARED' || !canon.l) { if (union.size > 1) unionSeule++; continue; }
  declarees++;
  const lus = canon.l.map(paysDuLieu);
  lieuxDeclares += lus.length;
  for (const l of lus) {
    const cle = l.forme === 'ABSENT' ? (l.pays ? 'ABSENT:deduit_du_libelle' : 'ABSENT:aucun_pays') : l.forme === 'ILLISIBLE' ? (l.pays ? 'ILLISIBLE:deduit' : 'ILLISIBLE:aucun_pays') : l.forme;
    inc(formes, cle); inc(formesParType, `${canon.t}|${cle}`);
  }
  const pays = new Set(lus.map((l) => l.pays).filter((p): p is string => !!p));
  if (lus.length > 1) multiLieux++;
  if (pays.size < 2) {
    if (union.size > 1) unionSeule++;
    if (lus.length > 1 && pays.size === 1 && lus.some((l) => !l.pays)) incertaines++;
    if (pays.size === 1 && o.cc && !pays.has(o.cc)) contradiction++;
    continue;
  }
  multiPays++;
  inc(multiParType, canon.t); inc(multiParSource, canon.k); inc(parNombre, String(pays.size));
  inc(combinaisons, [...pays].sort().join('+'));
  const premier = lus.find((l) => l.pays)?.pays;
  inc(choix, !o.cc ? 'PROJECTION_SANS_PAYS' : o.cc === premier ? 'PREMIER_LIEU_PAYSE' : pays.has(o.cc) ? 'AUTRE_LIEU_DECLARE' : 'HORS_DES_LIEUX_DECLARES');
  for (const p of pays) {
    if (p === o.cc) continue;
    inc(paysNonProjetes, p);
    const m = marcheDuPays.get(p);
    const perimetre = m ? marche(m)!.pays as readonly string[] : [];
    const classe = !o.cc ? 'OFFRE_SANS_PAYS_PROJETE' : !m ? 'PAYS_HORS_DES_41_MARCHES' : perimetre.includes(o.cc) ? 'MEME_MARCHE_COMPOSITE_HORS_FILTRE_PAYS' : 'ABSENTE_DU_MARCHE';
    inc(couples, classe);
    if (classe === 'ABSENTE_DU_MARCHE') inc(couplesParMarche, m!);
  }
  if (exemples.length < 10) exemples.push({ id: o.id, maison: o.maison, titre: o.titre, source: canon.k, projete: o.cc, declares: [...pays].sort(), lieux: lus.length });
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(2)} %` : '—');
const resultat = {
  garde, fraicheur, publiables, avecLieuxDeclares: declarees, zoneAveugle: publiables - declarees,
  statutCanonique: Object.fromEntries(top(statutCanon, 100)), multiLieux, multiPays,
  partMultiPays: { surPubliables: pct(multiPays, publiables), surLieuxDeclares: pct(multiPays, declarees) },
  multiPaysParType: Object.fromEntries(top(multiParType)), multiPaysParSource: Object.fromEntries(top(multiParSource, 20)),
  multiPaysParNombreDePays: Object.fromEntries(top(parNombre)), combinaisons: Object.fromEntries(top(combinaisons, 20)),
  choixDuPaysProjete: Object.fromEntries(top(choix)), couples: Object.fromEntries(top(couples)),
  couplesAbsentsParMarche: Object.fromEntries(top(couplesParMarche)), paysNonProjetes: Object.fromEntries(top(paysNonProjetes, 30)),
  incertainesUnPaysPlusLieuxSansPays: incertaines, multiPaysSeulementViaSourcesSecondairesOuZoneAveugle: unionSeule,
  paysProjeteContreditUnPaysDeclareUnique: contradiction,
  lieuxDeclares, formesDuPays: Object.fromEntries(top(formes)), formesParType: Object.fromEntries(top(formesParType, 60)),
  sondesZoneAveugle: { wttjBureauxDansPlusieursPays: zoneWttj, successfactorsLieuxCourtsPlusieursPays: zoneSf }, exemples,
};

if (sortieJson) { console.log(JSON.stringify(resultat, null, 2)); process.exit(0); }
console.log(`═══ MULTI-PAYS — base ${String(garde.base)} · rôle ${String(garde.role)} · lecture seule ${String(garde.lectureSeule)} · ${String(garde.maintenant)} ═══`);
console.log(`fraîcheur : Job.updatedAt max ${String(fraicheur.jobMajMax)} · JobSource.lastSeenAt max ${String(fraicheur.sourceVueMax)}`);
console.log(`offres publiables : ${publiables} · lieux déclarés lisibles (canonique DECLARED) : ${declarees} · zone aveugle : ${publiables - declarees}`);
console.log(`plusieurs lieux : ${multiLieux} · PLUSIEURS PAYS : ${multiPays} (${resultat.partMultiPays.surPubliables} des publiables, ${resultat.partMultiPays.surLieuxDeclares} des lisibles)`);
for (const [titre, valeur] of Object.entries(resultat).filter(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !['garde', 'fraicheur', 'partMultiPays'].includes(k))) {
  console.log(`\n── ${titre}`); for (const [k, v] of Object.entries(valeur as object)) console.log(`  ${k.padEnd(48)} ${String(v)}`);
}
console.log(`\nincertaines (1 pays + lieux sans pays) : ${incertaines} · multi-pays seulement par une source secondaire ou la zone aveugle : ${unionSeule} · pays projeté ≠ pays déclaré unique : ${contradiction}`);
console.log('\n── exemples'); for (const e of exemples) console.log(`  ${JSON.stringify(e)}`);
