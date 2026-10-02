/**
 * R-143 §4 — mesure À BLANC du dédoublonnage par preuves natives (02/10/2026). Aucune écriture.
 *
 * Entrées : les deux extractions en lecture seule de ce dossier (`extraction-publications.sql`,
 * `extraction-offres-servies.sql`), une ligne JSON par enregistrement.
 * Rejouer, depuis la racine du dépôt :
 *   npx tsx audits/2026-10-02/r143-dedoublonnage-maison/mesure-dedoublonnage.mts <publications.jsonl> <servies.jsonl> [--echantillon=20]
 *
 * La mesure appelle les lecteurs d'identité du code (blockingKey, publicationIdentityProof, provenPublicationGroup) et la
 * règle d'autorité existante (selectApplySource) ; elle ne réimplémente aucune preuve.
 * Une fusion n'est comptée que si TOUTES les publications des offres concernées sont lues et prouvées deux à deux :
 * c'est la condition de la réparation (`dedup/repair.ts`, prepare()).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { blockingKey, provenPublicationGroup, publicationIdentityProof, type NativePublication } from '../../../apps/aggregator/src/dedup/match.js';
import { teamtailorDelegatedIdentity } from '../../../apps/aggregator/src/identity/teamtailor.js';
import { smartRecruitersPublicationIdentity } from '../../../apps/aggregator/src/identity/smartrecruiters.js';
import { selectApplySource } from '../../../packages/db/publications.js';

type Pub = NativePublication & { jobId: string; companyId: string; sourceTier: string; kind: string; title: string; city: string | null;
  postedAt: string | null; expiresAt: string | null; isActive: boolean };
type Served = { jobId: string; companyId: string; src: string; t: string; c: string; actives: number; toutes: number };

const [pubFile, servedFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const sampleSize = Number(process.argv.find(a => a.startsWith('--echantillon='))?.split('=')[1] ?? 20);
/** `--fusions=<fichier>` : la liste complète des fusions (motif, offres, publications), pour une contre-épreuve. */
const mergesFile = process.argv.find(a => a.startsWith('--fusions='))?.split('=')[1];
const lines = <T>(file: string) => readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);
const pubs = lines<Pub>(pubFile).map(p => ({ ...p, expiresAt: p.expiresAt ? new Date(p.expiresAt) : null }));
const served = new Map(lines<Served>(servedFile).map(s => [s.jobId, s]));

const NEW_KEYS = ['["requisition","successfactors-v1"', '["feed-publication","teamtailor-v1"', '["feed-publication","smartrecruiters-v1"'];
function motif(group: Pub[]): string {
  const key = blockingKey(group[0]);
  if (key.includes('successfactors-v1')) return 'réquisition SAP : portail LVMH ↔ site RMK Sephora';
  if (key.includes('teamtailor-v1')) return group.some(p => teamtailorDelegatedIdentity(p)) ? 'Teamtailor : fiche de l’enseigne hébergée par le site du groupe' : 'Teamtailor : preuve déjà en place';
  return group.some(p => smartRecruitersPublicationIdentity(p)?.delegated) ? 'SmartRecruiters : publication citée par WTTJ' : 'SmartRecruiters : deux flux de l’éditeur';
}

// 1. Regroupement par (employeur, clé d'identité), puis union des offres qu'une même identité relie.
const byKey = new Map<string, Pub[]>();
const crossEmployer = new Map<string, Set<string>>();
for (const p of pubs) {
  const key = blockingKey(p);
  if (!NEW_KEYS.some(prefix => key.startsWith(prefix))) continue;
  (byKey.get(`${p.companyId} ${key}`) ?? byKey.set(`${p.companyId} ${key}`, []).get(`${p.companyId} ${key}`)!).push(p);
  (crossEmployer.get(key) ?? crossEmployer.set(key, new Set()).get(key)!).add(p.companyId);
}
const parent = new Map<string, string>();
const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
for (const group of byKey.values()) {
  const jobs = [...new Set(group.map(p => p.jobId))];
  for (const j of jobs.slice(1)) parent.set(find(j), find(jobs[0]));
}
const components = new Map<string, Set<string>>();
for (const group of byKey.values()) for (const p of group) {
  const root = find(p.jobId);
  (components.get(root) ?? components.set(root, new Set()).get(root)!).add(p.jobId);
}
const pubsByJob = new Map<string, Pub[]>();
for (const p of pubs) (pubsByJob.get(p.jobId) ?? pubsByJob.set(p.jobId, []).get(p.jobId)!).push(p);

// 2. Une composante de plusieurs offres fusionne si toutes ses publications sont lues et prouvées deux à deux.
type Merge = { motif: string; jobs: string[]; survivor: string; members: Pub[] };
const merges: Merge[] = [];
const refused: Record<string, number> = {};
for (const jobs of components.values()) {
  if (jobs.size < 2) continue;
  const ids = [...jobs].sort();
  const members = ids.flatMap(id => pubsByJob.get(id) ?? []);
  const label = motif(members.filter(p => NEW_KEYS.some(prefix => blockingKey(p).startsWith(prefix))));
  const unread = ids.filter(id => { const s = served.get(id); return !s || s.toutes !== (pubsByJob.get(id) ?? []).length; });
  if (unread.length) { refused[`${label} — publications non lues (closes ou d’un autre lecteur)`] = (refused[`${label} — publications non lues (closes ou d’un autre lecteur)`] ?? 0) + 1; continue; }
  if (!provenPublicationGroup(members)) { refused[`${label} — preuve deux à deux absente`] = (refused[`${label} — preuve deux à deux absente`] ?? 0) + 1; continue; }
  const owner = selectApplySource(members, {});
  merges.push({ motif: label, jobs: ids, survivor: owner?.jobId ?? ids[0], members });
}

// 3. Doublons servis avant / après : la mesure Q6 de D-513 (même Maison, intitulé normalisé, ville, sources différentes).
function visibleDuplicates(rows: Iterable<Served>) {
  const groups = new Map<string, { n: number; src: Set<string> }>();
  for (const r of rows) {
    if (!r.c) continue;
    const k = `${r.companyId} ${r.t} ${r.c}`;
    const g = groups.get(k) ?? groups.set(k, { n: 0, src: new Set() }).get(k)!;
    g.n++; g.src.add(r.src);
  }
  let count = 0, offers = 0;
  for (const g of groups.values()) if (g.src.size > 1) { count++; offers += g.n; }
  return { groupes: count, offres: offers, en_trop: offers - count };
}
const absorbed = new Set(merges.flatMap(m => m.jobs.filter(j => j !== m.survivor)));
const after = [...served.values()].filter(s => !absorbed.has(s.jobId)).map(s => {
  const m = merges.find(x => x.survivor === s.jobId);
  return m ? { ...s, src: selectApplySource(m.members, {})!.sourceKey } : s;
});
const multi = (rows: Served[], extra: Map<string, number>) => rows.filter(r => (extra.get(r.jobId) ?? r.actives) > 1).length;
const activeAfter = new Map(merges.map(m => [m.survivor, m.members.filter(p => p.isActive).length]));

const byMotif: Record<string, { fusions: number; offres_retirees: number }> = {};
for (const m of merges) {
  const row = byMotif[m.motif] ?? (byMotif[m.motif] = { fusions: 0, offres_retirees: 0 });
  row.fusions++; row.offres_retirees += m.jobs.length - 1;
}
const crossEmployerKeys = [...crossEmployer.values()].filter(s => s.size > 1).length;

console.log(JSON.stringify({
  publications_lues: pubs.length, offres_servies_avant: served.size, offres_servies_apres: after.length,
  fusions_par_motif: byMotif, refus_par_motif: refused, identites_prouvees_sur_deux_employeurs: crossEmployerKeys,
  doublons_visibles_avant: visibleDuplicates(served.values()), doublons_visibles_apres: visibleDuplicates(after),
  offres_a_plusieurs_publications_actives: { avant: multi([...served.values()], new Map()), apres: multi(after, activeAfter) },
}, null, 2));

if (mergesFile) writeFileSync(mergesFile, merges.map(m => JSON.stringify({ motif: m.motif, survivor: m.survivor, jobs: m.jobs,
  publications: m.members.map(p => ({ sourceKey: p.sourceKey, externalId: p.externalId, jobId: p.jobId, title: p.title, city: p.city })) })).join('\n') + '\n');

// 4. Échantillon à relire à la main : tirage déterministe (empreinte de l'identifiant), stratifié par motif.
const seeded = (s: string) => createHash('sha256').update(`r143-relecture:${s}`).digest('hex');
const motifs = Object.keys(byMotif);
const sample: Merge[] = [];
for (let i = 0; sample.length < Math.min(sampleSize, merges.length); i++) {
  const pool = merges.filter(m => m.motif === motifs[i % motifs.length] && !sample.includes(m)).sort((a, b) => seeded(a.survivor).localeCompare(seeded(b.survivor)));
  if (pool[0]) sample.push(pool[0]); else if (motifs.every(mo => merges.filter(m => m.motif === mo).every(m => sample.includes(m)))) break;
}
console.log('\n| # | motif | publication | intitulé | ville | publiée | preuve |');
console.log('|---|---|---|---|---|---|---|');
sample.forEach((m, i) => m.members.forEach((p, k) => {
  const proof = k === 0 ? '—' : publicationIdentityProof(m.members[0], p)?.identity.requisition ?? 'AUCUNE';
  console.log(`| ${k === 0 ? i + 1 : ''} | ${k === 0 ? m.motif : ''} | ${p.sourceKey} ${p.externalId} | ${p.title.replace(/\|/g, '/')} | ${p.city ?? ''} | ${p.postedAt?.slice(0, 10) ?? ''} | ${proof} |`);
}));
