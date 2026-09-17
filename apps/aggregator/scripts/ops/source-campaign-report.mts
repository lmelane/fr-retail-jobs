/**
 * Rapport d'une ou plusieurs vagues de qualification (lot F3) : lit les `verdicts.json` produits par
 * `source-campaign.mts` et rend, sans réseau ni base, les comptes par verdict, par famille et par motif, les
 * volumes d'offres observées et la liste des sources par verdict. Lecture seule ; c'est la matière du registre
 * de qualification livré (F8), jamais une décision.
 *
 * usage: source-campaign-report.mts <verdicts.json> [<verdicts.json>…] [--out=<rapport.json>] [--keys] [--registry=<registre.md>]
 *
 * `--registry` écrit le registre de qualification source par source (livrable F8) : verdict, capacités prouvées
 * (collecte, publication et motifs de refus d'écriture, absence), preuve d'identité, écarts du registre de production.
 * Il ne contient ni configuration native ni identifiant privé : clés de source, Maisons, portails publics, verdicts.
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Verdict = { key: string; kind: string; maison: string; verdict: string; raisons: string[]; offres?: number; evalueLe?: string; readerRevision?: string; capacites?: Record<string, string>;
  ingestion?: { created?: number; updated?: number; errors?: number; errorKinds?: Record<string, number> }; absence?: { eligible?: boolean | null; termination?: string | null }; dureeMs: number; etapes?: Record<string, any> };

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
const registry = process.argv.find(a => a.startsWith('--registry='))?.slice(11);
if (!files.length) throw new Error('usage: source-campaign-report.mts <verdicts.json>… [--out=rapport.json] [--keys]');
const verdicts: Verdict[] = files.flatMap(f => JSON.parse(readFileSync(f, 'utf8')) as Verdict[]);
// Une clé peut apparaître dans plusieurs vagues (rejeu) : le dernier verdict rendu (par sa date d'évaluation, pas par l'ordre des fichiers) fait foi.
const latest = new Map<string, Verdict>();
for (const v of [...verdicts].sort((a, b) => String(a.evalueLe ?? '').localeCompare(String(b.evalueLe ?? '')))) latest.set(v.key, v);
const rows = [...latest.values()];

const count = (items: Verdict[], by: (v: Verdict) => string) => {
  const m: Record<string, number> = {};
  for (const v of items) { const k = by(v); m[k] = (m[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};
/** Le motif principal, ramené à sa famille (avant le premier deux-points ou parenthèse). */
const motif = (v: Verdict) => (v.raisons[0] ?? '').replace(/\s*[(:].*$/, '').slice(0, 90) || '(aucun)';
const offres = (items: Verdict[]) => items.reduce((sum, v) => sum + (v.offres ?? 0), 0);
const publiees = (items: Verdict[]) => items.reduce((sum, v) => sum + (v.ingestion?.created ?? 0) + (v.ingestion?.updated ?? 0), 0);

const report = {
  sources: rows.length,
  verdicts: count(rows, v => v.verdict),
  parFamille: Object.fromEntries([...new Set(rows.map(v => v.kind))].sort().map(kind => {
    const items = rows.filter(v => v.kind === kind);
    const qualified = items.filter(v => v.verdict === 'QUALIFIEE');
    return [kind, { sources: items.length, verdicts: count(items, v => v.verdict), offresObserveesQualifiees: offres(qualified), offresPubliees: publiees(qualified), publication: count(qualified, v => v.capacites?.publication ?? 'NON_TESTEE'), offresObservees: offres(items) }];
  })),
  motifsParVerdict: Object.fromEntries(Object.keys(count(rows, v => v.verdict)).filter(k => k !== 'QUALIFIEE').map(k => [k, count(rows.filter(v => v.verdict === k), motif)])),
  lecteurs: count(rows, v => v.readerRevision ?? 'inconnu'),
  qualifiees: { sources: rows.filter(v => v.verdict === 'QUALIFIEE').length, offresObservees: offres(rows.filter(v => v.verdict === 'QUALIFIEE')), offresPubliees: publiees(rows.filter(v => v.verdict === 'QUALIFIEE')),
    publication: count(rows.filter(v => v.verdict === 'QUALIFIEE'), v => v.capacites?.publication ?? 'NON_TESTEE'),
    absenceEligible: rows.filter(v => v.verdict === 'QUALIFIEE' && v.absence?.eligible === true).length,
    ingestion: rows.filter(v => v.ingestion).reduce((acc, v) => ({ created: acc.created + (v.ingestion?.created ?? 0), updated: acc.updated + (v.ingestion?.updated ?? 0), errors: acc.errors + (v.ingestion?.errors ?? 0) }), { created: 0, updated: 0, errors: 0 }) },
  dureeTotaleS: Math.round(rows.reduce((s, v) => s + v.dureeMs, 0) / 1000),
  ...(process.argv.includes('--keys') ? { sourcesParVerdict: Object.fromEntries(Object.keys(count(rows, v => v.verdict)).map(k => [k, rows.filter(v => v.verdict === k).map(v => `${v.key} (${v.offres ?? '-'})`)])) } : {}),
};
const json = JSON.stringify(report, null, 2) + '\n';
if (out) writeFileSync(out, json, { mode: 0o600 });
console.log(json);

if (registry) {
  const cell = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
  const identity = (v: Verdict) => {
    const proof = (v.etapes?.identite as { url?: string; verdict?: string; canonicalPortal?: string }[] | undefined)?.find(t => t.verdict === 'LINK_MATCHED');
    if (!proof) { const first = (v.etapes?.identite as { reason?: string; status?: number }[] | undefined)?.[0]; return first ? `non prouvée (${first.reason ?? first.status ?? '?'})` : 'non inspectée'; }
    return proof.canonicalPortal ? `redirection canonique vers ${proof.canonicalPortal}` : `page ${proof.url}`;
  };
  const publication = (v: Verdict) => {
    if (!v.ingestion) return v.verdict === 'QUALIFIEE' ? 'non ingérée' : '—';
    const kinds = v.ingestion.errorKinds ? Object.entries(v.ingestion.errorKinds).map(([k, n]) => `${k} ×${n}`).join(', ') : v.ingestion.errors ? `${v.ingestion.errors} refus (motif non consigné)` : '';
    return `${v.ingestion.created ?? 0} créées, ${v.ingestion.updated ?? 0} mises à jour${kinds ? ` ; refusées : ${kinds}` : ''}`;
  };
  const gaps = (v: Verdict) => [
    v.etapes?.domaineOfficielSuggere ? `domaine officiel absent du registre (suggestion : ${v.etapes.domaineOfficielSuggere})` : '',
    v.etapes?.domaineOfficiel?.source === 'source-careers' ? 'domaine officiel dérivé du domaine carrière par le catalogue (source-careers), non revu indépendamment' : '',
    v.etapes?.portailCanonique ? `hôte canonique hors domaine officiel : ${v.etapes.portailCanonique}` : '',
    v.verdict === 'DOMAINE_OFFICIEL_DIVERGENT' ? v.raisons[0] : '',
  ].filter(Boolean).join(' ; ');
  const lines = [
    '# Registre de qualification des sources (campagne F3)', '',
    `Généré le ${new Date().toISOString()} depuis ${rows.length} verdict(s) (${files.length} vague(s)). Un verdict n'est jamais une décision : chaque ligne renvoie aux décisions natives (identité, accès, validation, admission) liées au lecteur figé de la campagne.`, '',
    '| Source | Maison | Famille | Verdict | Domaine officiel (provenance) | Identité | Collecte (observées / qualifiées) | Accès | Publication (capacité) | Absence | Écarts du registre | Motif |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)).map(v => {
      const collecte = v.etapes?.collecte?.report as { observed?: number; qualified?: number } | undefined;
      const acces = v.etapes?.decisionAcces as { verdict?: string } | undefined;
      const perimetre = v.etapes?.acces as { scopes?: { path: { kind: string; value: string } }[]; derivation?: { climbs?: number } } | undefined;
      // Un portail dont les offres vivent à la racine ne reçoit que des périmètres EXACT : sa première offre nouvelle exige une requalification.
      const racine = perimetre?.scopes?.length && perimetre.scopes.every(s => s.path.kind === 'EXACT' && /^\/[^/]+$/.test(s.path.value)) ? ` (racine : ${perimetre.scopes.length} EXACT, requalification à chaque offre nouvelle)` : '';
      const remontees = perimetre?.derivation?.climbs ? ` (${perimetre.derivation.climbs} remontée(s) de répertoire)` : '';
      const absence = v.absence ? (v.absence.eligible ? `éligible (${v.absence.termination ?? '—'})` : `non éligible (${v.absence.termination ?? 'première ingestion'})`) : '—';
      const officialDomain = v.etapes?.domaineOfficiel ? `${v.etapes.domaineOfficiel.value} (${v.etapes.domaineOfficiel.source})` : '—';
      return `| ${cell(v.key)} | ${cell(v.maison)} | ${cell(v.kind)} | ${cell(v.verdict)} | ${cell(officialDomain)} | ${cell(identity(v))} | ${collecte ? `${collecte.observed ?? '?'} / ${collecte.qualified ?? '?'}` : '—'} | ${cell(`${acces?.verdict ?? (v.verdict === 'REFUSEE' ? 'NOT_AUTHORIZED' : '—')}${racine}${remontees}`)} | ${cell(`${v.capacites?.publication ?? '—'} : ${publication(v)}`)} | ${cell(absence)} | ${cell(gaps(v))} | ${cell(v.verdict === 'QUALIFIEE' ? '' : v.raisons[0]?.slice(0, 160))} |`;
    }),
  ];
  writeFileSync(registry, lines.join('\n') + '\n');
  console.error(`registre : ${rows.length} lignes → ${registry}`);
}
