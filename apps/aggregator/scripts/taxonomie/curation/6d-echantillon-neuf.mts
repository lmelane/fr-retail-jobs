/**
 * PASSE DE CURATION v3, ÉTAPE 6d : ÉCHANTILLON NEUF ET MESURE DE JUSTESSE DE LA VERSION FINALE (plan
 * `docs/architecture/classification-metiers.md` §3.2 : « échantillon neuf de 200 rattachements par version, jugé par un
 * modèle différent de celui qui a rattaché » ; D-475 §30 : mesure « à chaque version »).
 *
 * Protocole, après l'audit du 29/09/2026 (la mesure précédente portait sur un manifeste antérieur, jugée par l'assistant
 * qui corrigeait ensuite) :
 *  1. `--tirer` : 200 couples (intitulé, service) dont le résultat change en v3 FINALE (gain, changement, perte),
 *     jamais jugés auparavant aux tours 1 et 2 seulement (voir plus bas), tirés sans remise avec une probabilité proportionnelle au nombre
 *     d'offres (Efraimidis-Spirakis, aléa tiré d'une empreinte salée par tour : reproductible) ; écrit
 *     `6d-echantillon-final.json` (tour 1) ou `6d-echantillon-final-<n>.json` (`--tour=<n>`) AVANT tout jugement ;
 *  2. les verdicts de l'assistant (autre famille de modèles) sont ajoutés à la main dans le fichier et committés AVANT
 *     `--juger-modele`, qui fait noter chaque couple par un juge de mesure qui n'a servi à AUCUN rattachement ;
 *  3. `--compter` rend les deux mesures avec l'intervalle de Wilson à 95 %.
 * Corrections de l'audit du 29/09/2026, à partir du tour 3 :
 *  - le juge de mesure n'est plus le second juge des étapes 3 à 6c (`gemini-3-flash-preview`, qui a co-décidé chaque
 *    rattachement) mais `JUGE_MESURE`, distinct des deux juges et du modèle de choix ;
 *  - le tirage porte sur TOUS les couples (intitulé, service) qui changent, sans écarter un intitulé jugé à un tour
 *    précédent : l'écarter par son seul titre cachait la moitié des offres qui changent, dont des intitulés jugés contre
 *    un métier renommé depuis (« Winkelmedewerker oproepkracht » jugé sous « Employé de commerce ») ;
 *  - le tirage étant proportionnel au nombre d'offres, la proportion brute de faux APPROCHE la part d'offres fausses ;
 *    la repondérer par les offres comptait le poids deux fois (les « 0,1 % en offres » des tours 1 et 2 étaient faux).
 *    L'approximation n'est exacte qu'avec remise : sans remise, les couples très lourds (« Lead Cashier », 4,2 % des
 *    offres) sont tirés presque sûrement et pèsent moins que leur part ; recalculé avec les probabilités d'inclusion
 *    simulées (Horvitz-Thompson, second audit du 29/09/2026), le tour 2 passe de 0,5 % à 0,46 % (assistant) et de 1,0 %
 *    à 0,94 % (modèle), le tour 3 reste à 0 faux. La part d'intitulés faux se lit en pondérant chaque couple par
 *    l'inverse de ses offres ;
 *  - les pertes (couples qui perdent leur métier) sont rares et presque jamais tirées : `--pertes` les prend TOUTES
 *    (fichier `6d-pertes-<n>.json`, même protocole, part exacte en offres, sans tirage) ;
 *  - l'empreinte du manifeste mesuré est enregistrée au tirage et vérifiée au jugement et au compte.
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

// Un tour par version mesurée : le tour 2 mesure la version corrigée après le tour 1 (D-475 §35), et ainsi de suite.
const argTour = process.argv.filter((a) => a.startsWith('--tour'));
if (argTour.some((a) => !/^--tour=[1-9]\d*$/.test(a)) || argTour.length > 1) throw new Error('usage : --tour=<entier ≥ 1>');
const TOUR = argTour.length ? Number(argTour[0].slice(7)) : 1;
/** Le juge de la mesure : aucun rattachement de la passe ne vient de lui (plan §3.2). */
const JUGE_MESURE = 'gemini-3.1-pro-preview';
const empreinte = () => createHash('sha256').update(readFileSync(`${D}6-manifeste-v3.json`)).digest('hex');
const fichierDu = (t: number) => `${D}6d-echantillon-final${t === 1 ? '' : `-${t}`}.json`;
const PERTES = process.argv.includes('--pertes');
const FICHIER = PERTES ? `${D}6d-pertes-${TOUR}.json` : fichierDu(TOUR);
const mode = process.argv.find((a) => ['--tirer', '--juger-modele', '--compter'].includes(a));

if (mode === '--tirer') {
  if (existsSync(FICHIER)) throw new Error('échantillon déjà tiré : il ne se retire pas (enregistré avant jugement)');
  const v1 = compileOccupationManifest(structuredClone(servie)), m = lireEtape('6-manifeste-v3.json'), v3 = compileOccupationManifest(m);
  const { couples } = JSON.parse(gunzipSync(readFileSync(`${D}entrees/offres-preview-2026-09-29.json.gz`)).toString('utf8'));
  const deja = lireEtape('6d-mesure-justesse.json');
  const precedents = Array.from({ length: TOUR - 1 }, (_, n) => JSON.parse(readFileSync(fichierDu(n + 1), 'utf8')).echantillon);
  // Tours 1 et 2 : intitulés déjà jugés écartés par leur titre (tirages committés, rejouables tels quels) ; tour 3 et
  // suivants : aucun écart, voir l'en-tête.
  const vus = new Set(TOUR <= 2 ? [...deja.tour1.verdicts, ...deja.echantillonNeuf.verdicts, ...precedents.flat()].map((x: any) => x.titre.toLowerCase().trim()) : []);
  const cand = couples.map((c: any) => ({ c, a: v1.classify(c.titre, c.service).occupationCode, b: v3.classify(c.titre, c.service) }))
    .filter((x: any) => (PERTES ? x.a && !x.b.occupationCode : x.a !== x.b.occupationCode) && !vus.has(x.c.titre.toLowerCase().trim()));
  const alea = (x: any) => (parseInt(createHash('sha256').update(`final-2026-09-29${TOUR === 1 ? '' : `-tour${TOUR}`}|${x.c.titre}|${x.c.service}`).digest('hex').slice(0, 12), 16) + 1) / 2 ** 48;
  const e = cand.map((x: any) => ({ x, k: Math.log(alea(x)) / x.c.offres })).sort((p: any, q: any) => q.k - p.k).slice(0, PERTES ? cand.length : 200)
    .map(({ x }: any) => ({ titre: x.c.titre, service: x.c.service, offres: x.c.offres, avant: x.a, metier: x.b.occupationCode, statut: x.b.occupationStatus,
      libelle: m.occupations.find((o: any) => o.key === x.b.occupationCode)?.labels.fr ?? null, verdictModele: null, verdictAssistant: null }));
  writeFileSync(FICHIER, JSON.stringify({ tireLe: new Date().toISOString(), tour: TOUR, ...(PERTES ? { exhaustif: true } : {}), manifeste: m.id, ...(TOUR >= 3 ? { empreinteManifeste: empreinte() } : {}),
    candidats: cand.length, offresCandidates: cand.reduce((n: number, x: any) => n + x.c.offres, 0), dejaJuges: vus.size, echantillon: e }, null, 1));
  console.log(`tiré : ${e.length} sur ${cand.length} candidats neufs`);
  e.forEach((x: any, n: number) => console.log(n + 1, '|', x.titre.replace(/\s+/g, ' ').slice(0, 60), '|', (x.service ?? '').slice(0, 14), '|', x.avant ?? '—', '→', x.libelle ?? `aucun (${x.statut})`));
}

if (mode === '--juger-modele') {
  const { JUGES, MODELE_CHOIX, repondre } = await import('./ia.mts');
  const o = JSON.parse(readFileSync(FICHIER, 'utf8'));
  if ((o.tour ?? 1) >= 3 ? o.empreinteManifeste !== empreinte() : o.empreinteManifeste && o.empreinteManifeste !== empreinte())
    throw new Error('le manifeste a changé depuis le tirage (ou son empreinte manque) : la mesure ne le concerne plus');
  if (o.echantillon.some((x: any) => !x.verdictAssistant)) throw new Error('verdicts de l\'assistant manquants : ils se committent AVANT ceux du modèle');
  if ((Object.values(JUGES) as string[]).includes(JUGE_MESURE) || (JUGE_MESURE as string) === MODELE_CHOIX) throw new Error('le juge de mesure a servi aux rattachements');
  // À partir du tour 5, la grille porte les décisions du CEO : au tour 4, le juge de mesure a noté faux les trois
  // intitulés que D-475 §36 a tranchés (« Team Manager » → Floor manager) ; les verdicts du tour 4 restent ceux de
  // l'ancienne grille.
  // La grille cite le TEXTE des décisions du CEO, jamais une lecture de l'assistant (troisième audit du 29/09/2026).
  const REGLES = TOUR >= 5 ? ` Décisions du produit à appliquer, telles qu'écrites : « Un poste d'encadrement est un autre métier : une alerte "Vendeur" ne reçoit pas "Responsable vendeur" ni "Team Leader Client Advisor" » (D-475 §32 a) ; « Un intitulé trop vague pour un métier ("Manager" seul, "Stagiaire") ne reçoit jamais de métier » (§32 c) ; « un intitulé fait seulement d'un niveau hiérarchique ("Team Manager", "Team Leader", "Team Lead", "Lead Supervisor I", "Supervisor I") reçoit le métier d'encadrement de boutique Floor manager, "General Manager" Responsable de boutique ; pour l'intitulé exact seulement » (§36) ; la vente en boutique (Conseiller de vente) et la mise en rayon de la grande distribution (Employé de rayon) sont deux métiers distincts (§35).` : '';
  const CONSIGNE = `Tu évalues la classification d'offres d'emploi de Catwalks (luxe, mode, beauté, retail). Pour chaque offre (intitulé, service), note le métier attribué : "C" juste ; "P" proche (bonne famille ou niveau voisin, ex. un stage rattaché au métier plein) ; "F" faux (un autre métier, ou un métier donné à un intitulé trop vague pour en avoir un). Quand l'offre n'a PAS de métier, "C" si l'absence de métier est juste (intitulé vague ou ambigu), "F" si un métier évident manque.${REGLES}`;
  const SCHEMA = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, verdict: { type: 'STRING', enum: ['C', 'P', 'F'] } }, required: ['i', 'verdict'] };
  const rendu = (lot: any[]) => lot.map((x, j) => `[${j}] « ${x.titre} »${x.service ? ` (service : ${x.service})` : ''} → ${x.libelle ?? 'aucun métier'}`).join('\n');
  const r = await repondre(TOUR >= 3 ? JUGE_MESURE : JUGES.j2, CONSIGNE, o.echantillon, 20, rendu, SCHEMA);
  o.echantillon.forEach((x: any, n: number) => { x.verdictModele = r[n]?.verdict ?? null; });
  o.jugeModele = TOUR >= 3 ? JUGE_MESURE : JUGES.j2;
  writeFileSync(FICHIER, JSON.stringify(o, null, 1));
  console.log('verdicts du modèle :', o.echantillon.filter((x: any) => x.verdictModele).length, '/', o.echantillon.length);
}

if (mode === '--compter') {
  const o = JSON.parse(readFileSync(FICHIER, 'utf8'));
  if ((o.tour ?? 1) >= 3 ? o.empreinteManifeste !== empreinte() : o.empreinteManifeste && o.empreinteManifeste !== empreinte())
    throw new Error('le manifeste a changé depuis le tirage (ou son empreinte manque) : la mesure ne le concerne plus');
  const wilson = (f: number, n: number) => { const z = 1.96, p = f / n; return Math.round(1000 * ((p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n))) / 10; };
  const mesure = (cle: string) => {
    const l = o.echantillon.filter((x: any) => x[cle]);
    const n = (v: string) => l.filter((x: any) => x[cle] === v).length;
    // Tirage proportionnel aux offres : la proportion brute estime la part d'OFFRES ; la part d'INTITULÉS se lit en
    // pondérant chaque couple par l'inverse de ses offres (estimateur de Hansen-Hurwitz).
    // Liste exhaustive (pertes) : la part d'offres fausses est exacte, pondérée par les offres.
    if (o.exhaustif) { const tot = l.reduce((s: number, x: any) => s + x.offres, 0), w = (v: string) => l.filter((x: any) => x[cle] === v).reduce((s: number, x: any) => s + x.offres, 0);
      return { juges: l.length, C: n('C'), P: n('P'), F: n('F'), offres: tot, offresFausses: w('F'), fauxOffresPct: Math.round(1000 * w('F') / tot) / 10 }; }
    const inv = (v: string) => l.filter((x: any) => x[cle] === v).reduce((s: number, x: any) => s + 1 / x.offres, 0);
    const totInv = l.reduce((s: number, x: any) => s + 1 / x.offres, 0);
    return { juges: l.length, C: n('C'), P: n('P'), F: n('F'), fauxOffresPct: Math.round(1000 * n('F') / l.length) / 10, borneHauteWilson95: wilson(n('F'), l.length),
      justesOffresPct: Math.round(1000 * n('C') / l.length) / 10, parIntitule: { fauxPct: Math.round(1000 * inv('F') / totInv) / 10 } };
  };
  const bilan = { assistant: mesure('verdictAssistant'), modele: mesure('verdictModele'),
    desaccords: o.echantillon.filter((x: any) => x.verdictAssistant && x.verdictModele && x.verdictAssistant !== x.verdictModele).length };
  o.bilan = bilan;
  writeFileSync(FICHIER, JSON.stringify(o, null, 1));
  console.log(JSON.stringify(bilan, null, 1));
}
