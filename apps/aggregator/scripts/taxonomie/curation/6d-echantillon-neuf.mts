/**
 * PASSE DE CURATION v3, ÉTAPE 6d : ÉCHANTILLON NEUF ET MESURE DE JUSTESSE DE LA VERSION FINALE (plan
 * `docs/architecture/classification-metiers.md` §3.2 : « échantillon neuf de 200 rattachements par version, jugé par un
 * modèle différent de celui qui a rattaché » ; D-475 §30 : mesure « à chaque version »).
 *
 * Protocole, après l'audit du 29/09/2026 (la mesure précédente portait sur un manifeste antérieur, jugée par l'assistant
 * qui corrigeait ensuite) :
 *  1. `--tirer` : 200 couples (intitulé, service) dont le résultat change en v3 FINALE (gain, changement, perte), jamais
 *     jugés auparavant (tours précédents compris), tirés sans remise avec une probabilité proportionnelle au nombre
 *     d'offres (Efraimidis-Spirakis, aléa tiré d'une empreinte salée par tour : reproductible) ; écrit
 *     `6d-echantillon-final.json` (tour 1) ou `6d-echantillon-final-<n>.json` (`--tour=<n>`) AVANT tout jugement ;
 *  2. `--juger-modele` : le second juge (`gemini-3-flash-preview`) note chaque couple, seul, avec la grille ci-dessous ;
 *  3. les verdicts de l'assistant (autre famille de modèles) sont ajoutés à la main dans le fichier, puis `--compter`
 *     rend les deux mesures, par intitulé et pondérées par offre, avec l'intervalle de Wilson à 95 %.
 * Grille : C juste ; P proche (bonne famille ou niveau voisin, ex. stage rattaché au métier plein) ; F faux (autre métier,
 * ou métier donné à un intitulé vague) ; pour une perte (plus de métier), C si l'absence de métier est juste, F sinon.
 *
 *   node [--env-file=<.env portant GEMINI_API_KEY>] --import tsx apps/aggregator/scripts/taxonomie/curation/6d-echantillon-neuf.mts --tirer|--juger-modele|--compter [--tour=<n>]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compileOccupationManifest } from '../../../../../packages/db/occupation-engine.ts';
import { DOSSIER_SORTIE as D, lireEtape, servie } from './commun.mts';

// Un tour par version mesurée : le tour 2 mesure la version corrigée après le tour 1 (D-475 §35), sur des intitulés neufs.
const TOUR = Number(process.argv.find((a) => a.startsWith('--tour='))?.slice(7) ?? 1);
const fichierDu = (t: number) => `${D}6d-echantillon-final${t === 1 ? '' : `-${t}`}.json`;
const FICHIER = fichierDu(TOUR);
const mode = process.argv.find((a) => ['--tirer', '--juger-modele', '--compter'].includes(a));

if (mode === '--tirer') {
  if (existsSync(FICHIER)) throw new Error('échantillon déjà tiré : il ne se retire pas (enregistré avant jugement)');
  const v1 = compileOccupationManifest(structuredClone(servie)), m = lireEtape('6-manifeste-v3.json'), v3 = compileOccupationManifest(m);
  const { couples } = JSON.parse(gunzipSync(readFileSync(`${D}entrees/offres-preview-2026-09-29.json.gz`)).toString('utf8'));
  const deja = lireEtape('6d-mesure-justesse.json');
  const precedents = Array.from({ length: TOUR - 1 }, (_, n) => JSON.parse(readFileSync(fichierDu(n + 1), 'utf8')).echantillon);
  const vus = new Set([...deja.tour1.verdicts, ...deja.echantillonNeuf.verdicts, ...precedents.flat()].map((x: any) => x.titre.toLowerCase().trim()));
  const cand = couples.map((c: any) => ({ c, a: v1.classify(c.titre, c.service).occupationCode, b: v3.classify(c.titre, c.service) }))
    .filter((x: any) => x.a !== x.b.occupationCode && !vus.has(x.c.titre.toLowerCase().trim()));
  const alea = (x: any) => (parseInt(createHash('sha256').update(`final-2026-09-29${TOUR === 1 ? '' : `-tour${TOUR}`}|${x.c.titre}|${x.c.service}`).digest('hex').slice(0, 12), 16) + 1) / 2 ** 48;
  const e = cand.map((x: any) => ({ x, k: Math.log(alea(x)) / x.c.offres })).sort((p: any, q: any) => q.k - p.k).slice(0, 200)
    .map(({ x }: any) => ({ titre: x.c.titre, service: x.c.service, offres: x.c.offres, avant: x.a, metier: x.b.occupationCode, statut: x.b.occupationStatus,
      libelle: m.occupations.find((o: any) => o.key === x.b.occupationCode)?.labels.fr ?? null, verdictModele: null, verdictAssistant: null }));
  writeFileSync(FICHIER, JSON.stringify({ tireLe: new Date().toISOString(), tour: TOUR, manifeste: m.id, candidats: cand.length, dejaJuges: vus.size, echantillon: e }, null, 1));
  console.log(`tiré : ${e.length} sur ${cand.length} candidats neufs`);
  e.forEach((x: any, n: number) => console.log(n + 1, '|', x.titre.replace(/\s+/g, ' ').slice(0, 60), '|', (x.service ?? '').slice(0, 14), '|', x.avant ?? '—', '→', x.libelle ?? `aucun (${x.statut})`));
}

if (mode === '--juger-modele') {
  const { JUGES, repondre } = await import('./ia.mts');
  const o = JSON.parse(readFileSync(FICHIER, 'utf8'));
  const CONSIGNE = `Tu évalues la classification d'offres d'emploi de Catwalks (luxe, mode, beauté, retail). Pour chaque offre (intitulé, service), note le métier attribué : "C" juste ; "P" proche (bonne famille ou niveau voisin, ex. un stage rattaché au métier plein) ; "F" faux (un autre métier, ou un métier donné à un intitulé trop vague pour en avoir un). Quand l'offre n'a PAS de métier, "C" si l'absence de métier est juste (intitulé vague ou ambigu), "F" si un métier évident manque.`;
  const SCHEMA = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, verdict: { type: 'STRING', enum: ['C', 'P', 'F'] } }, required: ['i', 'verdict'] };
  const rendu = (lot: any[]) => lot.map((x, j) => `[${j}] « ${x.titre} »${x.service ? ` (service : ${x.service})` : ''} → ${x.libelle ?? 'aucun métier'}`).join('\n');
  const r = await repondre(JUGES.j2, CONSIGNE, o.echantillon, 20, rendu, SCHEMA);
  o.echantillon.forEach((x: any, n: number) => { x.verdictModele = r[n]?.verdict ?? null; });
  writeFileSync(FICHIER, JSON.stringify(o, null, 1));
  console.log('verdicts du modèle :', o.echantillon.filter((x: any) => x.verdictModele).length, '/', o.echantillon.length);
}

if (mode === '--compter') {
  const o = JSON.parse(readFileSync(FICHIER, 'utf8'));
  const wilson = (f: number, n: number) => { const z = 1.96, p = f / n; return Math.round(1000 * ((p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n))) / 10; };
  const mesure = (cle: string) => {
    const l = o.echantillon.filter((x: any) => x[cle]);
    const n = (v: string) => l.filter((x: any) => x[cle] === v).length;
    const w = (v: string) => l.filter((x: any) => x[cle] === v).reduce((s: number, x: any) => s + x.offres, 0);
    const tot = l.reduce((s: number, x: any) => s + x.offres, 0);
    return { juges: l.length, C: n('C'), P: n('P'), F: n('F'), fauxPct: Math.round(1000 * n('F') / l.length) / 10, borneHauteWilson95: wilson(n('F'), l.length),
      parOffre: { fauxPct: Math.round(1000 * w('F') / tot) / 10, justesPct: Math.round(1000 * w('C') / tot) / 10 } };
  };
  const bilan = { assistant: mesure('verdictAssistant'), modele: mesure('verdictModele'),
    desaccords: o.echantillon.filter((x: any) => x.verdictAssistant && x.verdictModele && x.verdictAssistant !== x.verdictModele).length };
  o.bilan = bilan;
  writeFileSync(FICHIER, JSON.stringify(o, null, 1));
  console.log(JSON.stringify(bilan, null, 1));
}
