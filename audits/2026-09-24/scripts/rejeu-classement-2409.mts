/**
 * REJEU DU CLASSEMENT DU RUN DU 24/09/2026 (runId 35ba463f, image 2cc91d8) — hors base, avec le code réel.
 *
 * ── CE QUE « REJOUÉ » VEUT DIRE ──────────────────────────────────────────────────────────────
 *
 * Seul le CLASSEMENT est rejoué : santé de chaque source, attribution, ligne d'échec, bilan et objet de
 * l'alerte, recalculés sur les chiffres que le RUN a enregistrés (`rejeu-classement-2409-extraction.mts`).
 * Aucune source n'est recollectée, aucune écriture n'a lieu, aucune base n'est ouverte.
 *
 * Deux passes sur les MÊMES données :
 *   · ANCIEN = le code du RUN lui-même, `git archive 2cc91d8`, matérialisé dans un dossier temporaire
 *     puis supprimé. Il doit reproduire EXACTEMENT le bilan et le classement enregistrés : c'est le
 *     contrôle du rejeu ; s'il échoue, aucun chiffre du rejeu ne vaut.
 *   · NOUVEAU = l'arbre de travail.
 *
 * L'énumération d'une source que le RUN a enregistrée `complete: false` est relue sur sa preuve SCELLÉE
 * (manifeste de la collecte ingérée), comme `ingest.ts` la lit désormais (`readEnumeration`). La garde de la
 * preuve négative reçoit la référence que `health.ts` lirait : le dernier RUN complet où la source a été
 * collectée (extraction, requête PR). Le contrôle passe AVANT toute sortie, `--json` compris.
 *
 *   npx tsx audits/2026-09-24/scripts/rejeu-classement-2409.mts audits/2026-09-24/rejeu-classement-2409.json [--json <sortie>]
 */
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nouvelleSante from '../../../apps/aggregator/src/pipeline/health.ts';
import * as nouveauClassement from '../../../apps/aggregator/src/lib/ingestionIssue.ts';
import * as nouveauBilan from '../../../apps/aggregator/src/lib/runSummary.ts';
import * as nouvelleLecture from '../../../apps/aggregator/src/pipeline/enumerationReading.ts';
import * as nouvelleAlerte from '../../../apps/aggregator/src/pipeline/alert.ts';
import * as nouvelleDisposition from '../../../apps/aggregator/src/pipeline/publicationDisposition.ts';
import * as nouvelOrchestrateur from '../../../apps/aggregator/src/pipeline/ingestOrchestrator.ts';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const REVISION_DU_RUN = '2cc91d8';
const DEPOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const donnees = process.argv[2] ?? refus('extraction requise (rejeu-classement-2409-extraction.mts)');
const sortieJson = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] ?? refus('--json <sortie>') : undefined;

type Issue = { origin: string; code: string; count: number; captureBatchId?: string; rawCaptureId?: string; completionReportHash?: string };
type Stat = Record<string, unknown> & { source: string; complete?: boolean; held?: number; fetched: number; inSector: number };
const d = JSON.parse(readFileSync(donnees, 'utf8'));
const sr = new Map<string, any>(d.SR.map((x: any) => [x.source, x]));
const precedent = new Map<string, { fetched: number; accepted: number }>(d.PR.map((x: any) => [x.source, { fetched: x.fetched, accepted: x.accepted }]));
const sc = new Map<string, Stat>(d.SC.map((x: any) => [x.source, x.stat]));
const manifeste = new Map<string, any>(d.MF.map((x: any) => [x.source, x]));
const genre = new Map<string, string>(d.ST.map((x: any) => [x.source, x.kind]));
const enregistre = new Map<string, Issue[]>(d.EV.filter((e: any) => e.event === 'source.issue_classified').map((e: any) => [e.source, e.payload.issues]));
const echecs = new Map<string, any>(d.EV.filter((e: any) => e.event === 'source.failed').map((e: any) => [e.source, e.payload]));
const bilanEnregistre = d.EV.find((e: any) => e.event === 'ingest.completed')?.payload ?? refus('bilan enregistré absent');
const retenues = new Map<string, Record<string, number>>();
for (const row of d.PH) retenues.set(row.source, { ...retenues.get(row.source), [row.reason]: Number(row.n) });


/** L'erreur telle que l'orchestrateur l'a attrapée, depuis son `source.failed` sérialisé. */
function attrapee(source: string): Error {
  const e = echecs.get(source)?.details?.[0]?.error ?? {};
  const cause = e.cause ? Object.assign(new Error(e.cause.message ?? ''), { name: e.cause.name, code: e.cause.code }) : undefined;
  if (e.name === 'TypeError') return new TypeError(e.message, cause ? { cause } : undefined);
  return Object.assign(new Error(e.message ?? ''), { name: e.name ?? 'Error', code: e.code });
}

/** Ce que `ingest.ts` enregistre désormais de l'énumération, relu sur la preuve scellée de la collecte ingérée. */
function lecture(source: string, stat: Stat): { enumerationReading: string; enumerationRefutedBy?: string[] } {
  if (stat.complete !== false) return { enumerationReading: stat.complete === true ? 'PROVEN' : 'UNKNOWN' };
  const m = manifeste.get(source) ?? refus(`preuve scellée absente pour ${source}`);
  const faits = { complete: m.complete, truncated: m.truncated, declaredTotal: m.declaredTotal, externalIds: m.externalIds,
    issues: [...m.issues, ...m.blockers], rejectedReasons: m.rejectedReasons };
  const verdict = nouvelleLecture.enumerationReading(faits);
  return { enumerationReading: verdict, ...(verdict === 'REFUTED' ? { enumerationRefutedBy: nouvelleLecture.refutingFacts(faits).slice(0, 5) } : {}) };
}

const cle = (issues: Issue[]) => issues.map(i => `${i.origin}/${i.code}×${i.count}`).sort().join(' ');
/** jsonb reorders keys: compare values, never key order. */
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
const part = (fetched: number, accepted: number) => fetched > 0 ? `${((fetched - accepted) / fetched * 100).toFixed(1).replace('.', ',')} %` : 'n/d';

/** Un refus levé pendant le rejeu : le dossier temporaire est supprimé avant la sortie. */
class Refus extends Error {}
const echec = (motif: string): never => { throw new Refus(motif); };

async function rejouer(ancienneSante: any, ancienClassement: any, ancienBilan: any) {
  const vide = () => ({ total: sr.size, ok: 0, failed: 0, timedOut: 0, failures: [] as string[], incidents: [] as any[], issues: [] as any[] });
  const avant = vide(), apres = vide();
  const lignes: any[] = [];
  const faux = (jobs: number | null) => ({ sourceRun: { findMany: async (a: any) => a.where.ranAt || jobs === null ? [] : [{ sourceKey: a.where.sourceKey.in[0], jobs }],
    create: async () => ({}), deleteMany: async () => ({ count: 0 }) }, source: { updateMany: async () => ({ count: 1 }) } });

  for (const [source, run] of sr) {
    const stat = sc.get(source);
    let ancienIssues: Issue[], nouveauIssues: Issue[], note = '', incidentsNouveaux: any[], enumeration: string | undefined;
    if (!stat) {
      // Attrapée par l'orchestrateur avant la santé : un classement, un incident BROKEN.
      const erreur = attrapee(source);
      ancienIssues = [ancienClassement.ingestionIssue(erreur)];
      nouveauIssues = [nouveauClassement.ingestionIssue(erreur)];
      avant.incidents.push({ source, status: 'BROKEN' });
      incidentsNouveaux = [{ source, status: 'BROKEN', jobs: 0, previous: null, blocking: !nouveauClassement.isProvenSourceIssue(nouveauIssues[0]),
        note: `${nouveauIssues[0]!.origin}/${nouveauIssues[0]!.code}: ${erreur.message}` }];
      note = `${erreur.name}: ${erreur.message}`;
      const cause = run.status === 'TIMEOUT' ? 'délai dépassé' : run.status === 'CHALLENGED' ? 'anti-bot' : 'échec';
      if (run.status === 'TIMEOUT') apres.timedOut++; else apres.failed++;
      apres.failures.push(nouveauBilan.failureLine(source, nouveauIssues, cause));
      if (run.status === 'TIMEOUT') avant.timedOut++; else avant.failed++;
      avant.failures.push(`${source} (failed)`);
    } else {
      const s = { ...stat, heldReasons: retenues.get(source) };
      const ancienne = await ancienneSante.checkSourceHealth(faux(run.previous ?? null), [s]);
      ancienIssues = ancienClassement.issuesFromResult([s], ancienne.incidents.length);
      avant.incidents.push(...ancienne.incidents);
      if (ancienIssues.length) { avant.failed++; avant.failures.push(`${source} (ingest errors)`); } else avant.ok++;

      // Le chemin de `ingestOne` : santé pure, puis le classement de l'orchestrateur lui-même.
      const n = { ...s, ...lecture(source, s) };
      const sante = nouvelleSante.evaluateSourceHealth(n as never, run.previous ?? null, precedent.get(source) ?? null);
      const classe = nouvelOrchestrateur.classifySourceRun([n as never], sante.status === 'BROKEN' || sante.status === 'DEGRADED' ? [sante] : []);
      nouveauIssues = classe.issues;
      incidentsNouveaux = classe.incidents;
      if (nouveauIssues.length) { apres.failed++; apres.failures.push(nouveauBilan.failureLine(source, nouveauIssues as never, 'erreurs d’ingestion')); } else apres.ok++;
      note = sante.note ?? '';
      enumeration = n.enumerationReading;
    }
    avant.issues.push(...ancienIssues.map(i => ({ ...i, source })));
    apres.issues.push(...nouveauIssues.map(i => ({ ...i, source })));
    apres.incidents.push(...incidentsNouveaux);
    lignes.push({ source, kind: genre.get(source), avant: ancienIssues, apres: nouveauIssues, enregistre: enregistre.get(source) ?? [], note, enumeration,
      incidents: incidentsNouveaux, bloquant: incidentsNouveaux.some((i: any) => i.blocking !== false) });
  }

  const bilanAvant = ancienBilan.summarizeOrchestration(avant);
  const bilanApres = nouveauBilan.summarizeOrchestration(apres);
  const lectures = new Map(lignes.map(l => [l.source, l.enumeration]));
  const ecarts = lignes.filter(l => cle(l.avant) !== cle(l.enregistre)).map(l => `${l.source}: rejeu ${cle(l.avant)} ≠ enregistré ${cle(l.enregistre)}`);
  const pertinent = (b: any) => canon({ outcome: b.outcome, blockingReasons: b.blockingReasons, sources: b.sources, attribution: b.attribution, incidents: b.incidents });
  const controleBilan = JSON.stringify(pertinent(bilanAvant)) === JSON.stringify(pertinent(bilanEnregistre));
  // LE CONTRÔLE D'ABORD : sans lui, aucun chiffre du rejeu ne vaut, pas même dans le fichier `--json`.
  console.log('== CONTRÔLE : le code du RUN (2cc91d8) rejoué reproduit-il le bilan et le classement enregistrés ?');
  console.log('enregistré :', JSON.stringify(pertinent(bilanEnregistre)));
  console.log('rejoué     :', JSON.stringify(pertinent(bilanAvant)));
  console.log('bilan identique :', controleBilan, '· écarts par source :', ecarts.length ? ecarts.join(' | ') : 'aucun');
  if (!controleBilan || ecarts.length) echec('le rejeu ne reproduit pas le RUN : aucun chiffre ne vaut');
  // Les entrées propres au nouveau code, vérifiées elles aussi : retenues par motif, preuves scellées, références.
  const heldEcarts = [...sc].filter(([source, s]) => (s.held ?? 0) !== Object.values(retenues.get(source) ?? {}).reduce((a, b) => a + b, 0)).map(([source]) => source);
  if (heldEcarts.length) echec(`retenues par motif ≠ retenues du RUN : ${heldEcarts.join(', ')}`);
  const sansManifeste = [...sc].filter(([source, s]) => s.complete === false && !manifeste.has(source)).map(([source]) => source);
  if (sansManifeste.length) echec(`preuve scellée absente : ${sansManifeste.join(', ')}`);
  const referencesTardives = d.PR.filter((p: any) => !(p.ranAt < sr.get(p.source)?.ranAt)).map((p: any) => p.source);
  if (referencesTardives.length) echec(`référence postérieure au RUN : ${referencesTardives.join(', ')}`);

  const A = 'A. non bloquant : retenue (preuve de la source ou décision de l’équipe)';
  const groupe = (l: any) => !l.incidents.length && !l.apres.length ? null
    : !l.bloquant ? A
    : l.apres.some((i: Issue) => i.code === 'ENUMERATION_NOT_PROVEN') ? 'B. bloquant : énumération non prouvée (ex-« réfutée »)'
    : cle(l.avant) !== cle(l.apres) ? 'C. bloquant, reclassé'
    : 'D. bloquant, inchangé';
  const groupes = new Map<string, any[]>();
  for (const l of lignes) { const g = groupe(l); if (g) groupes.set(g, [...(groupes.get(g) ?? []), l]); }

  const retenuesParMotif: Record<string, { offres: number; sources: string[] }> = {};
  for (const [source, motifs] of retenues) for (const [motif, n] of Object.entries(motifs)) {
    retenuesParMotif[motif] = { offres: (retenuesParMotif[motif]?.offres ?? 0) + n, sources: [...(retenuesParMotif[motif]?.sources ?? []), source] };
  }
  const garde = (groupes.get(A) ?? []).filter(l => (retenues.get(l.source)?.[nouvelleDisposition.NEGATIVE_PROOF_RETENTION] ?? 0) > 0).map(l => {
    const run = sr.get(l.source); const p = precedent.get(l.source);
    return { source: l.source, reference: p ? part(p.fetched, p.accepted) : 'sans référence', maintenant: part(run.fetched, run.accepted), retenues: run.fetched - run.accepted };
  });
  const intersport = lignes.find(l => l.source === 'intersport-france');
  const alerte = nouvelleAlerte.alertSubject({ degraded: 0, broken: 0, incidents: apres.incidents });

  const resultat = { controle: { bilanIdentique: controleBilan, ecartsParSource: ecarts, enregistre: pertinent(bilanEnregistre), ancien: pertinent(bilanAvant) },
    nouveau: bilanApres, alerte, groupes: Object.fromEntries([...groupes].sort().map(([g, l]) => [g, l.map(x => ({ source: x.source, kind: x.kind,
      avant: cle(x.avant), apres: cle(x.apres), enumeration: lectures.get(x.source), note: x.note.slice(0, 220) }))])),
    retenuesParMotif: Object.fromEntries(Object.entries(retenuesParMotif).map(([m, v]) => [m, { ...v, classe: nouvelleDisposition.retentionClass(m) }])),
    gardeRetenue: garde, intersport: intersport && { avant: cle(intersport.avant), apres: cle(intersport.apres), bloquant: intersport.bloquant, note: intersport.note } };
  if (sortieJson) { writeFileSync(sortieJson, JSON.stringify(resultat, null, 1)); console.log(`écrit ${sortieJson}`); return; }

  console.log('\n== NOUVEAU : le même RUN sous les règles de l’arbre de travail');
  console.log(JSON.stringify({ outcome: bilanApres.outcome, blockingReasons: bilanApres.blockingReasons, nonBlockingCauses: bilanApres.nonBlockingCauses,
    sources: bilanApres.sources, attribution: bilanApres.attribution, incidents: bilanApres.incidents }));
  console.log('retenues sur preuve de la source (bilan, sans troncature) :', JSON.stringify(bilanApres.nativeRetentions));
  console.log('écartées par l’équipe :', JSON.stringify(bilanApres.teamExclusions), '· garde sans référence :', bilanApres.guardWithoutReference.length, 'sources');
  console.log('retenues des sources bloquantes :', JSON.stringify({ sources: bilanApres.retainedOnBlockingSources.sources, postings: bilanApres.retainedOnBlockingSources.postings }));
  console.log('objet de l’alerte :', alerte);
  for (const [g, l] of [...groupes].sort()) {
    console.log(`\n${g} — ${l.length} sources`);
    for (const x of l.sort((a: any, b: any) => a.source.localeCompare(b.source)))
      console.log(`  ${x.source.padEnd(28)} ${String(x.kind).padEnd(16)} ${cle(x.avant).padEnd(44)} → ${cle(x.apres).padEnd(48)} ${lectures.get(x.source) ?? ''} | ${x.note.slice(0, 150)}`);
  }
  console.log('\n== INTERSPORT (D-456 §1)');
  console.log(JSON.stringify(resultat.intersport));
  console.log('\n== RETENUES DU RUN PAR MOTIF (offres, sources) — classe : NATIVE et TEAM_DECISION ne bloquent pas');
  for (const [m, v] of Object.entries(retenuesParMotif).sort(([, a], [, b]) => b.offres - a.offres))
    console.log(`  ${m.padEnd(44)} ${String(v.offres).padStart(5)}  ${nouvelleDisposition.retentionClass(m).padEnd(13)} ${v.sources.join(', ')}`);
  console.log('\n== GARDE DE LA PREUVE NÉGATIVE (Workday) : part non publiée au RUN complet de référence → RUN du 24/09 (groupe A)');
  for (const g of garde) console.log(`  ${g.source.padEnd(28)} ${g.reference.padStart(14)} → ${g.maintenant.padStart(9)}  (${g.retenues} non publiées)`);
}

/** Le code du RUN, matérialisé hors du dépôt le temps du rejeu, puis supprimé, même quand le rejeu refuse. */
const copie = mkdtempSync(join(tmpdir(), `catwalks-rejeu-${REVISION_DU_RUN}-`));
try {
  const archive = spawnSync('git', ['-C', DEPOT, 'archive', '--format=tar', REVISION_DU_RUN, 'apps/aggregator', 'packages', 'package.json'], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) echec(`git archive ${REVISION_DU_RUN} : ${archive.stderr.toString().slice(0, 500)}`);
  if (spawnSync('tar', ['-x', '-C', copie], { input: archive.stdout }).status !== 0) echec('extraction de l’archive');
  symlinkSync(join(DEPOT, 'node_modules'), join(copie, 'node_modules'));
  symlinkSync(join(DEPOT, 'apps/aggregator/node_modules'), join(copie, 'apps/aggregator/node_modules'));
  const ancien = (chemin: string) => import(pathToFileURL(join(copie, 'apps/aggregator/src', chemin)).href);
  const [ancienneSante, ancienClassement, ancienBilan] = await Promise.all([ancien('pipeline/health.ts'), ancien('lib/ingestionIssue.ts'), ancien('lib/runSummary.ts')]);
  await rejouer(ancienneSante, ancienClassement, ancienBilan);
} catch (error) {
  if (!(error instanceof Refus)) throw error;
  console.error(`REFUS : ${error.message}`);
  process.exitCode = 3;
} finally {
  rmSync(copie, { recursive: true, force: true });
}
