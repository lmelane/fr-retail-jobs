/**
 * PASSE DE CURATION v3, ÉTAPE 6c : VÉRIFIER CE QU'UNE EXPRESSION CAPTE VRAIMENT (R-66 §2 ; plan
 * `docs/architecture/classification-metiers.md` §3.1-§3.2).
 *
 * Les juges des étapes 1 à 4 ont validé des intitulés ENTIERS (« assistant manager » chez des enseignes de boutiques) ;
 * le moteur applique une expression à tout intitulé qui la CONTIENT. La mesure de justesse du 29/09/2026 a trouvé 20
 * faux sur 200 (« Assistant Manager, Brand Communications » → adjoint de boutique, « Designer » → responsable de
 * collection, « Vice President » → président). Une expression généralisée est un synonyme partagé : sa validation porte
 * sur ce qu'elle capte (R-66 §2). Ici, sur le manifeste v3 où toutes les expressions sont en mode « phrase » :
 *  - pour chaque expression, les couples (intitulé, service) du corpus qu'elle fait gagner ou changer de métier ALORS
 *    que l'intitulé n'est pas exactement l'expression ;
 *  - une expression qui capte au moins `SEUIL_OFFRES` offres est jugée sur `ECHANTILLON` intitulés captés (le plus
 *    fréquent, puis ceux qui ajoutent le plus de mots, les plus susceptibles de dévier) par le consensus des deux juges :
 *    tous confirmés → elle reste une expression ; un seul rejeté → elle ne vaut plus que pour l'intitulé exact ;
 *  - en dessous du seuil, sans preuve : intitulé exact.
 * Entrées : `6-manifeste-v3.json` (sans décision de 6c : l'étape le vérifie), l'export de preview, la version servie.
 * Sortie : `curation-v3/6c-generalisations.json`, que lit l'assemblage (étape 6). L'étape échoue si un verdict manque.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/6c-generalisations.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compileOccupationManifest, normalizeOccupationTitle } from '../../../../../packages/db/occupation-engine.ts';
import { DOSSIER_SORTIE, lireEtape, servie } from './commun.mts';
import { consensus, JUGES, MODELE_CHOIX, repondre } from './ia.mts';

/** Seuils de départ, à recalibrer : 187 expressions au-dessus captent 89 % des offres généralisées (29/09/2026). */
const SEUIL_OFFRES = 10, ECHANTILLON = 3;
const norme = (v: string) => normalizeOccupationTitle(v).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const v3 = lireEtape('6-manifeste-v3.json');
if (v3.rules.some((r: any) => r.id.startsWith('v3-') && r.all.some((c: any) => c.mode === 'exact')))
  throw new Error('manifeste de base attendu : refaire l’étape 6 sans 6c-generalisations.json avant de relancer 6c');
const { couples } = JSON.parse(gunzipSync(readFileSync(`${DOSSIER_SORTIE}entrees/offres-preview-2026-09-29.json.gz`)).toString('utf8'));
const moteurV1 = compileOccupationManifest(structuredClone(servie)), moteurV3 = compileOccupationManifest(v3);
const regles = new Map(v3.rules.map((r: any) => [r.id, r]));
const metier = new Map(v3.occupations.map((o: any) => [o.key, o]));

type Capture = { occupation: string; titres: Map<string, { offres: number; service: string | null }> };
const captures = new Map<string, Capture>();
for (const c of couples) {
  const a = moteurV1.classify(c.titre, c.service), b = moteurV3.classify(c.titre, c.service);
  if (!b.occupationCode || a.occupationCode === b.occupationCode) continue;
  for (const id of b.occupationEvidence.matchedRules) {
    const r: any = regles.get(id);
    if (!r?.id.startsWith('v3-') || r.occupation !== b.occupationCode) continue;
    const p = norme(r.all[0].any[0]);
    if (norme(c.titre) === p) continue;
    const x = captures.get(p) ?? { occupation: r.occupation, titres: new Map() };
    const t = x.titres.get(c.titre) ?? { offres: 0, service: c.service };
    t.offres += c.offres;
    x.titres.set(c.titre, t);
    captures.set(p, x);
  }
}
const offresDe = (x: Capture) => [...x.titres.values()].reduce((n, t) => n + t.offres, 0);
const aJuger = [...captures].filter(([, x]) => offresDe(x) >= SEUIL_OFFRES);
const echantillons = aJuger.map(([p, x]) => {
  const titres = [...x.titres].sort((a, b) => b[1].offres - a[1].offres);
  const extra = (t: string) => norme(t).split(' ').length - p.split(' ').length;
  const choisis = [titres[0], ...titres.slice(1).sort((a, b) => extra(b[0]) - extra(a[0]) || b[1].offres - a[1].offres)].slice(0, ECHANTILLON);
  return { p, occupation: x.occupation, titres: choisis.map(([t, v]) => ({ titre: t, service: v.service })) };
});
const paires = echantillons.flatMap((e) => e.titres.map((t) => ({ e, t })));
const verdicts = await consensus(paires.map(({ e, t }) => {
  const m: any = metier.get(e.occupation);
  return { intitule: t.titre, contexte: t.service ? `service : ${t.service}` : undefined, metier: `${m.labels.fr} / ${m.labels.en}`, alias: m.aliases };
}));
const decisions = echantillons.map((e) => {
  const v = paires.map((x, n) => ({ ...x, v: verdicts[n] })).filter((x) => x.e === e);
  const mode = v.some((x) => x.v === 'rejete') ? 'exacte' : v.every((x) => x.v === 'confirme') ? 'generalisable' : 'indetermine';
  return { expression: e.p, occupation: e.occupation, mode, offres: offresDe(captures.get(e.p)!),
    juges: v.map((x) => ({ titre: x.t.titre, verdict: x.v })) };
});
// Un mot SEUL qui généralise est jugé en lui-même par les deux modèles : l'échantillon de captures ne voit pas un
// adjectif ou une tête commune à plusieurs métiers (« Commercial Planning Director » → commercial, « Quality Auditor »
// → auditeur, « Beauty Concierge » → concierge : mesure du 29/09/2026). Sans l'accord des deux, intitulé exact.
const motsSeuls = decisions.filter((d) => d.mode === 'generalisable' && !d.expression.includes(' '));
const CONSIGNE_MOT = `Chaque élément est un MOT SEUL et un métier de la taxonomie de Catwalks (luxe, mode, beauté, retail). Dis dans "suffit" si ce mot, trouvé dans n'importe quel intitulé d'offre, désigne à coup sûr ce métier, quel que soit le reste de l'intitulé. Réponds false s'il peut être un adjectif (« commercial » en anglais), un mot d'une autre fonction, ou la tête de plusieurs métiers (« auditor » : audit financier ou qualité ; « concierge » : hôtellerie ou conseil beauté).`;
const SCHEMA_MOT = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, suffit: { type: 'BOOLEAN' } }, required: ['i', 'suffit'] };
const renduMot = (lot: typeof motsSeuls) => lot.map((d, j) => { const m: any = metier.get(d.occupation); return `[${j}] « ${d.expression.toLowerCase()} » — métier : ${m.labels.fr} / ${m.labels.en}`; }).join('\n');
const [w1, w2] = [await repondre(MODELE_CHOIX, CONSIGNE_MOT, motsSeuls, 25, renduMot, SCHEMA_MOT), await repondre(JUGES.j2, CONSIGNE_MOT, motsSeuls, 25, renduMot, SCHEMA_MOT)];
motsSeuls.forEach((d, n) => {
  (d as any).motSeul = [w1[n]?.suffit ?? null, w2[n]?.suffit ?? null];
  if (!(w1[n]?.suffit && w2[n]?.suffit)) d.mode = w1[n] && w2[n] ? 'exacte' : 'indetermine';
});
const sousSeuil = [...captures].filter(([, x]) => offresDe(x) < SEUIL_OFFRES).map(([p, x]) => ({ expression: p, occupation: x.occupation, mode: 'exacte', offres: offresDe(x) }));
const compte = (l: any[]) => l.reduce((a, x) => ({ ...a, [x.mode]: (a[x.mode] ?? 0) + 1 }), {} as Record<string, number>);
const offresPar = (l: any[], mode: string) => l.filter((x) => x.mode === mode).reduce((n, x) => n + x.offres, 0);
const bilan = { expressionsQuiGeneralisent: captures.size, jugees: decisions.length, modes: compte(decisions), sousSeuil: sousSeuil.length,
  motsSeulsJuges: motsSeuls.length, motsSeulsRamenesALExact: motsSeuls.filter((d) => d.mode === 'exacte').map((d) => d.expression),
  offresGeneralisables: offresPar(decisions, 'generalisable'), offresRameneesALExact: offresPar(decisions, 'exacte') + offresPar(sousSeuil, 'exacte'),
  seuils: { SEUIL_OFFRES, ECHANTILLON } };
writeFileSync(`${DOSSIER_SORTIE}6c-generalisations.json`, JSON.stringify({ calculeLe: new Date().toISOString(), juges: JUGES, bilan,
  decisions, sousSeuil }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
for (const d of decisions.filter((x) => x.mode === 'exacte').sort((a, b) => b.offres - a.offres).slice(0, 15))
  console.log(` exacte : ${d.expression} → ${d.occupation} (${d.offres} offres) ; rejeté : ${d.juges.filter((j) => j.verdict === 'rejete').map((j) => j.titre).join(' · ')}`);
const indetermines = decisions.filter((d) => d.mode === 'indetermine').length;
if (indetermines) { console.error(`ÉTAPE INCOMPLÈTE : ${indetermines} expression(s) sans verdict complet`); process.exitCode = 1; }
