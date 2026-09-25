/**
 * LES OFFRES SIMILAIRES D'UNE FICHE CATWALKS, AVANT ET APRÈS LA VILLE — conséquence de D-468 §1 sur D-456 §4, mesurée
 * avant la mise en production.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Le remplissage des offres similaires (`apps/api/lib/jobs.ts`, `getSimilarJobs`) prend des offres agrégées du même
 * pays, dont la société partage un code secteur avec l'offre, et, quand l'offre a une ville, de la MÊME ville (égalité
 * sans casse). Sans ville, une offre Catwalks recevait les offres du même secteur dans tout son pays ; avec la ville de
 * la liste (D-468 §1), elle ne reçoit plus que celles de sa ville. Pour chacune des offres Catwalks en ligne, combien de
 * candidates le remplissage trouve-t-il, avant (pays) et après (pays et ville) ? Une fiche fermée sans similaire n'a
 * plus d'issue que « Voir les offres ouvertes chez … » (site, `FicheEmploi.tsx`).
 *
 * ── LA POPULATION ────────────────────────────────────────────────────────────────────────────
 *
 * Les offres Catwalks : la liste publique du backend (`GET https://catwalks.api.catwalks.io/api/jobs`, route publique,
 * lecture), leur pays par le tracé des frontières (`geo/frontieres.ts`) et leurs codes secteur par la correspondance
 * (`direct/vocabulaire.ts`, `codesSecteur`), comme la projection. Offres agrégées publiables = `publicJobSql`
 * (packages/db/availability.ts), recopiée à l'identique. Aucune personne : des offres et des comptes.
 *
 * ── L'ACCÈS ──────────────────────────────────────────────────────────────────────────────────
 *
 * Production, rôle `catwalks_audit`, identifiants hors dépôt (`~/.catwalks/audit-access.json`), jamais affichés ;
 * transaction `READ ONLY` et garde éprouvée AVANT la mesure.
 *
 *   npx tsx audits/2026-09-25/scripts/similaires-meme-ville.mts [--json] [--liste=http://localhost:3001]
 *
 * `--liste` : l'origine de la liste publique. Au 25/09/2026, la production ne sert pas encore la ville (backend
 * `b51d2b2`, non livré) : la mesure « après » se lit sur un backend local de la branche `development`, branché sur la
 * même base (lecture seule). Seule une origine locale est admise en dehors de la production.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { paysDesCoordonnees } from '../../../apps/aggregator/src/geo/frontieres.js';
import { codesSecteur } from '../../../apps/aggregator/src/direct/vocabulaire.js';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const sortieJson = process.argv.includes('--json');
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

type Offre = { id: string; city: string | null; latitude: number | null; longitude: number | null; sectors: string[]; specializations: string[]; maison: { name: string } | null };
const origine = process.argv.find((a) => a.startsWith('--liste='))?.slice('--liste='.length) ?? 'https://catwalks.api.catwalks.io';
const hote = new URL(origine);
if (!(hote.origin === 'https://catwalks.api.catwalks.io' || (hote.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hote.hostname))))
  refus('liste : la production ou un backend local seulement');
const reponse = await fetch(new URL('/api/jobs', hote), { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
if (!reponse.ok) refus(`liste publique : HTTP ${reponse.status}`);
const offres = (await reponse.json()) as Offre[];
if (!Array.isArray(offres) || !offres.length) refus('liste publique vide ou illisible');
const servieAvecVille = offres.some((o) => 'city' in o);

const litteral = (s: string) => `'${s.replace(/'/g, "''")}'`;
const lignes = offres.map((o) => {
  const pays = paysDesCoordonnees(o.latitude, o.longitude).pays;
  const codes = codesSecteur(o.sectors ?? [], o.specializations ?? []);
  return { id: o.id, ville: o.city?.trim() || null, pays, codes, mandat: !o.maison };
});
const valeurs = lignes.map((l) => `(${litteral(l.id)}, ${l.pays ? litteral(l.pays) : 'NULL'}, ${l.ville ? litteral(l.ville) : 'NULL'}, ARRAY[${l.codes.map(litteral).join(',')}]::text[])`).join(',\n  ');

const MAINTENANT = `(now() AT TIME ZONE 'UTC')`;
const PUBLIABLE = `j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id
  AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt" > ${MAINTENANT}))`;

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
SELECT 'G' || E'\\t' || json_build_object('base', current_database(), 'role', current_user,
  'lectureSeule', current_setting('transaction_read_only'), 'maintenant', now())::text;
\\if :garde_ok
WITH o(id, pays, ville, codes) AS (VALUES
  ${valeurs}
)
SELECT 'O' || E'\\t' || json_build_object('id', o.id,
  'pays', (SELECT count(*) FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
            WHERE ${PUBLIABLE} AND cardinality(o.codes) > 0 AND j."countryCode" = o.pays AND c."sectorCodes" && o.codes),
  'ville', (SELECT count(*) FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
            WHERE ${PUBLIABLE} AND cardinality(o.codes) > 0 AND j."countryCode" = o.pays AND c."sectorCodes" && o.codes
              AND o.ville IS NOT NULL AND lower(j.city) = lower(o.ville)))::text
FROM o;
\\else
SELECT 'REFUS' || E'\\t' || 'garde';
\\endif
ROLLBACK;
`;

// Aucune variable `PG*` héritée (`PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`…) ne peut rediriger la connexion.
const environnement = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('PG')));
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script,
  env: { ...environnement, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'similaires-meme-ville' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.trim()}`);
const sortie = run.stdout.trim().split('\n').map((l) => l.split('\t'));
if (sortie.some(([t]) => t === 'REFUS')) refus('garde non satisfaite');
const garde = JSON.parse(sortie.find(([t]) => t === 'G')?.[1] ?? 'null');
if (!garde || garde.lectureSeule !== 'on' || garde.base !== BASE || garde.role !== 'catwalks_audit') refus('garde absente');

const comptes = new Map(sortie.filter(([t]) => t === 'O').map(([, v]) => JSON.parse(v) as { id: string; pays: number; ville: number }).map((c) => [c.id, c]));
const detail = lignes.map((l) => ({ ...l, avant: comptes.get(l.id)?.pays ?? 0, apres: comptes.get(l.id)?.ville ?? 0 }));
const LIMITE = 6; // `getSimilarJobs(job, 6)` sur la fiche.
const synthese = {
  offres: detail.length,
  listeServieAvecVille: servieAvecVille,
  sansCodeSecteur: detail.filter((d) => d.codes.length === 0).length,
  sansPays: detail.filter((d) => !d.pays).length,
  avant: { aucune: detail.filter((d) => d.avant === 0).length, moinsDeSix: detail.filter((d) => d.avant < LIMITE).length },
  apres: { aucune: detail.filter((d) => d.apres === 0).length, moinsDeSix: detail.filter((d) => d.apres < LIMITE).length },
  mandats: { total: detail.filter((d) => d.mandat).length, apresAucune: detail.filter((d) => d.mandat && d.apres === 0).length },
};
const parVille = [...new Set(detail.map((d) => `${d.pays ?? '?'} ${d.ville ?? '(sans ville)'}`))].map((cle) => {
  const ds = detail.filter((d) => `${d.pays ?? '?'} ${d.ville ?? '(sans ville)'}` === cle);
  return { lieu: cle, offres: ds.length, mandats: ds.filter((d) => d.mandat).length, minAvant: Math.min(...ds.map((d) => d.avant)), minApres: Math.min(...ds.map((d) => d.apres)) };
}).sort((a, b) => a.minApres - b.minApres || b.offres - a.offres);

if (sortieJson) console.log(JSON.stringify({ garde, synthese, parVille }, null, 1));
else {
  console.log(`garde ${JSON.stringify(garde)}`);
  console.log(JSON.stringify(synthese));
  for (const v of parVille) console.log(`${v.lieu}\t${v.offres} offre(s), ${v.mandats} mandat(s)\tcandidates min. avant ${v.minAvant} · après ${v.minApres}`);
}
